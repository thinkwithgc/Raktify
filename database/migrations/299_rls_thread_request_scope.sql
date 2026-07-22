-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 299: request-scope the request_threads RLS.
--
-- Migration 200 set thr_read / thr_write to ROLE-ONLY checks
--   thr_read  : fn_actor_role() = ANY(visible_to_roles)
--   thr_write : fn_actor_role() IS NOT NULL
-- That was safe while ONLY coordinators reached the thread endpoint. To open the
-- per-request case chat to the hospital + blood_bank (and later community_leader)
-- roles, we must also scope by request ownership — otherwise one institution
-- could read or post on another institution's case thread.
--
-- Mechanism: reuse the existing blood_requests RLS (policy req_actors, migration
-- 200). The EXISTS() subquery is itself filtered by req_actors for the current
-- actor, so a thread row is visible/insertable only when the actor can already
-- see its parent blood_request. No new per-role logic to keep in sync; scoping
-- stays defined in exactly one place (req_actors).
--
-- system + admin keep unscoped INSERT so the trigger-driven SY auto-posts
-- (status changes, escalation, donor confirmations) are never blocked.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS thr_read ON request_threads;
CREATE POLICY thr_read ON request_threads FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR (
      fn_actor_role() = ANY(visible_to_roles)
      AND EXISTS (SELECT 1 FROM blood_requests br WHERE br.id = request_id)
    )
  );

DROP POLICY IF EXISTS thr_write ON request_threads;
CREATE POLICY thr_write ON request_threads FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR fn_actor_role() = 'system'
    OR (
      fn_actor_role() IS NOT NULL
      AND EXISTS (SELECT 1 FROM blood_requests br WHERE br.id = request_id)
    )
  );

-- ROLLBACK
-- DROP POLICY IF EXISTS thr_read ON request_threads;
-- CREATE POLICY thr_read ON request_threads FOR SELECT TO app_user
--   USING (fn_is_admin() OR (fn_actor_role() = ANY(visible_to_roles)));
-- DROP POLICY IF EXISTS thr_write ON request_threads;
-- CREATE POLICY thr_write ON request_threads FOR INSERT TO app_user
--   WITH CHECK (fn_actor_role() IS NOT NULL);
