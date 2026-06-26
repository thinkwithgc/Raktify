-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 282: coordinator joins the STAFF auth cluster (username +
-- password + TOTP), not the OTP cluster.
--
-- Why: coordinators are NGO-EMPLOYED, role-shaped (the role survives
-- officer turnover same as institutional admin staff). They sign NGO
-- terms + accept clinical-adjacent responsibility (accepting blood
-- requests, verifying community/citizen tier verifications). They are
-- NOT external volunteers — that's community_leader.
--
-- Auth path mapping after this migration:
--   OTP cluster   = donor + community_leader        — mobile + OTP, 30d TTL
--   Staff cluster = hospital, blood_bank, ngo_admin, super_admin, dho,
--                   coordinator (new)                — username + password
--                                                     + TOTP, 8h TTL
--
-- Safe on prod: 0 existing coordinators (checked). No backfill needed.
-- If this migration ever runs on a DB with existing coord rows that
-- only have mobile (no username/password), it'll fail the CHECK. The
-- prod-clean precondition is verified at the start of the runbook.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Auth-path CHECK: coordinator moves from OTP cluster to staff cluster.
ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS auth_path_required;
ALTER TABLE platform_users
  ADD CONSTRAINT auth_path_required CHECK (
    (role IN ('donor', 'community_leader')
       AND mobile IS NOT NULL)
    OR
    (role IN ('hospital', 'blood_bank', 'ngo_admin', 'super_admin', 'dho', 'coordinator')
       AND username IS NOT NULL
       AND password_hash IS NOT NULL)
  );

COMMENT ON CONSTRAINT auth_path_required ON platform_users IS
  'Each role bucket satisfies its required identifier set. OTP cluster (donor/community_leader) needs mobile. Staff cluster (hospital/blood_bank/ngo_admin/super_admin/dho/coordinator) needs username + password_hash. Coordinator is staff per NGO-employment model (migration 282).';

-- 2. Mobile uniqueness indexes — drop coord-only OTP index, extend staff
--    index to include coordinator.
DROP INDEX IF EXISTS idx_platform_users_mobile_coordinator;
DROP INDEX IF EXISTS idx_platform_users_mobile_staff_cluster;

CREATE UNIQUE INDEX idx_platform_users_mobile_staff_cluster
  ON platform_users(mobile)
  WHERE mobile IS NOT NULL
    AND role IN ('hospital', 'blood_bank', 'ngo_admin', 'super_admin', 'dho', 'coordinator');

COMMENT ON INDEX idx_platform_users_mobile_staff_cluster IS
  'Per-cluster mobile uniqueness for staff roles (post-migration 282 includes coordinator). Mobile is delivery-channel only for staff — username is the auth identifier. Cross-cluster sharing with the OTP cluster remains intentional (a coordinator can also be a donor with the same mobile).';

-- 3. staff_requires_institution CHECK — coordinator stays in the "no
--    institution required" branch (already there from migration 273).
--    No change needed.

-- ROLLBACK
-- DROP INDEX IF EXISTS idx_platform_users_mobile_staff_cluster;
-- CREATE UNIQUE INDEX idx_platform_users_mobile_staff_cluster
--   ON platform_users(mobile)
--   WHERE mobile IS NOT NULL
--     AND role IN ('hospital', 'blood_bank', 'ngo_admin', 'super_admin', 'dho');
-- CREATE UNIQUE INDEX idx_platform_users_mobile_coordinator
--   ON platform_users(mobile)
--   WHERE mobile IS NOT NULL AND role = 'coordinator';
-- ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS auth_path_required;
-- ALTER TABLE platform_users ADD CONSTRAINT auth_path_required CHECK (
--   (role IN ('donor', 'community_leader') AND mobile IS NOT NULL)
--   OR
--   (role = 'coordinator' AND mobile IS NOT NULL)
--   OR
--   (role IN ('hospital', 'blood_bank', 'ngo_admin', 'super_admin', 'dho')
--      AND username IS NOT NULL AND password_hash IS NOT NULL)
-- );
