-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010: Grant audit/bb helper roles to the connecting user.
--
-- Why this is a separate migration from 000:
--   Migration 025 sets `OWNER` of fn_audit_generic to audit_writer and uses
--   SECURITY DEFINER so the trigger can write to audit_log even when the
--   calling app_user has no INSERT permission. To run that ALTER FUNCTION ...
--   OWNER TO audit_writer, the connecting Postgres user must be a member of
--   audit_writer (Postgres "set role" requirement).
--
--   This migration grants the helper roles to whichever user is currently
--   running migrations. It is idempotent and safe to run on already-prepared
--   databases.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  EXECUTE format('GRANT audit_writer TO %I', current_user);
  EXECUTE format('GRANT audit_reader TO %I', current_user);
  EXECUTE format('GRANT bb_writer    TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not grant helper roles to %: %', current_user, SQLERRM;
END
$$;

-- ROLLBACK
-- (Revoking is a no-op for migration history; the connecting user typically
-- needs these grants for the lifetime of the database.)
