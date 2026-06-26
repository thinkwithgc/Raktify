-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 268: username login for institutional staff.
--
-- Why username (not email, not mobile):
--   • Email — we don't send email (MAIL_PROVIDER=console). Tying login to
--     an identifier we never deliver to is theatre.
--   • Mobile — locks the account to one officer. Institutions rotate staff;
--     a username can be HANDED OVER (deactivate, re-issue setup link to a
--     new mobile, new officer takes over the same login identity). Mobile
--     cannot — it follows the person, not the role.
--   • Username — role-shaped (`irwin_admin`, `krishna_bb_admin`), survives
--     officer turnover. Each institution gets ONE per-role admin username
--     auto-derived from `institutions.shortname + '_admin'`.
--
-- Auth path after this migration (institutional staff):
--   POST /auth/institutional/login { username, password, totp_code? }
--
-- Email becomes optional (kept as nullable profile field for record/future
-- SSO). Mobile is still required — it's the WhatsApp delivery channel for
-- the setup-token activation link + future password-reset OTPs.
--
-- Password reset (next iteration, not in this migration):
--   "Forgot password" → backend regenerates a setup_token for the user →
--   sends the same `institution_link` WhatsApp template → user resets.
--   No new endpoint needed; the existing magic-link infrastructure is reused.
--
-- This is a STAFF-ONLY change. donors / coordinators still authenticate
-- with mobile+OTP (unchanged).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the column. Nullable initially so the migration can apply to a
--    DB that already has staff rows (none on prod yet, but the migration
--    must be safe on any environment that has been seeded).
ALTER TABLE platform_users
  ADD COLUMN username CITEXT;

-- 2. Username format: lowercase letters, digits, underscore, hyphen, 3-32
--    chars, must start with a letter. Same convention as institutions.shortname.
ALTER TABLE platform_users
  ADD CONSTRAINT username_format CHECK (
    username IS NULL OR username ~ '^[a-z][a-z0-9_-]{2,31}$'
  );

-- 3. Unique when present. Two staff can't share a username; donors/coordinators
--    with NULL username are excluded from the constraint (partial unique index).
CREATE UNIQUE INDEX idx_platform_users_username
  ON platform_users(username)
  WHERE username IS NOT NULL;

-- 4. Replace auth_path_required. The original (migration 003) required
--    email + password_hash for staff roles. New rule:
--
--      donors/coordinators   → mobile required
--      staff (HO/BB/admin/dho) → username + password_hash required
--                                (email is optional metadata)
--
--    The 'dho' role wasn't in the original CHECK either (it was added
--    post-Phase-8 via migration 265 but the original CHECK still references
--    only the spec-Phase-1 roles). This migration's replacement fixes that
--    gap as a side effect.
ALTER TABLE platform_users
  DROP CONSTRAINT auth_path_required;

ALTER TABLE platform_users
  ADD CONSTRAINT auth_path_required CHECK (
    (role IN ('donor', 'coordinator')
       AND mobile IS NOT NULL)
    OR
    (role IN ('hospital', 'blood_bank', 'ngo_admin', 'super_admin', 'dho')
       AND username IS NOT NULL
       AND password_hash IS NOT NULL)
  );

COMMENT ON COLUMN platform_users.username IS
  'Login identifier for institutional staff (hospital, blood_bank, ngo_admin, super_admin, dho). NULL for donors/coordinators (who authenticate via mobile+OTP). Auto-derived as `<institutions.shortname>_admin` for institutional admins at MoU-send time; admin-assigned for ngo/super_admin/dho. Survives officer turnover — the username belongs to the role/institution, not the person.';

-- ROLLBACK
-- ALTER TABLE platform_users DROP CONSTRAINT auth_path_required;
-- ALTER TABLE platform_users ADD CONSTRAINT auth_path_required CHECK (
--   (role IN ('donor','coordinator') AND mobile IS NOT NULL)
--   OR
--   (role IN ('hospital','blood_bank','ngo_admin','super_admin')
--    AND email IS NOT NULL AND password_hash IS NOT NULL)
-- );
-- DROP INDEX IF EXISTS idx_platform_users_username;
-- ALTER TABLE platform_users DROP CONSTRAINT username_format;
-- ALTER TABLE platform_users DROP COLUMN username;
