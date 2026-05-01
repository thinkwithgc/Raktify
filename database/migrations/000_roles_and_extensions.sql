-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 000: Roles, extensions, and shared infrastructure.
--
-- Establishes the Postgres role hierarchy that every subsequent migration's
-- RLS policies depend on, and enables required extensions.
--
-- Roles (Postgres group roles, not application user accounts):
--   app_user       generic application connection role used by the API
--   audit_writer   used ONLY by triggers to insert into audit_log
--   audit_reader   read-only access to audit_log via restricted view
--   bb_writer      narrow role used to update donors.blood_group_verified
--                  (fenced off from app_user per spec §5.4)
--
-- Extensions:
--   pgcrypto       gen_random_uuid()
--   citext         case-insensitive email comparison (institutions, users)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_reader') THEN
    CREATE ROLE audit_reader NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bb_writer') THEN
    CREATE ROLE bb_writer NOLOGIN;
  END IF;
END
$$;

-- The connection role used by the API in dev/prod inherits from app_user.
-- On Neon the connection user is neondb_owner; in prod it is the RDS app user.
-- We grant app_user to whichever user is currently connected so the policies apply.
DO $$
BEGIN
  EXECUTE format('GRANT app_user TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not GRANT app_user to %: %', current_user, SQLERRM;
END
$$;

-- ROLLBACK
-- DROP ROLE IF EXISTS bb_writer;
-- DROP ROLE IF EXISTS audit_reader;
-- DROP ROLE IF EXISTS audit_writer;
-- DROP ROLE IF EXISTS app_user;
-- DROP EXTENSION IF EXISTS citext;
-- DROP EXTENSION IF EXISTS pgcrypto;
