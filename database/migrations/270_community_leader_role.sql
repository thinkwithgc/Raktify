-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 270: community_leader role.
--
-- A community_leader is an EXTERNAL volunteer (NOT an NGO employee) who
-- runs an existing community (caste / regional / corporate / blood-group
-- WhatsApp group) and wants to bring its donor base onto the platform
-- while keeping their group's communication on WhatsApp.
--
-- Trust model:
--   • Lower trust than 'coordinator' (NGO-employed) — invited by ngo_admin
--     only, light ID check (Aadhaar last-4 optional in Phase 1).
--   • Scope: their owned + co-led communities only. Cannot touch hospital
--     requests, cannot see donor PII outside their groups, cannot see
--     TTI/medical data, cannot see mobile (PII boundary they ALREADY have
--     on WhatsApp anyway).
--
-- Auth path:
--   Same as donor + coordinator — mobile + OTP. No password, no TOTP.
--   They live in WhatsApp; this is the friction-minimal path.
--
-- This migration only widens the role CHECK + auth_path_required CHECK
-- to ADMIT community_leader. The profile table + RLS land in 271 + 276.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Widen the role CHECK to allow 'community_leader'.
ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS platform_users_role_check;
ALTER TABLE platform_users
  ADD CONSTRAINT platform_users_role_check CHECK (
    role IN (
      'donor',
      'coordinator',
      'community_leader',
      'hospital',
      'blood_bank',
      'ngo_admin',
      'super_admin',
      'dho'
    )
  );

-- 2. Replace auth_path_required (last touched by migration 268).
--    OTP cluster (donor/coordinator/community_leader): mobile required.
--    Staff cluster (HO/BB/admin/super_admin/dho): username + password_hash.
ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS auth_path_required;

ALTER TABLE platform_users
  ADD CONSTRAINT auth_path_required CHECK (
    (role IN ('donor', 'coordinator', 'community_leader')
       AND mobile IS NOT NULL)
    OR
    (role IN ('hospital', 'blood_bank', 'ngo_admin', 'super_admin', 'dho')
       AND username IS NOT NULL
       AND password_hash IS NOT NULL)
  );

COMMENT ON CONSTRAINT auth_path_required ON platform_users IS
  'Each role bucket must satisfy its required identifier set. OTP cluster (donor/coordinator/community_leader) needs mobile; staff cluster (HO/BB/admin/dho) needs username + password_hash. Email is now optional everywhere — institutional staff use username (migration 268); community_leader/coordinator use mobile.';

-- ROLLBACK
-- ALTER TABLE platform_users DROP CONSTRAINT auth_path_required;
-- ALTER TABLE platform_users ADD CONSTRAINT auth_path_required CHECK (
--   (role IN ('donor','coordinator') AND mobile IS NOT NULL)
--   OR
--   (role IN ('hospital','blood_bank','ngo_admin','super_admin','dho')
--    AND username IS NOT NULL AND password_hash IS NOT NULL)
-- );
-- ALTER TABLE platform_users DROP CONSTRAINT platform_users_role_check;
-- ALTER TABLE platform_users ADD CONSTRAINT platform_users_role_check CHECK (
--   role IN ('donor','coordinator','hospital','blood_bank','ngo_admin','super_admin','dho')
-- );
