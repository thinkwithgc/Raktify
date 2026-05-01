-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011: Grant schema USAGE to helper roles.
--
-- audit_writer (the SECURITY DEFINER owner of fn_audit_generic, set in 025)
-- needs USAGE on the public schema to call digest() and reference the
-- audit_log table when triggers fire.
--
-- audit_reader needs USAGE so it can SELECT from audit_log_safe.
-- bb_writer needs USAGE so it can later UPDATE donors.blood_group_verified
-- (Phase 3 column added with bb_writer-only update privilege).
-- ─────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO audit_writer;
GRANT USAGE ON SCHEMA public TO audit_reader;
GRANT USAGE ON SCHEMA public TO bb_writer;

-- ROLLBACK
-- REVOKE USAGE ON SCHEMA public FROM bb_writer;
-- REVOKE USAGE ON SCHEMA public FROM audit_reader;
-- REVOKE USAGE ON SCHEMA public FROM audit_writer;
