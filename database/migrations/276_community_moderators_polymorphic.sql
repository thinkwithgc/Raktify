-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 276: community_moderators becomes polymorphic.
--
-- Original schema (migration 007):
--   community_moderators (
--     community_id   UUID REFERENCES communities(id),
--     coordinator_id UUID REFERENCES coordinators(id),
--     PRIMARY KEY (community_id, coordinator_id)
--   )
--
-- Same problem as 275: only NGO coordinators could moderate. For
-- community_leader-owned communities, we need community_leader-typed
-- moderators too (the "co-leader" role).
--
-- Approach: ADD community_leader_id (nullable), drop the old composite
-- primary key, add a surrogate UUID PK + XOR constraint (exactly one of
-- coordinator_id / community_leader_id must be non-NULL per row), keep
-- (community_id, coordinator_id) and (community_id, community_leader_id)
-- partial unique so the same person can't be added twice as moderator
-- of one community.
--
-- A community_leader CAN moderate a community owned by another
-- community_leader (co-leader). They CANNOT moderate a community owned
-- by a coordinator (we keep coordinator-owned communities NGO-internal).
-- The current backend wiring (Phase 2 endpoints) enforces this — the
-- DB schema permits both for future flexibility.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop the existing composite PK so we can have nullable coordinator_id.
ALTER TABLE community_moderators
  DROP CONSTRAINT IF EXISTS community_moderators_pkey;

-- 2. Make coordinator_id nullable.
ALTER TABLE community_moderators
  ALTER COLUMN coordinator_id DROP NOT NULL;

-- 3. Add community_leader_id (nullable, FK).
ALTER TABLE community_moderators
  ADD COLUMN community_leader_id UUID REFERENCES community_leaders(id);

-- 4. Surrogate primary key (UUID) — needed because the old PK is gone
--    and (community_id, coordinator_id) is no longer guaranteed-non-null.
ALTER TABLE community_moderators
  ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();

-- 5. XOR check — exactly one moderator-typed FK per row.
ALTER TABLE community_moderators
  ADD CONSTRAINT moderator_exactly_one CHECK (
    (coordinator_id IS NOT NULL AND community_leader_id IS NULL)
    OR
    (coordinator_id IS NULL AND community_leader_id IS NOT NULL)
  );

-- 6. Per-community uniqueness — same coordinator/leader can't moderate
--    the same community twice. Partial indexes since one side is always NULL.
CREATE UNIQUE INDEX idx_community_moderators_unique_coord
  ON community_moderators(community_id, coordinator_id)
  WHERE coordinator_id IS NOT NULL;

CREATE UNIQUE INDEX idx_community_moderators_unique_leader
  ON community_moderators(community_id, community_leader_id)
  WHERE community_leader_id IS NOT NULL;

-- 7. Lookup-friendly index for "list communities I co-lead" queries.
CREATE INDEX idx_community_moderators_leader_id
  ON community_moderators(community_leader_id)
  WHERE community_leader_id IS NOT NULL;

COMMENT ON COLUMN community_moderators.community_leader_id IS
  'Set when the moderator is an external community_leader (co-leader). XOR with coordinator_id via moderator_exactly_one CHECK.';

-- ROLLBACK (careful — the surrogate id will be lost; data must be re-created if you rollback)
-- DROP INDEX IF EXISTS idx_community_moderators_leader_id;
-- DROP INDEX IF EXISTS idx_community_moderators_unique_leader;
-- DROP INDEX IF EXISTS idx_community_moderators_unique_coord;
-- ALTER TABLE community_moderators DROP CONSTRAINT IF EXISTS moderator_exactly_one;
-- ALTER TABLE community_moderators DROP COLUMN IF EXISTS id;
-- ALTER TABLE community_moderators DROP COLUMN IF EXISTS community_leader_id;
-- ALTER TABLE community_moderators ALTER COLUMN coordinator_id SET NOT NULL;
-- ALTER TABLE community_moderators ADD PRIMARY KEY (community_id, coordinator_id);
