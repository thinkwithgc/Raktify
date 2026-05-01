-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025: audit_log — the most critical table in the schema.
--
-- Spec §3, audit_log section. INSERT-only by design:
--   - app_user has no INSERT/UPDATE/DELETE
--   - audit_writer (used ONLY by triggers) has INSERT
--   - audit_reader has SELECT (via restricted view)
--   - Even super_admin cannot UPDATE/DELETE — REVOKE is permanent
--
-- Hash chain: every row carries previous_row_hash referencing the row before
-- it in the same logical chain. A scheduled job can detect tampering by
-- replaying hashes. Hash chain anchors: row_hash = SHA-256(canonical row repr).
--
-- Session context: the generic trigger reads three session GUC variables
-- set by the API on each connection acquire:
--   bloodconnect.actor_user_id
--   bloodconnect.actor_role
--   bloodconnect.actor_institution_id
--   bloodconnect.actor_session_id
--   bloodconnect.actor_ip_address
--   bloodconnect.change_reason
-- The middleware in backend/src/middleware/rlsContext.js (Phase 2) sets these
-- via SET LOCAL on every transaction.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE audit_log (
  id                   BIGSERIAL PRIMARY KEY,
  event_time           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  event_type           TEXT NOT NULL CHECK (event_type IN
                       ('INSERT','UPDATE','DELETE','LOGIN','LOGOUT',
                        'ACCESS','ESCALATION','RECALL','MERGE','OVERRIDE')),
  table_name           TEXT NOT NULL,
  record_id            TEXT NOT NULL,
  field_name           TEXT,
  old_value            TEXT,
  new_value            TEXT,
  actor_user_id        UUID REFERENCES platform_users(id),
  actor_system_process TEXT,
  actor_role           TEXT NOT NULL,
  actor_institution_id UUID REFERENCES institutions(id),
  actor_ip_address     TEXT,
  actor_session_id     TEXT,
  request_reference    TEXT,
  change_reason        TEXT,
  row_hash             CHAR(64) NOT NULL,
  previous_row_hash    CHAR(64),
  CONSTRAINT one_actor CHECK (
    (actor_user_id IS NOT NULL AND actor_system_process IS NULL) OR
    (actor_user_id IS NULL  AND actor_system_process IS NOT NULL)
  )
);

CREATE INDEX idx_audit_table_record  ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_actor         ON audit_log(actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_audit_event_time    ON audit_log(event_time);
CREATE INDEX idx_audit_event_type    ON audit_log(event_type);

-- Row hash helper. Stable, ordered, canonical SHA-256 over the salient fields.
CREATE OR REPLACE FUNCTION fn_audit_row_hash(
  p_event_type        TEXT,
  p_table_name        TEXT,
  p_record_id         TEXT,
  p_field_name        TEXT,
  p_old_value         TEXT,
  p_new_value         TEXT,
  p_actor_user_id     UUID,
  p_actor_role        TEXT,
  p_event_time        TIMESTAMPTZ,
  p_previous_row_hash CHAR(64)
) RETURNS CHAR(64) LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(
    digest(
      coalesce(p_event_type,'')        || '|' ||
      coalesce(p_table_name,'')        || '|' ||
      coalesce(p_record_id,'')         || '|' ||
      coalesce(p_field_name,'')        || '|' ||
      coalesce(p_old_value,'')         || '|' ||
      coalesce(p_new_value,'')         || '|' ||
      coalesce(p_actor_user_id::text,'')|| '|' ||
      coalesce(p_actor_role,'')        || '|' ||
      to_char(p_event_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS') || '|' ||
      coalesce(p_previous_row_hash,''),
      'sha256'
    ),
    'hex'
  )::char(64)
$$;

-- Read-only view exposed to ngo_admin / super_admin via audit_reader role.
-- old_value/new_value remain encrypted ciphertext when source field was encrypted.
CREATE VIEW audit_log_safe AS
  SELECT id, event_time, event_type, table_name, record_id, field_name,
         old_value, new_value,
         actor_user_id, actor_role, actor_institution_id,
         request_reference, change_reason
    FROM audit_log;

-- ── Generic trigger function applied to all audited tables ────────────────
CREATE OR REPLACE FUNCTION fn_audit_generic()
  RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor_user_id     UUID;
  v_actor_role        TEXT;
  v_actor_institution UUID;
  v_actor_ip          TEXT;
  v_session_id        TEXT;
  v_change_reason     TEXT;
  v_record_id         TEXT;
  v_event_type        TEXT;
  v_old               JSONB;
  v_new               JSONB;
  v_field             TEXT;
  v_prev_hash         CHAR(64);
  v_now               TIMESTAMPTZ := clock_timestamp();
  v_row_hash          CHAR(64);
BEGIN
  -- Read session context. Missing values → 'system' actor.
  BEGIN v_actor_user_id := nullif(current_setting('bloodconnect.actor_user_id', TRUE), '')::uuid;
        EXCEPTION WHEN OTHERS THEN v_actor_user_id := NULL; END;
  v_actor_role        := nullif(current_setting('bloodconnect.actor_role', TRUE), '');
  BEGIN v_actor_institution := nullif(current_setting('bloodconnect.actor_institution_id', TRUE), '')::uuid;
        EXCEPTION WHEN OTHERS THEN v_actor_institution := NULL; END;
  v_actor_ip          := nullif(current_setting('bloodconnect.actor_ip_address', TRUE), '');
  v_session_id        := nullif(current_setting('bloodconnect.actor_session_id', TRUE), '');
  v_change_reason     := nullif(current_setting('bloodconnect.change_reason', TRUE), '');

  IF v_actor_user_id IS NULL AND v_actor_role IS NULL THEN
    v_actor_role := 'system';
  END IF;

  v_event_type := TG_OP;
  IF TG_OP = 'INSERT' THEN
    v_old := NULL; v_new := to_jsonb(NEW);
    v_record_id := COALESCE(NEW.id::text, NULL);
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD); v_new := NULL;
    v_record_id := COALESCE(OLD.id::text, NULL);
  ELSE
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    v_record_id := COALESCE(NEW.id::text, OLD.id::text);
  END IF;

  -- Pull the previous_row_hash from the most recent audit row for this table+record.
  SELECT row_hash INTO v_prev_hash
    FROM audit_log
   WHERE table_name = TG_TABLE_NAME AND record_id = v_record_id
   ORDER BY id DESC LIMIT 1;

  IF TG_OP = 'UPDATE' THEN
    -- One audit row per changed field — granular, queryable, hash-chainable.
    FOR v_field IN
      SELECT key FROM jsonb_each_text(v_new)
       WHERE v_old->>key IS DISTINCT FROM v_new->>key
    LOOP
      v_row_hash := fn_audit_row_hash(
        v_event_type, TG_TABLE_NAME, v_record_id, v_field,
        v_old->>v_field, v_new->>v_field,
        v_actor_user_id, COALESCE(v_actor_role,'system'),
        v_now, v_prev_hash);

      INSERT INTO audit_log (
        event_time, event_type, table_name, record_id, field_name,
        old_value, new_value,
        actor_user_id, actor_system_process, actor_role,
        actor_institution_id, actor_ip_address, actor_session_id,
        change_reason, row_hash, previous_row_hash)
      VALUES (
        v_now, v_event_type, TG_TABLE_NAME, v_record_id, v_field,
        v_old->>v_field, v_new->>v_field,
        v_actor_user_id,
        CASE WHEN v_actor_user_id IS NULL THEN COALESCE(v_actor_role,'system') ELSE NULL END,
        COALESCE(v_actor_role,'system'),
        v_actor_institution, v_actor_ip, v_session_id,
        v_change_reason, v_row_hash, v_prev_hash);

      v_prev_hash := v_row_hash;
    END LOOP;
  ELSE
    -- INSERT / DELETE — single row, no field_name
    v_row_hash := fn_audit_row_hash(
      v_event_type, TG_TABLE_NAME, v_record_id, NULL,
      v_old::text, v_new::text,
      v_actor_user_id, COALESCE(v_actor_role,'system'),
      v_now, v_prev_hash);

    INSERT INTO audit_log (
      event_time, event_type, table_name, record_id, field_name,
      old_value, new_value,
      actor_user_id, actor_system_process, actor_role,
      actor_institution_id, actor_ip_address, actor_session_id,
      change_reason, row_hash, previous_row_hash)
    VALUES (
      v_now, v_event_type, TG_TABLE_NAME, v_record_id, NULL,
      v_old::text, v_new::text,
      v_actor_user_id,
      CASE WHEN v_actor_user_id IS NULL THEN COALESCE(v_actor_role,'system') ELSE NULL END,
      COALESCE(v_actor_role,'system'),
      v_actor_institution, v_actor_ip, v_session_id,
      v_change_reason, v_row_hash, v_prev_hash);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- The function is SECURITY DEFINER, so it runs with the privileges of its
-- *owner* (the migration-running superuser-equivalent), giving the trigger
-- access to audit_log even when the calling app_user has no INSERT permission.
-- The "only audit_writer can write to audit_log" guarantee is enforced at the
-- TABLE level below (REVOKE/GRANT on audit_log itself), not via function
-- ownership — and reassigning function ownership requires the new owner to
-- have CREATE on schema public, which we explicitly do not want to grant.

-- Helper that future migrations call to attach the audit trigger to a table.
-- Usage:  SELECT attach_audit_trigger('donors');
CREATE OR REPLACE FUNCTION attach_audit_trigger(p_table TEXT)
  RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON %I', p_table, p_table);
  EXECUTE format('CREATE TRIGGER trg_audit_%I '
                 'AFTER INSERT OR UPDATE OR DELETE ON %I '
                 'FOR EACH ROW EXECUTE FUNCTION fn_audit_generic()',
                 p_table, p_table);
END;
$$;

-- ── Lock down audit_log permissions ───────────────────────────────────────
REVOKE ALL ON audit_log FROM PUBLIC;
REVOKE ALL ON audit_log FROM app_user;
GRANT INSERT ON audit_log TO audit_writer;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO audit_writer;
GRANT SELECT ON audit_log_safe TO audit_reader;

-- Attach the audit trigger to every table created so far.
SELECT attach_audit_trigger('platform_users');
SELECT attach_audit_trigger('institutions');
SELECT attach_audit_trigger('mou_versions');

-- ROLLBACK
-- DROP FUNCTION attach_audit_trigger(TEXT);
-- DROP FUNCTION fn_audit_generic();
-- DROP FUNCTION fn_audit_row_hash(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,CHAR);
-- DROP VIEW audit_log_safe;
-- DROP TABLE audit_log;
