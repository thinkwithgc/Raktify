-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 211: Widen the lookback firing trigger.
--
-- Bug: trg_lookback_fire_on_clearance was bound with
--   AFTER INSERT OR UPDATE OF overall_clearance
-- The UPDATE column-list filter (OF …) matches columns named in the SET
-- clause of the UPDATE statement, NOT columns that triggers internally
-- recompute. When the four-eyes verifier runs
--   UPDATE donor_screening SET verified_by = ?, verified_at = ? WHERE id = ?
-- the BEFORE trigger fn_screening_recompute_clearance flips
-- overall_clearance from PE → IN, but the AFTER trigger never fires
-- because overall_clearance wasn't in the SET list.
--
-- Fix: drop the column-list filter so the AFTER trigger fires on any
-- UPDATE. The trigger body already short-circuits when overall_clearance
-- isn't 'IN' (or was already 'IN'), so this is cheap.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_lookback_fire_on_clearance ON donor_screening;

CREATE TRIGGER trg_lookback_fire_on_clearance
  AFTER INSERT OR UPDATE ON donor_screening
  FOR EACH ROW EXECUTE FUNCTION fn_lookback_fire_on_clearance();

-- Same root cause for the inventory-recall trigger that mirrors clearance changes.
DROP TRIGGER IF EXISTS trg_screening_clearance_moves_inventory ON donor_screening;

CREATE TRIGGER trg_screening_clearance_moves_inventory
  AFTER INSERT OR UPDATE ON donor_screening
  FOR EACH ROW EXECUTE FUNCTION fn_screening_clearance_moves_inventory();

-- ROLLBACK
-- DROP TRIGGER trg_lookback_fire_on_clearance ON donor_screening;
-- CREATE TRIGGER trg_lookback_fire_on_clearance
--   AFTER INSERT OR UPDATE OF overall_clearance ON donor_screening
--   FOR EACH ROW EXECUTE FUNCTION fn_lookback_fire_on_clearance();
-- (and similar for trg_screening_clearance_moves_inventory)
