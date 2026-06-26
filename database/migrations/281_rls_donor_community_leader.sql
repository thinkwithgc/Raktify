-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 281: RLS — community_leader can SELECT donors attributed to
-- their owned + co-led communities.
--
-- Adds ONE policy alongside the existing donors_self / donors_self_update /
-- donors_register policies (left untouched). The policy is row-level only;
-- column-level PII boundary is enforced at the API layer:
--   • backend never selects mobile, address_line, abha_id, aadhaar_last4,
--     deferral_reason, alternate_mobiles for community_leader queries
--   • only name + blood_group_self_reported/verified + last donation date
--     + reliability_score are returned
--
-- Why not column-level GRANT instead of API discipline?
--   • app_user already has SELECT on all donor columns (other roles need
--     them — e.g. blood_bank sees the full medical row)
--   • Per-role column GRANTs require separate Postgres roles per app role,
--     which we don't have (single app_user multiplexes roles via GUC)
--   • Column-level filtering at the API is auditable (every endpoint
--     spells out its column list) and review-friendly
--
-- The risk surface: a future endpoint accidentally SELECT *-ing donors
-- under actor_role='community_leader' would leak mobile. Mitigation:
-- code reviewers + the explicit comment on the policy itself.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY donors_cl_select ON donors FOR SELECT TO app_user
  USING (
    current_setting('raktify.actor_role', TRUE) = 'community_leader'
    AND community_id IN (
      -- Communities I own
      SELECT id FROM communities
       WHERE owner_community_leader_id = fn_actor_community_leader_id()
      UNION
      -- Communities I co-lead
      SELECT community_id FROM community_moderators
       WHERE community_leader_id = fn_actor_community_leader_id()
    )
  );

COMMENT ON POLICY donors_cl_select ON donors IS
  'community_leader SELECT visibility — donors whose community_id matches an owned or co-led community. PII boundary (mobile, address, etc.) enforced at the API layer, not via column-level GRANT.';

-- ROLLBACK
-- DROP POLICY IF EXISTS donors_cl_select ON donors;
