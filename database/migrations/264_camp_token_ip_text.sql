-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 264: relax camp_access_tokens.last_used_ip from INET to TEXT.
--
-- Behind Azure App Service / Front Door, req.ip can occasionally surface as
-- a value Postgres' INET parser rejects (multi-hop X-Forwarded-For chains,
-- IPv4-mapped IPv6 quirks, "unknown" fallback strings, etc.). Every other
-- audit-style IP column in this schema is TEXT for exactly this reason
-- (see audit_log.actor_ip_address). Bring the new column in line so the
-- magic-link dashboard's "touch last_used" UPDATE can't crash on a
-- malformed proxy header.
--
-- Lossless ALTER (INET → TEXT) is straightforward; data preserved as the
-- canonical text representation.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE camp_access_tokens
  ALTER COLUMN last_used_ip TYPE TEXT USING last_used_ip::text;

COMMENT ON COLUMN camp_access_tokens.last_used_ip IS
  'Most recent client IP that used this token. TEXT, not INET, to match '
  'the audit_log style and tolerate proxy-mangled values.';

-- ROLLBACK
-- ALTER TABLE camp_access_tokens
--   ALTER COLUMN last_used_ip TYPE INET USING last_used_ip::inet;
