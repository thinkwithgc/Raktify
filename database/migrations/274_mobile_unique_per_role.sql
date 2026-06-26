-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 274: mobile uniqueness PER ROLE (not per OTP cluster).
--
-- Migration 269 grouped donor + coordinator + community_leader into ONE
-- shared partial-unique index ("OTP cluster"). The justification at the
-- time was "all three use mobile + OTP, so collision would route OTP to
-- ambiguous account."
--
-- That conflicts with the Phase-1 design Q8 the user pinned in the
-- planning conversation:
--   "leader can act as a donor as well" — meaning the SAME PERSON should
--   be able to hold a donor row AND a community_leader row with the same
--   mobile (and similarly coordinator if they want to donate too).
--
-- Fix: drop the cluster index, replace with THREE separate per-role
-- partial-unique indexes. A mobile can now appear up to once per role:
--   • once as donor
--   • once as coordinator
--   • once as community_leader
--   • once across the staff cluster (HO/BB/admin/super_admin/dho — still
--     grouped because staff roles are mutually exclusive per person)
--
-- Auth disambiguation:
--   /auth/otp/send  takes role_hint (default 'donor')
--   /auth/otp/verify takes role_hint (default 'donor')
--   Both filter the platform_users lookup by exact role so the OTP gets
--   stored on / read from the correct row. Without role_hint we default
--   to 'donor' (preserves the existing donor-login UX).
--
-- The staff cluster index from migration 269 stays AS-IS (staff roles
-- are exclusive per person — a hospital admin shouldn't also be a BB
-- admin under the same login).
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_platform_users_mobile_otp_cluster;

CREATE UNIQUE INDEX idx_platform_users_mobile_donor
  ON platform_users(mobile)
  WHERE mobile IS NOT NULL AND role = 'donor';

CREATE UNIQUE INDEX idx_platform_users_mobile_coordinator
  ON platform_users(mobile)
  WHERE mobile IS NOT NULL AND role = 'coordinator';

CREATE UNIQUE INDEX idx_platform_users_mobile_community_leader
  ON platform_users(mobile)
  WHERE mobile IS NOT NULL AND role = 'community_leader';

COMMENT ON INDEX idx_platform_users_mobile_donor IS
  'Per-role mobile uniqueness for donor. The same mobile MAY also have rows in coordinator + community_leader (Q8: a community leader is often also a donor); disambiguation happens via role_hint in /auth/otp/send + /verify.';
COMMENT ON INDEX idx_platform_users_mobile_coordinator IS
  'Per-role mobile uniqueness for coordinator. Co-exists with donor + community_leader rows for the same mobile if the same person wears multiple hats.';
COMMENT ON INDEX idx_platform_users_mobile_community_leader IS
  'Per-role mobile uniqueness for community_leader. Co-exists with donor + coordinator rows for the same mobile.';

-- ROLLBACK
-- DROP INDEX IF EXISTS idx_platform_users_mobile_community_leader;
-- DROP INDEX IF EXISTS idx_platform_users_mobile_coordinator;
-- DROP INDEX IF EXISTS idx_platform_users_mobile_donor;
-- CREATE UNIQUE INDEX idx_platform_users_mobile_otp_cluster
--   ON platform_users(mobile)
--   WHERE mobile IS NOT NULL AND role IN ('donor', 'coordinator', 'community_leader');
