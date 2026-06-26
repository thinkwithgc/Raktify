-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 283: link donation_camps to communities (Phase 4b).
--
-- When a community_leader hosts a camp from their /community-leader portal,
-- we want to know which community it belongs to so:
--   • the leader's community detail page can list "camps hosted by this
--     community" + their statuses
--   • the leader's community_leaders.camps_hosted counter has a source
--     of truth (maintained by trigger in migration 284)
--   • the public /community/:slug page can surface upcoming camps as
--     proof of activity
--
-- Nullable — public/external camps + coordinator-organised camps continue
-- to have NULL community_id (existing behavior, unchanged). Only camps
-- that were submitted via the leader portal carry the link.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE donation_camps
  ADD COLUMN community_id UUID REFERENCES communities(id);

-- Lookup-friendly index for the "camps in my community" query.
CREATE INDEX idx_donation_camps_community
  ON donation_camps(community_id)
  WHERE community_id IS NOT NULL;

COMMENT ON COLUMN donation_camps.community_id IS
  'Set when a community_leader hosts a camp via their portal. NULL for camps submitted via /camps/apply by external organisers or created directly by coordinators. Drives community_leaders.camps_hosted counter (migration 284).';

-- ROLLBACK
-- DROP INDEX IF EXISTS idx_donation_camps_community;
-- ALTER TABLE donation_camps DROP COLUMN IF EXISTS community_id;
