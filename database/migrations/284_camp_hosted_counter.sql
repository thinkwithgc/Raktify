-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 284: maintain community_leaders.camps_hosted counter.
--
-- A leader's camps_hosted count = number of donation_camps rows where
-- community_id is one of their OWNED communities. Co-led communities don't
-- contribute (same ownership model as community_leaders.total_donor_count
-- in migration 280).
--
-- Triggers fire on:
--   AFTER INSERT — new camp tied to a community → bump owner's counter
--   AFTER UPDATE OF community_id — camp moves to a different community
--                                  (rare; covered for completeness)
--   AFTER DELETE — camp removed → decrement
--
-- Excludes status='CA' (cancelled) from the count — we only credit the
-- leader for camps that actually happened or are scheduled to happen.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_recompute_leader_camps_hosted(p_community_id UUID)
  RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  IF p_community_id IS NULL THEN RETURN; END IF;
  SELECT owner_community_leader_id INTO v_owner_id
    FROM communities WHERE id = p_community_id;
  IF v_owner_id IS NULL THEN RETURN; END IF;

  UPDATE community_leaders
     SET camps_hosted = (
       SELECT COUNT(*)::int
         FROM donation_camps dc
         JOIN communities co ON co.id = dc.community_id
        WHERE co.owner_community_leader_id = v_owner_id
          AND dc.status <> 'CA'
     )
   WHERE id = v_owner_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_camp_community_link_trigger()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_recompute_leader_camps_hosted(NEW.community_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM fn_recompute_leader_camps_hosted(OLD.community_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.community_id IS DISTINCT FROM NEW.community_id THEN
      PERFORM fn_recompute_leader_camps_hosted(OLD.community_id);
      PERFORM fn_recompute_leader_camps_hosted(NEW.community_id);
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      -- Status change CA ↔ non-CA flips the inclusion in the count.
      PERFORM fn_recompute_leader_camps_hosted(NEW.community_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_camp_community_link
  AFTER INSERT OR UPDATE OF community_id, status OR DELETE
  ON donation_camps
  FOR EACH ROW EXECUTE FUNCTION fn_camp_community_link_trigger();

-- One-time backfill — recompute camps_hosted for every leader who owns a
-- community that has at least one camp. Zero rows on prod today.
DO $$
DECLARE
  v_community_id UUID;
BEGIN
  FOR v_community_id IN
    SELECT DISTINCT community_id FROM donation_camps WHERE community_id IS NOT NULL
  LOOP
    PERFORM fn_recompute_leader_camps_hosted(v_community_id);
  END LOOP;
END $$;

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_camp_community_link ON donation_camps;
-- DROP FUNCTION IF EXISTS fn_camp_community_link_trigger;
-- DROP FUNCTION IF EXISTS fn_recompute_leader_camps_hosted(UUID);
