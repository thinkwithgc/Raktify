-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 296: platform_users.failed_login_attempts
--
-- Security hardening (audit finding — institutional-login brute-force). The
-- OTP flow already locks an account after 5 bad codes via otp_attempts +
-- is_locked/locked_until. The username+password institutional login had no
-- per-account lockout — only the per-IP limiter — so a slow, IP-rotating
-- brute force was possible. This column is the password-path counter; the
-- lock state itself reuses the existing is_locked / locked_until columns.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE platform_users
  ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN platform_users.failed_login_attempts IS
  'Consecutive failed username+password login attempts. Reset to 0 on success; '
  'at 5 the account is locked via is_locked/locked_until for 30 minutes.';

-- ROLLBACK
-- ALTER TABLE platform_users DROP COLUMN failed_login_attempts;
