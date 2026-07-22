-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 302: bag_events — append-only chain-of-custody log
--
-- blood_inventory keeps only ONE status_changed_at / status_changed_by, which
-- is overwritten on every hop — so the custody timeline (the whole point of a
-- "concrete chained status") is lost. This table records every transition:
--   who moved the bag, from what, to what, for which request, when, and why.
--
-- Populated by a trigger (not the app) so NO transition can escape it —
-- including scheduler-driven ones (auto_expire, stale-reservation release).
-- Actor + reason come from the same GUC session context the audit_log uses,
-- set by the app's withRlsContext() wrapper.
--
-- Append-only: app roles get INSERT + SELECT, never UPDATE/DELETE. This is an
-- operational custody trail (queryable, exportable for hemovigilance/NABH); the
-- tamper-evident hash-chained record remains audit_log.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE bag_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bag_id         UUID NOT NULL REFERENCES blood_inventory(id),
  blood_bank_id  UUID NOT NULL REFERENCES institutions(id),   -- denormalised for scoping
  from_status    CHAR(2),                                     -- NULL on the birth (INSERT) event
  to_status      CHAR(2) NOT NULL,
  request_id     UUID REFERENCES blood_requests(id),
  actor_user_id  UUID REFERENCES platform_users(id),
  actor_role     TEXT,
  note           TEXT,
  event_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_bag_events_bag       ON bag_events(bag_id, event_at);
CREATE INDEX idx_bag_events_request   ON bag_events(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_bag_events_bloodbank ON bag_events(blood_bank_id, event_at DESC);

COMMENT ON TABLE bag_events IS
  'Append-only per-bag custody trail: one row per blood_inventory status change '
  '(and the initial QA birth). Actor/reason from raktify.* GUC session context.';

-- Trigger: log the birth (INSERT) and every status change (UPDATE OF status).
CREATE OR REPLACE FUNCTION fn_bag_event_log()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_actor_user_id UUID;
  v_actor_role    TEXT;
  v_note          TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;  -- status unchanged → not a custody event
  END IF;

  BEGIN v_actor_user_id := nullif(current_setting('raktify.actor_user_id', TRUE), '')::uuid;
        EXCEPTION WHEN OTHERS THEN v_actor_user_id := NULL; END;
  v_actor_role := nullif(current_setting('raktify.actor_role', TRUE), '');
  v_note       := nullif(current_setting('raktify.change_reason', TRUE), '');
  IF v_actor_user_id IS NULL AND v_actor_role IS NULL THEN
    v_actor_role := 'system';
  END IF;

  INSERT INTO bag_events
    (bag_id, blood_bank_id, from_status, to_status, request_id,
     actor_user_id, actor_role, note)
  VALUES
    (NEW.id, NEW.blood_bank_id,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
     NEW.status,
     COALESCE(NEW.fulfilled_request_id, NEW.reserved_for_request_id),
     v_actor_user_id, v_actor_role, v_note);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bag_event_insert
  AFTER INSERT ON blood_inventory
  FOR EACH ROW EXECUTE FUNCTION fn_bag_event_log();

CREATE TRIGGER trg_bag_event_status
  AFTER UPDATE OF status ON blood_inventory
  FOR EACH ROW EXECUTE FUNCTION fn_bag_event_log();

-- RLS. (Belt-and-suspenders: the app also party-gates reads, since it currently
-- connects as a BYPASSRLS role — but the policies are correct for when it does
-- not.) Admin sees all; a blood bank sees its own bags' events; a hospital sees
-- events for bags issued to it; coordinators see all (routing oversight).
ALTER TABLE bag_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY bag_events_admin ON bag_events FOR SELECT TO app_user
  USING (fn_is_admin() OR fn_actor_role() IN ('coordinator','system'));

CREATE POLICY bag_events_blood_bank ON bag_events FOR SELECT TO app_user
  USING (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id());

CREATE POLICY bag_events_hospital ON bag_events FOR SELECT TO app_user
  USING (fn_actor_role() = 'hospital' AND EXISTS (
           SELECT 1 FROM blood_requests br
            WHERE br.id = bag_events.request_id
              AND br.requesting_institution_id = fn_actor_institution_id()));

-- The trigger INSERTs as the calling user; app roles never write directly.
CREATE POLICY bag_events_insert ON bag_events FOR INSERT TO app_user
  WITH CHECK (TRUE);

GRANT SELECT, INSERT ON bag_events TO app_user;
REVOKE UPDATE, DELETE ON bag_events FROM app_user;

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_bag_event_status ON blood_inventory;
-- DROP TRIGGER IF EXISTS trg_bag_event_insert ON blood_inventory;
-- DROP FUNCTION IF EXISTS fn_bag_event_log();
-- DROP TABLE IF EXISTS bag_events;
