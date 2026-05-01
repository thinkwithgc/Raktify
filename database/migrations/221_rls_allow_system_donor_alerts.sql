-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 221: Extend donor_alerts INSERT policy to allow the 'system'
-- actor role.
--
-- runMatch (services/matching/index.js) inserts donor_alerts as a side
-- effect of request creation. The route handler elevates actor_role to
-- 'system' for the duration of runMatch so audit_log records the system
-- as the actor (rather than the human who created the request).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS alert_write ON donor_alerts;
CREATE POLICY alert_write ON donor_alerts FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'registration', 'system')
  );

-- ROLLBACK
-- DROP POLICY alert_write ON donor_alerts;
-- CREATE POLICY alert_write ON donor_alerts FOR INSERT TO app_user
--   WITH CHECK (fn_is_admin() OR fn_actor_role() IN ('coordinator','registration'));
