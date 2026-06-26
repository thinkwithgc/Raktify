-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 269: mobile uniqueness per role-bucket (not global).
--
-- Why this changes:
--   The original CHAR(13) UNIQUE on platform_users.mobile (migration 003)
--   prevents the same person from holding rows in different role-buckets.
--   That's wrong for a blood-donation platform:
--     • the Foundation director (super_admin) MAY also want to donate
--     • a community_leader (Phase 6 of the role taxonomy) will OFTEN also
--       donate — they're community organizers who care about the cause
--     • a hospital/BB staff member may also donate
--
--   Locking the mobile to one role forces these people to either pick a
--   role (losing the other) or use a different SIM (artificial friction).
--
-- New rule — TWO partial-unique indexes:
--   • OTP-login cluster: donor + coordinator + community_leader
--     (all use mobile + OTP as the auth path; collision would route OTP
--     to an ambiguous account)
--   • Staff cluster: hospital + blood_bank + ngo_admin + super_admin + dho
--     (all use username + password + TOTP; mobile is for WhatsApp routing
--     only, but two staff sharing a mobile would point setup-link templates
--     at an ambiguous inbox — disallowed)
--
-- Cross-cluster sharing IS ALLOWED:
--   The same mobile may appear ONCE in the OTP cluster AND ONCE in the
--   staff cluster — that's the "director who also donates" / "community
--   leader who is also a donor" case.
--
-- Auth disambiguation:
--   • Donor / coordinator / community_leader login (POST /auth/otp/send)
--     takes mobile + role_hint → filters lookup by role bucket
--   • Staff login (POST /auth/institutional/login) takes username → finds
--     the staff row directly. Mobile is delivery-channel only.
--
-- Net code impact: routes/auth.js POST /auth/otp/send needs to filter
-- the platform_users lookup by role_hint when present (so a donor row
-- doesn't shadow a community_leader row for the same mobile).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE platform_users
  DROP CONSTRAINT platform_users_mobile_key;

CREATE UNIQUE INDEX idx_platform_users_mobile_otp_cluster
  ON platform_users(mobile)
  WHERE mobile IS NOT NULL
    AND role IN ('donor', 'coordinator', 'community_leader');

CREATE UNIQUE INDEX idx_platform_users_mobile_staff_cluster
  ON platform_users(mobile)
  WHERE mobile IS NOT NULL
    AND role IN ('hospital', 'blood_bank', 'ngo_admin', 'super_admin', 'dho');

COMMENT ON INDEX idx_platform_users_mobile_otp_cluster IS
  'Per-role-bucket mobile uniqueness — donor + coordinator + community_leader share the OTP login path, so the mobile must point to at most one of them. Cross-bucket sharing with the staff cluster is intentional (a community_leader can also be a donor).';

COMMENT ON INDEX idx_platform_users_mobile_staff_cluster IS
  'Per-role-bucket mobile uniqueness — staff roles share the SETUP_LINK WhatsApp delivery target, so the same mobile cannot point to two staff accounts. Username is the actual login identifier; mobile is for WhatsApp routing only.';

-- ROLLBACK
-- DROP INDEX IF EXISTS idx_platform_users_mobile_otp_cluster;
-- DROP INDEX IF EXISTS idx_platform_users_mobile_staff_cluster;
-- ALTER TABLE platform_users ADD CONSTRAINT platform_users_mobile_key UNIQUE (mobile);
