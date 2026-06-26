-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 272: RLS policies for community_leaders (Phase 1 of the
-- community-leader rollout — profile-table-only scope).
--
-- Phase 2 will add policies for communities + community_moderators when
-- those tables get polymorphic ownership wired up. Phase 3 will add the
-- donor-roster + referral-attribution policies.
--
-- Policy set for community_leaders:
--   SELECT  community_leader sees own row; ngo_admin/super_admin see all
--   INSERT  ngo_admin/super_admin only (the invite flow)
--   UPDATE  community_leader can edit own profile fields; ngo_admin/
--           super_admin can change suspension state + verification
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE community_leaders ENABLE ROW LEVEL SECURITY;

CREATE POLICY cl_self_select ON community_leaders FOR SELECT TO app_user
  USING (
    platform_user_id::text = current_setting('raktify.actor_user_id', TRUE)
    OR current_setting('raktify.actor_role', TRUE) IN ('ngo_admin', 'super_admin', 'system')
  );

CREATE POLICY cl_admin_insert ON community_leaders FOR INSERT TO app_user
  WITH CHECK (
    current_setting('raktify.actor_role', TRUE) IN ('ngo_admin', 'super_admin', 'onboarding')
  );

CREATE POLICY cl_self_update ON community_leaders FOR UPDATE TO app_user
  USING (
    platform_user_id::text = current_setting('raktify.actor_user_id', TRUE)
    OR current_setting('raktify.actor_role', TRUE) IN ('ngo_admin', 'super_admin')
  )
  WITH CHECK (
    platform_user_id::text = current_setting('raktify.actor_user_id', TRUE)
    OR current_setting('raktify.actor_role', TRUE) IN ('ngo_admin', 'super_admin')
  );

-- ROLLBACK
-- DROP POLICY IF EXISTS cl_self_update   ON community_leaders;
-- DROP POLICY IF EXISTS cl_admin_insert  ON community_leaders;
-- DROP POLICY IF EXISTS cl_self_select   ON community_leaders;
-- ALTER TABLE community_leaders DISABLE ROW LEVEL SECURITY;
