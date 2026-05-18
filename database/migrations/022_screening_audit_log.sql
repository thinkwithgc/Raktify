-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 022: screening_audit_log — separate, purpose-built audit trail
-- for donor_screening access and changes.
--
-- (Spec migration 012 — renumbered to 022 to keep 020-022 contiguous.)
--
-- Why a SEPARATE log from audit_log:
--   - Different KMS key in production (KMS_SCREENING_KEY_ARN vs KMS_MAIN_KEY_ARN)
--   - Different retention policy (7 years per NBTC; main audit_log too)
--   - Different reader role (only super_admin with explicit reason; even
--     ngo_admin requires elevated access)
--   - Logs SELECT events (every read of TTI data is logged), not just writes
--
-- Hash chain: same scheme as main audit_log, but chain isolated to this log.
-- A scheduled job verifies both chains independently.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE screening_audit_log (
  id                   BIGSERIAL PRIMARY KEY,
  event_time           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  event_type           TEXT NOT NULL CHECK (event_type IN ('SELECT','INSERT','UPDATE','DELETE','VERIFY','LOOKBACK_FIRE')),

  donor_id             UUID NOT NULL REFERENCES donors(id),
  donation_id          UUID,
  screening_id         UUID,
  field_name           TEXT,
  old_value            TEXT,                         -- encrypted (separate key)
  new_value            TEXT,                         -- encrypted (separate key)

  actor_user_id        UUID REFERENCES platform_users(id),
  actor_role           TEXT NOT NULL,
  actor_institution_id UUID REFERENCES institutions(id),
  actor_ip_address     TEXT,                         -- encrypted
  actor_session_id     TEXT,
  access_reason        TEXT NOT NULL,                -- mandatory; cannot be NULL or blank

  row_hash             CHAR(64) NOT NULL,
  previous_row_hash    CHAR(64),

  CONSTRAINT access_reason_present CHECK (length(trim(access_reason)) > 0)
);

CREATE INDEX idx_screening_audit_donor      ON screening_audit_log(donor_id, event_time DESC);
CREATE INDEX idx_screening_audit_actor      ON screening_audit_log(actor_user_id);
CREATE INDEX idx_screening_audit_event_type ON screening_audit_log(event_type);

-- Lock down. INSERT only via a dedicated writer; reads only via super_admin
-- with mandatory access_reason.
REVOKE ALL ON screening_audit_log FROM PUBLIC;
REVOKE ALL ON screening_audit_log FROM app_user;

-- We reuse audit_writer for inserts here too (it is already trigger-only and
-- has no other privileges). For reads, only super_admin gets SELECT — bound
-- by RLS in 200_rls_phase2 with an access_reason GUC check.
GRANT INSERT ON screening_audit_log TO audit_writer;
GRANT USAGE, SELECT ON SEQUENCE screening_audit_log_id_seq TO audit_writer;

-- Trigger-callable helper to write a screening-audit row.
CREATE OR REPLACE FUNCTION fn_screening_audit_write(
  p_event_type TEXT,
  p_donor_id   UUID,
  p_donation_id UUID,
  p_screening_id UUID,
  p_field_name TEXT,
  p_old_value  TEXT,
  p_new_value  TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor_user_id     UUID;
  v_actor_role        TEXT;
  v_actor_institution UUID;
  v_actor_ip          TEXT;
  v_session_id        TEXT;
  v_access_reason     TEXT;
  v_prev_hash         CHAR(64);
  v_now               TIMESTAMPTZ := clock_timestamp();
  v_row_hash          CHAR(64);
BEGIN
  BEGIN v_actor_user_id := nullif(current_setting('raktify.actor_user_id', TRUE), '')::uuid;
        EXCEPTION WHEN OTHERS THEN v_actor_user_id := NULL; END;
  v_actor_role        := nullif(current_setting('raktify.actor_role', TRUE), '');
  BEGIN v_actor_institution := nullif(current_setting('raktify.actor_institution_id', TRUE), '')::uuid;
        EXCEPTION WHEN OTHERS THEN v_actor_institution := NULL; END;
  v_actor_ip      := nullif(current_setting('raktify.actor_ip_address', TRUE), '');
  v_session_id    := nullif(current_setting('raktify.actor_session_id', TRUE), '');
  v_access_reason := nullif(current_setting('raktify.access_reason', TRUE), '');

  IF v_access_reason IS NULL OR length(trim(v_access_reason)) = 0 THEN
    RAISE EXCEPTION 'screening_audit: access_reason GUC is required to access TTI data';
  END IF;

  SELECT row_hash INTO v_prev_hash
    FROM screening_audit_log
   WHERE donor_id = p_donor_id
   ORDER BY id DESC LIMIT 1;

  v_row_hash := fn_audit_row_hash(
    p_event_type, 'donor_screening',
    COALESCE(p_screening_id::text, p_donation_id::text, p_donor_id::text),
    p_field_name, p_old_value, p_new_value,
    v_actor_user_id, COALESCE(v_actor_role,'system'),
    v_now, v_prev_hash);

  INSERT INTO screening_audit_log (
    event_time, event_type, donor_id, donation_id, screening_id,
    field_name, old_value, new_value,
    actor_user_id, actor_role, actor_institution_id, actor_ip_address,
    actor_session_id, access_reason,
    row_hash, previous_row_hash
  ) VALUES (
    v_now, p_event_type, p_donor_id, p_donation_id, p_screening_id,
    p_field_name, p_old_value, p_new_value,
    v_actor_user_id, COALESCE(v_actor_role,'system'), v_actor_institution, v_actor_ip,
    v_session_id, v_access_reason,
    v_row_hash, v_prev_hash);
END;
$$;

-- Trigger on donor_screening that fires per-row on INSERT/UPDATE.
-- DELETE is intentionally NOT supported here because donor_screening rows
-- must never be deleted (the table itself REVOKEs DELETE in 200_rls_phase2).
CREATE OR REPLACE FUNCTION fn_screening_change_audit()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_field TEXT;
  v_old   JSONB;
  v_new   JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_screening_audit_write(
      'INSERT', NEW.donor_id, NEW.donation_id, NEW.id,
      NULL, NULL, to_jsonb(NEW)::text);
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    FOR v_field IN SELECT key FROM jsonb_each_text(v_new)
                    WHERE v_old->>key IS DISTINCT FROM v_new->>key LOOP
      PERFORM fn_screening_audit_write(
        CASE WHEN v_field IN ('verified_by','verified_at') THEN 'VERIFY'
             WHEN v_field = 'triggered_lookback_at' THEN 'LOOKBACK_FIRE'
             ELSE 'UPDATE' END,
        NEW.donor_id, NEW.donation_id, NEW.id,
        v_field, v_old->>v_field, v_new->>v_field);
    END LOOP;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_screening_change_audit
  AFTER INSERT OR UPDATE ON donor_screening
  FOR EACH ROW EXECUTE FUNCTION fn_screening_change_audit();

-- ROLLBACK
-- DROP TRIGGER trg_screening_change_audit ON donor_screening;
-- DROP FUNCTION fn_screening_change_audit;
-- DROP FUNCTION fn_screening_audit_write(TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT);
-- DROP TABLE screening_audit_log;
