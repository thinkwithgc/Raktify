-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 280: triggers maintaining denormalised donor counts on
-- communities + community_leaders.
--
-- Schema-side counters that the existing schema declared but never
-- maintained (migration 007 / 271):
--   communities.donor_count        — donors whose community_id = this.id
--   communities.active_donor_count — donors above + is_active = TRUE
--   community_leaders.total_donor_count — sum of donor_count across the
--                                         leader's OWNED communities
--                                         (co-led not counted; only owner
--                                         gets the credit number)
--
-- Maintained by triggers on donors:
--   AFTER INSERT, AFTER UPDATE OF community_id / is_active, AFTER DELETE
--
-- Approach:
--   • One trigger function recomputes both old + new community counters
--   • A second function recomputes the OWNER leader's total for affected
--     communities (cheap: a single SUM query against ~1-10 communities)
--
-- Performance: donor counts are small in v1 (hundreds, not millions).
-- Triggers run per row but the SUMs are tiny. Acceptable.
-- ─────────────────────────────────────────────────────────────────────────────

-- Recompute counters for ONE community id (used by the per-row trigger).
CREATE OR REPLACE FUNCTION fn_recompute_community_donor_counts(p_community_id UUID)
  RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_total INTEGER;
  v_active INTEGER;
  v_owner_id UUID;
BEGIN
  IF p_community_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE is_active = TRUE)
    INTO v_total, v_active
    FROM donors
   WHERE community_id = p_community_id;

  UPDATE communities
     SET donor_count = v_total,
         active_donor_count = v_active
   WHERE id = p_community_id
   RETURNING owner_community_leader_id INTO v_owner_id;

  -- Recompute the OWNER leader's total (if community is leader-owned).
  -- Coordinator-owned communities don't bump community_leaders counters.
  IF v_owner_id IS NOT NULL THEN
    UPDATE community_leaders
       SET total_donor_count = (
         SELECT COALESCE(SUM(donor_count), 0)
           FROM communities
          WHERE owner_community_leader_id = v_owner_id
       )
     WHERE id = v_owner_id;
  END IF;
END;
$$;

-- Per-row trigger function — handles INSERT, UPDATE, DELETE on donors.
CREATE OR REPLACE FUNCTION fn_donor_counts_trigger()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_recompute_community_donor_counts(NEW.community_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM fn_recompute_community_donor_counts(OLD.community_id);
  ELSIF TG_OP = 'UPDATE' THEN
    -- Update if community_id OR is_active changed (both affect counters).
    IF OLD.community_id IS DISTINCT FROM NEW.community_id THEN
      PERFORM fn_recompute_community_donor_counts(OLD.community_id);
      PERFORM fn_recompute_community_donor_counts(NEW.community_id);
    ELSIF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      PERFORM fn_recompute_community_donor_counts(NEW.community_id);
    END IF;
  END IF;
  RETURN NULL; -- AFTER trigger return ignored
END;
$$;

CREATE TRIGGER trg_donor_counts
  AFTER INSERT OR UPDATE OF community_id, is_active OR DELETE
  ON donors
  FOR EACH ROW EXECUTE FUNCTION fn_donor_counts_trigger();

-- One-time backfill for any donors that existed before this migration
-- (none expected on prod, but the migration must be safe on demo Neon).
DO $$
DECLARE
  v_community_id UUID;
BEGIN
  FOR v_community_id IN
    SELECT DISTINCT community_id FROM donors WHERE community_id IS NOT NULL
  LOOP
    PERFORM fn_recompute_community_donor_counts(v_community_id);
  END LOOP;
END $$;

COMMENT ON FUNCTION fn_donor_counts_trigger IS
  'After-row trigger on donors — keeps communities.donor_count + active_donor_count and community_leaders.total_donor_count in sync with donor.community_id and donor.is_active changes. Coordinator-owned communities only update their own counters; leader-owned communities also bump the owner leader total.';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_donor_counts ON donors;
-- DROP FUNCTION IF EXISTS fn_donor_counts_trigger;
-- DROP FUNCTION IF EXISTS fn_recompute_community_donor_counts(UUID);
