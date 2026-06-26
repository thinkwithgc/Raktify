-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 275: communities.owner becomes polymorphic (coordinator OR
-- community_leader).
--
-- Original schema (migration 007):
--   owner_coordinator_id UUID NOT NULL REFERENCES coordinators(id)
--
-- That hard-coded NGO-coordinator ownership. With the community_leader role
-- shipped (Phase 1), external leaders also own communities — they need the
-- same row+FK semantics.
--
-- Approach: ADD a parallel `owner_community_leader_id` column + XOR check
-- (exactly one of the two owner columns must be non-NULL). FKs stay
-- typed + enforceable on both sides; the application reads whichever is set.
--
-- coordinator-owned communities created before this migration remain valid
-- (owner_coordinator_id NOT NULL was the previous reality; the new XOR
-- constraint admits "exactly one of (owner_coordinator_id,
-- owner_community_leader_id) is non-NULL" so existing rows pass without
-- backfill).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop the old NOT NULL — needed so a community_leader-owned community
--    can leave owner_coordinator_id NULL.
ALTER TABLE communities
  ALTER COLUMN owner_coordinator_id DROP NOT NULL;

-- 2. Add the parallel owner column.
ALTER TABLE communities
  ADD COLUMN owner_community_leader_id UUID REFERENCES community_leaders(id);

-- 3. XOR constraint — exactly one of the two owner FKs must be set.
ALTER TABLE communities
  ADD CONSTRAINT owner_exactly_one CHECK (
    (owner_coordinator_id IS NOT NULL AND owner_community_leader_id IS NULL)
    OR
    (owner_coordinator_id IS NULL AND owner_community_leader_id IS NOT NULL)
  );

-- 4. Index for the new owner FK — equivalent to the existing
--    idx_communities_owner on owner_coordinator_id.
CREATE INDEX idx_communities_owner_cl
  ON communities(owner_community_leader_id)
  WHERE owner_community_leader_id IS NOT NULL;

COMMENT ON COLUMN communities.owner_community_leader_id IS
  'Polymorphic owner — set when an external community_leader owns this community. XOR with owner_coordinator_id via owner_exactly_one CHECK.';
COMMENT ON CONSTRAINT owner_exactly_one ON communities IS
  'Exactly one of (owner_coordinator_id, owner_community_leader_id) must be NOT NULL — communities have a single owner, either an NGO-employed coordinator or an external community_leader.';

-- ROLLBACK
-- DROP INDEX IF EXISTS idx_communities_owner_cl;
-- ALTER TABLE communities DROP CONSTRAINT IF EXISTS owner_exactly_one;
-- ALTER TABLE communities DROP COLUMN IF EXISTS owner_community_leader_id;
-- ALTER TABLE communities ALTER COLUMN owner_coordinator_id SET NOT NULL;
