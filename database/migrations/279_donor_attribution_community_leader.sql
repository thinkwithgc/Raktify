-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 279: donor attribution to the specific community_leader who
-- recruited them.
--
-- donors.community_id already exists (migration 008) — that handles
-- COMMUNITY-level attribution ("this donor belongs to the Marwadi Yuva
-- Manch community"). What's missing is PERSON-level attribution: WHICH
-- leader's referral link did the donor sign up via? That's important for
--   • Impact metrics — recognise the leader who actually did the work
--   • Co-leader credit — a co-leader's referrals shouldn't all credit
--     to the community owner
--   • Future incentives — leaderboards, recognition badges
--
-- New column: donors.referred_by_community_leader_id
--   FK to community_leaders(id), nullable. Set at donor registration time
--   if the URL had ?community=<slug> AND a referrer leader is identifiable
--   (could be the community owner, or a specific co-leader if their
--   personal link was used).
--
-- For Phase 3, the public community URL /community/:slug always credits
-- the community OWNER (simplest UX). A future enhancement could give each
-- co-leader their own /community/:slug?via=<leader-id> link.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE donors
  ADD COLUMN referred_by_community_leader_id UUID REFERENCES community_leaders(id);

-- Helpful index for the "donors I personally recruited" query (leader-side
-- analytics — Phase 4 stats card).
CREATE INDEX idx_donors_referred_by_cl
  ON donors(referred_by_community_leader_id)
  WHERE referred_by_community_leader_id IS NOT NULL;

COMMENT ON COLUMN donors.referred_by_community_leader_id IS
  'Set when a donor registers via a community_leader''s referral link (Phase 3). Distinct from community_id: a co-leader can recruit a donor INTO a community owned by another leader — community_id points to the community, this column credits the recruiter.';

-- ROLLBACK
-- DROP INDEX IF EXISTS idx_donors_referred_by_cl;
-- ALTER TABLE donors DROP COLUMN IF EXISTS referred_by_community_leader_id;
