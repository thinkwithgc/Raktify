-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 220: Allow the 'system' actor role to INSERT auto-assignments
-- and the ring-1 escalation_log row generated as a side effect of request
-- creation.
--
-- Background: when a hospital, coordinator, or donor creates a blood_request,
-- routes/requests.js side-effects:
--   1. INSERT INTO request_assignments (assignment_type='AU')
--   2. INSERT INTO escalation_log (ring=1, triggered_by='AU')
-- The original RLS policies (200_rls_phase1_extra) restricted these inserts
-- to coordinator/admin. The route now elevates to actor_role='system' for
-- those specific inserts; this migration teaches the policies to permit it.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS assign_write ON request_assignments;
CREATE POLICY assign_write ON request_assignments FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'system')
  );

DROP POLICY IF EXISTS esc_write ON escalation_log;
CREATE POLICY esc_write ON escalation_log FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'system')
  );

-- ROLLBACK
-- DROP POLICY assign_write ON request_assignments;
-- CREATE POLICY assign_write ON request_assignments FOR INSERT TO app_user
--   WITH CHECK (fn_is_admin() OR fn_actor_role() = 'coordinator');
-- DROP POLICY esc_write ON escalation_log;
-- CREATE POLICY esc_write ON escalation_log FOR INSERT TO app_user
--   WITH CHECK (fn_is_admin() OR fn_actor_role() = 'coordinator' OR fn_actor_role() = 'system');
