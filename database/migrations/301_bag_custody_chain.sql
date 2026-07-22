-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 301: blood-bag chain of custody (issue → received → transfused)
--
-- Founder decision (this session): a bag's life is a CONCRETE, chained,
-- per-bag state machine across separate institutions —
--
--   RE  reserved for a request        (BB / matcher)
--   IS  issued: left the BB, in transit  (blood bank)
--   RV  received: custody confirmed at the requestor  (coordinator on-behalf,
--       or the hospital) — NEW status code added here
--   TR  transfused: terminal, clinical  (hospital, or coordinator on-behalf
--       for non-onboarded requestors)
--
-- Receipt is NON-BLOCKING: an onboarded hospital may go IS → TR directly
-- (transfusion implies receipt); the coordinator's RV confirmation is a
-- parallel custody-integrity check, not a gate that could delay an emergency
-- transfusion.
--
-- Return-to-stock: a bag issued but not transfused (patient died, bedside
-- crossmatch incompatible, surgery cancelled) returns to AV if the cold chain
-- held, or to WA if spoiled — WITHOUT this branch every non-transfused issued
-- unit is wastage on paper, corrupting the wastage KPI and discarding precious
-- units.
--
-- WHY the current close is broken (this migration fixes the precondition):
-- coordinator close does `SET status='TR'` on a RESERVED bag, which violates
-- issue_consistency (TR requires issued_to_institution_id). Verified live:
-- 23514 issue_consistency. Nothing set IS, so the reserved→transfused path
-- could never succeed. The IS step below is the missing precondition.
--
-- This migration touches ONE concept: the blood_inventory state machine
-- (columns + CHECK widening + transition trigger). The append-only custody
-- LOG is migration 302; the endpoints live in the app layer.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Durable request link. reserve_consistency forces reserved_for_request_id
--    to NULL the instant a bag leaves RE, so without this a bag loses all trace
--    of which request it served the moment it is issued — breaking chained
--    custody AND hemovigilance (which patient got a bag from a donor who later
--    fails lookback?). fulfilled_request_id persists IS → RV → TR.
ALTER TABLE blood_inventory
  ADD COLUMN fulfilled_request_id  UUID REFERENCES blood_requests(id),
  ADD COLUMN received_at           TIMESTAMPTZ,
  ADD COLUMN received_by           UUID REFERENCES platform_users(id),
  -- Who the receipt was verified WITH (custody attestation quality):
  --   PR patient relative · RQ requestor/hospital · CL community leader · OT other
  ADD COLUMN received_verified_with CHAR(2)
      CHECK (received_verified_with IS NULL
             OR received_verified_with IN ('PR','RQ','CL','OT')),
  ADD COLUMN transfused_at         TIMESTAMPTZ,
  ADD COLUMN returned_at           TIMESTAMPTZ,
  ADD COLUMN return_reason         TEXT;

COMMENT ON COLUMN blood_inventory.fulfilled_request_id IS
  'The request this bag was issued against. Persists through IS/RV/TR (unlike '
  'reserved_for_request_id, which reserve_consistency nulls on leaving RE). '
  'Feeds hemovigilance bag→patient trace.';

CREATE INDEX idx_inventory_fulfilled_request
  ON blood_inventory(fulfilled_request_id) WHERE fulfilled_request_id IS NOT NULL;
-- Coordinator queue: "bags issued for this request, awaiting receipt".
CREATE INDEX idx_inventory_issued_awaiting
  ON blood_inventory(fulfilled_request_id) WHERE status = 'IS';

-- 2. Widen the status enum: add RV (received). Every other code already exists.
ALTER TABLE blood_inventory DROP CONSTRAINT blood_inventory_status_check;
ALTER TABLE blood_inventory ADD  CONSTRAINT blood_inventory_status_check
  CHECK (status IN ('QA','AV','RE','IS','RV','TR','US','EX','RC','WA'));

-- 3. Redefine issue_consistency around the REQUEST link, not the institution.
--    The original constraint keyed off issued_to_institution_id, but guest /
--    community / citizen requests (tiers GH/CR/CI) carry NO requesting
--    institution — the recipient is a relative or runner — so issued_to is
--    legitimately NULL for those. The real invariant is that an issued bag is
--    tied to a REQUEST (fulfilled_request_id), which the app always sets:
--      QA/AV/RE  → both links FORBIDDEN (a stock bag must carry no issue data)
--      IS/RV     → fulfilled_request_id REQUIRED (issued_to optional: guests)
--      TR / terminal → free (TR keeps its links; legacy seed TR rows predate
--                      fulfilled_request_id, so it cannot be forced here)
ALTER TABLE blood_inventory DROP CONSTRAINT issue_consistency;
ALTER TABLE blood_inventory ADD  CONSTRAINT issue_consistency
  CHECK (
    CASE
      WHEN status IN ('QA','AV','RE') THEN issued_to_institution_id IS NULL
                                       AND fulfilled_request_id IS NULL
      WHEN status IN ('IS','RV')      THEN fulfilled_request_id IS NOT NULL
      ELSE TRUE
    END
  );

-- 4. Replace the state-machine trigger: keep the existing guarantees (terminal
--    states frozen, AV requires cleared TTI) and add the custody transitions,
--    timestamp stamping, and self-cleaning of link columns so the CHECK
--    constraints can never be tripped by a legal transition.
CREATE OR REPLACE FUNCTION fn_inventory_status_validate()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_move TEXT := OLD.status || '>' || NEW.status;
  -- Legal transitions. Terminal states (TR,EX,US,RC,WA) appear only as targets.
  v_allowed TEXT[] := ARRAY[
    'QA>AV','QA>RC','QA>US','QA>WA','QA>EX',
    'AV>RE','AV>RC','AV>EX','AV>WA','AV>US',
    'RE>IS','RE>AV','RE>RC','RE>EX',
    'IS>RV','IS>TR','IS>AV','IS>WA','IS>RC',   -- IS>TR = non-blocking receipt
    'RV>TR','RV>AV','RV>WA','RV>RC'
  ];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = clock_timestamp();

    -- Terminal states are frozen (unchanged rule).
    IF OLD.status IN ('TR','EX','US','RC','WA') THEN
      RAISE EXCEPTION 'Inventory bag % is in terminal state %; cannot transition to %',
        OLD.id, OLD.status, NEW.status;
    END IF;

    -- Only legal transitions.
    IF NOT (v_move = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'Illegal bag status transition % → % (bag %)',
        OLD.status, NEW.status, OLD.id;
    END IF;

    -- Stamp custody timestamps (idempotent — respect a value the app supplied).
    IF NEW.status = 'IS' THEN NEW.issued_at     = COALESCE(NEW.issued_at, clock_timestamp()); END IF;
    IF NEW.status = 'RV' THEN NEW.received_at   = COALESCE(NEW.received_at, clock_timestamp()); END IF;
    IF NEW.status = 'TR' THEN NEW.transfused_at = COALESCE(NEW.transfused_at, clock_timestamp()); END IF;

    -- Any return from the field (to stock, or written off) stamps returned_at.
    IF OLD.status IN ('IS','RV') AND NEW.status IN ('AV','WA','US') THEN
      NEW.returned_at = clock_timestamp();
    END IF;

    -- Returned to STOCK specifically: wipe the whole custody chain so the bag
    -- is a clean AV unit again (issued_to must be NULL for AV). A write-off
    -- (WA/US) instead KEEPS its issued_to/fulfilled_request_id for traceability.
    IF NEW.status = 'AV' AND OLD.status IN ('IS','RV') THEN
      NEW.issued_to_institution_id = NULL;
      NEW.issued_at                = NULL;
      NEW.received_at              = NULL;
      NEW.received_by              = NULL;
      NEW.received_verified_with   = NULL;
      NEW.transfused_at            = NULL;
      NEW.fulfilled_request_id     = NULL;
    END IF;

    -- Leaving RE always clears the reservation link (reserve_consistency).
    IF OLD.status = 'RE' AND NEW.status <> 'RE' THEN
      NEW.reserved_for_request_id = NULL;
      NEW.reserved_at             = NULL;
    END IF;
  END IF;

  -- AV requires a cleared TTI screening for this donation (unchanged rule).
  -- Source 'WB' (legacy WhatsApp opening stock) is exempt. Returned units
  -- (came FROM IS/RV) already cleared TTI to have been issued, so skip re-check.
  IF NEW.status = 'AV' AND OLD.status IS DISTINCT FROM 'AV'
     AND OLD.status NOT IN ('IS','RV') AND NEW.source <> 'WB' THEN
    PERFORM 1 FROM donor_screening
              WHERE donation_id = NEW.donation_id AND overall_clearance = 'CL';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cannot mark inventory bag AVailable: no cleared TTI screening for donation %',
        NEW.donation_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
-- Trigger definition itself is unchanged (BEFORE UPDATE OF status, source);
-- CREATE OR REPLACE above swaps the function body in place.

-- ROLLBACK
-- ALTER TABLE blood_inventory DROP CONSTRAINT issue_consistency;
-- ALTER TABLE blood_inventory ADD  CONSTRAINT issue_consistency
--   CHECK ((status IN ('IS','TR')) = (issued_to_institution_id IS NOT NULL));  -- note: fails if any RV / guest-issued (issued_to NULL) rows exist
-- ALTER TABLE blood_inventory DROP CONSTRAINT blood_inventory_status_check;
-- ALTER TABLE blood_inventory ADD  CONSTRAINT blood_inventory_status_check
--   CHECK (status IN ('QA','AV','RE','IS','TR','US','EX','RC','WA'));
-- DROP INDEX IF EXISTS idx_inventory_issued_awaiting;
-- DROP INDEX IF EXISTS idx_inventory_fulfilled_request;
-- ALTER TABLE blood_inventory
--   DROP COLUMN return_reason, DROP COLUMN returned_at, DROP COLUMN transfused_at,
--   DROP COLUMN received_verified_with, DROP COLUMN received_by,
--   DROP COLUMN received_at, DROP COLUMN fulfilled_request_id;
-- (restore the prior fn_inventory_status_validate body from migration 023)
