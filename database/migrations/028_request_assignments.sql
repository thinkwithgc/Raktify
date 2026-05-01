-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 028: request_assignments — coordinator ownership chain.
--
-- (Spec migration 017 — renumbered to 028.)
--
-- Each assignment row represents one coordinator taking ownership of a
-- request — initial auto-assign, claim from a non-responsive coordinator,
-- or escalation handover. The most recent unaccepted-by-someone-else row
-- is "current" (is_current = TRUE).
--
-- Assignment types:
--   AU Auto-assigned   — system picked on-duty coordinator at request creation
--   CL Claimed         — coordinator B took over from A (timeout / no-accept)
--   HO Handover        — manual coordinator hand-off
--   ES Escalated       — district lead picked up after escalation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE request_assignments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id               UUID NOT NULL REFERENCES blood_requests(id),
  coordinator_id           UUID NOT NULL REFERENCES coordinators(id),

  assignment_type          CHAR(2) NOT NULL CHECK (assignment_type IN ('AU','CL','HO','ES')),
  assigned_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by_user_id      UUID REFERENCES platform_users(id),       -- NULL when AU

  coordinator_accepted_at  TIMESTAMPTZ,
  coordinator_declined_at  TIMESTAMPTZ,
  decline_reason           TEXT,

  is_current               BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_by_id         UUID REFERENCES request_assignments(id),
  superseded_at            TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT accept_or_decline CHECK (
    NOT (coordinator_accepted_at IS NOT NULL AND coordinator_declined_at IS NOT NULL)
  )
);

CREATE INDEX idx_assign_request_current ON request_assignments(request_id) WHERE is_current = TRUE;
CREATE INDEX idx_assign_coordinator     ON request_assignments(coordinator_id) WHERE is_current = TRUE;
CREATE UNIQUE INDEX uq_one_current_per_request
  ON request_assignments(request_id) WHERE is_current = TRUE;

-- When a new assignment row is created for a request, supersede any prior current row.
CREATE OR REPLACE FUNCTION fn_assign_supersede_prior()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_current = TRUE THEN
    UPDATE request_assignments
       SET is_current = FALSE,
           superseded_by_id = NEW.id,
           superseded_at = clock_timestamp(),
           updated_at = clock_timestamp()
     WHERE request_id = NEW.request_id
       AND id <> NEW.id
       AND is_current = TRUE;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_assign_supersede_prior
  AFTER INSERT ON request_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_assign_supersede_prior();

CREATE OR REPLACE FUNCTION fn_assign_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_assign_touch
  BEFORE UPDATE ON request_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_assign_touch();

GRANT SELECT, INSERT, UPDATE ON request_assignments TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_assign_touch ON request_assignments;
-- DROP FUNCTION fn_assign_touch;
-- DROP TRIGGER trg_assign_supersede_prior ON request_assignments;
-- DROP FUNCTION fn_assign_supersede_prior;
-- DROP TABLE request_assignments;
