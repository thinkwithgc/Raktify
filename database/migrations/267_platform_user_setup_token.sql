-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 267: setup_token columns on platform_users — magic-link password
-- setup for institutional admins, replacing the
-- "temp-password-sent-over-WhatsApp" pattern (which was always a security
-- compromise; the institutional_credentials template that delivered it was
-- also rejected by Meta).
--
-- Flow:
--   1. eSign webhook fires (POST /onboarding/mou-signed) →
--   2. Backend inserts the new platform_users row with an unusable random
--      password_hash (so the auth_path_required constraint is satisfied) +
--      a setup_token_hash + 7-day expiry,
--   3. Backend sends the `institutional_setup_link` WhatsApp template
--      with the plaintext token in the URL button → recipient taps,
--   4. Recipient lands on https://raktify.choudhari.ngo/setup/<token>,
--      sets a password, the token is marked used (single-use), and the
--      placeholder password_hash is replaced with their chosen bcrypt hash.
--
-- Security properties:
--   • Token is 32-byte URL-safe random (base64url) → ~256 bits entropy.
--   • Only its SHA-256 hash is stored (same pattern as camp_access_tokens).
--   • Single-use: setup_token_used_at non-NULL means the link won't validate.
--   • TTL: 7 days from generation (admin can re-issue from /admin if expired).
--   • Placeholder password_hash is bcrypt of 32 random bytes the user never
--     sees — unguessable, so the institution literally CANNOT log in until
--     they use the setup link.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE platform_users
  ADD COLUMN setup_token_hash       CHAR(64),
  ADD COLUMN setup_token_expires_at TIMESTAMPTZ,
  ADD COLUMN setup_token_used_at    TIMESTAMPTZ;

-- A user with an active setup token has hash + expiry both non-NULL and
-- used_at NULL. After consumption, hash + expiry stay (audit trail) and
-- used_at becomes non-NULL. Issuing a new token clears used_at and writes
-- a new hash + expiry.
CREATE UNIQUE INDEX idx_platform_users_setup_token_hash
  ON platform_users(setup_token_hash)
  WHERE setup_token_hash IS NOT NULL;

COMMENT ON COLUMN platform_users.setup_token_hash IS
  'SHA-256 hash of the magic-link token. Plaintext only ever appears in the URL we send via WhatsApp.';
COMMENT ON COLUMN platform_users.setup_token_expires_at IS
  'Token TTL — default 7 days from generation. Backend rejects validation past this timestamp.';
COMMENT ON COLUMN platform_users.setup_token_used_at IS
  'Non-NULL = token has been consumed (password set). Subsequent click on the link gets 410 Gone.';

-- ROLLBACK
-- DROP INDEX IF EXISTS idx_platform_users_setup_token_hash;
-- ALTER TABLE platform_users
--   DROP COLUMN setup_token_hash,
--   DROP COLUMN setup_token_expires_at,
--   DROP COLUMN setup_token_used_at;
