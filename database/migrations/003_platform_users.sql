-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003: platform_users — the auth-only spine of every account.
--
-- Design rule (spec §3): this is a THIN table. No profile data, no
-- preferences, no addresses. Profile data lives on the role-specific table
-- (donors, coordinators, institutions). The link is a FK from the profile
-- table → platform_users.id.
--
-- Why thin: lets us version auth independently of profile schema, and lets
-- a single login session resolve to its role-specific row in one join.
--
-- Authentication mode is determined by role:
--   donor / coordinator         → mobile + OTP
--   hospital / blood_bank /
--   ngo_admin / super_admin     → email + password + TOTP
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE platform_users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role                  TEXT NOT NULL CHECK (role IN
                          ('donor','coordinator','hospital','blood_bank','ngo_admin','super_admin')),

  -- Mobile-OTP path
  mobile                CHAR(13) UNIQUE,                   -- encrypted, +91XXXXXXXXXX
  otp_hash              CHAR(64),                          -- SHA-256(otp); nulled after verify
  otp_expires_at        TIMESTAMPTZ,
  otp_attempts          SMALLINT NOT NULL DEFAULT 0,

  -- Email + password + TOTP path
  email                 CITEXT UNIQUE,
  password_hash         TEXT,                              -- bcrypt
  password_set_at       TIMESTAMPTZ,
  force_password_change BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret           TEXT,                              -- encrypted (envelope)
  totp_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  totp_verified_at      TIMESTAMPTZ,

  -- Common fields
  is_locked             BOOLEAN NOT NULL DEFAULT FALSE,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  last_login_ip         TEXT,                              -- encrypted
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Auth integrity: each role must have its required identifier(s).
  CONSTRAINT auth_path_required CHECK (
    (role IN ('donor','coordinator')
       AND mobile IS NOT NULL)
    OR
    (role IN ('hospital','blood_bank','ngo_admin','super_admin')
       AND email IS NOT NULL AND password_hash IS NOT NULL)
  ),
  CONSTRAINT lock_consistency CHECK (
    (is_locked = FALSE) OR (locked_until IS NOT NULL)
  )
);

CREATE INDEX idx_platform_users_role     ON platform_users(role);
CREATE INDEX idx_platform_users_locked   ON platform_users(is_locked) WHERE is_locked = TRUE;
CREATE INDEX idx_platform_users_otp_exp  ON platform_users(otp_expires_at) WHERE otp_hash IS NOT NULL;

-- updated_at maintenance — generic trigger function added in migration 100 (audit infrastructure).
-- For now, a minimal local one keeps the table self-sufficient until then.
CREATE OR REPLACE FUNCTION fn_platform_users_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_platform_users_touch
  BEFORE UPDATE ON platform_users
  FOR EACH ROW EXECUTE FUNCTION fn_platform_users_touch();

GRANT SELECT, INSERT, UPDATE ON platform_users TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_platform_users_touch ON platform_users;
-- DROP FUNCTION fn_platform_users_touch;
-- DROP TABLE platform_users;
