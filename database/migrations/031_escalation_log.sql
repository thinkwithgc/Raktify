-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 031: escalation_log — append-only chain of escalation rings per request.
--
-- (Spec migration 020 — renumbered to 031.)
--
-- Spec §7 escalation rings:
--   ring 1 → 50km  (district)
--   ring 2 → 150km (state)
--   ring 3 → adjacent states; rare blood: national
--   ring 4 → DHO (District Health Officer) alert via WhatsApp + voice call
--   ring 5 → ngo_admin voice call (CR tier only, after 30 min unresolved)
--
-- Each ring is a row. Once a row is inserted it is never modified. The
-- scheduler reads the most recent row for a request to decide if another
-- escalation step is due.
--
-- triggered_by:
--   AU automatic (scheduler)
--   MA manual    (coordinator clicked "escalate now")
--   AD admin     (ngo_admin override)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE escalation_log (
  id                       BIGSERIAL PRIMARY KEY,
  request_id               UUID NOT NULL REFERENCES blood_requests(id),
  ring                     SMALLINT NOT NULL CHECK (ring BETWEEN 1 AND 5),
  triggered_by             CHAR(2) NOT NULL CHECK (triggered_by IN ('AU','MA','AD')),
  triggered_by_user_id     UUID REFERENCES platform_users(id),
  triggered_at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  radius_km                INTEGER,                                 -- NULL for ring 4/5 (people, not radius)
  search_state_ids         INTEGER[],
  donors_alerted_count     INTEGER NOT NULL DEFAULT 0,

  -- Ring-4 DHO contact
  dho_district_id          INTEGER REFERENCES districts(id),
  dho_contacted_at         TIMESTAMPTZ,
  dho_contact_channel      CHAR(2) CHECK (dho_contact_channel IN ('WA','SM','CA')),
  dho_contact_outcome      TEXT,

  -- Ring-5 ngo_admin call
  ngo_admin_called_at      TIMESTAMPTZ,
  ngo_admin_call_outcome   TEXT,

  notes                    TEXT
);

CREATE INDEX idx_escalation_request ON escalation_log(request_id, ring);
CREATE INDEX idx_escalation_recent  ON escalation_log(request_id, triggered_at DESC);
CREATE UNIQUE INDEX uq_one_ring_per_request ON escalation_log(request_id, ring);

-- This table is append-only via the API. Block UPDATE / DELETE.
CREATE OR REPLACE FUNCTION fn_escalation_immutable()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'escalation_log is append-only (attempted % on row %)', TG_OP, OLD.id;
END;
$$;
CREATE TRIGGER trg_escalation_no_update
  BEFORE UPDATE ON escalation_log
  FOR EACH ROW EXECUTE FUNCTION fn_escalation_immutable();
CREATE TRIGGER trg_escalation_no_delete
  BEFORE DELETE ON escalation_log
  FOR EACH ROW EXECUTE FUNCTION fn_escalation_immutable();

GRANT SELECT, INSERT ON escalation_log TO app_user;
GRANT USAGE, SELECT ON SEQUENCE escalation_log_id_seq TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_escalation_no_delete ON escalation_log;
-- DROP TRIGGER trg_escalation_no_update ON escalation_log;
-- DROP FUNCTION fn_escalation_immutable;
-- DROP TABLE escalation_log;
