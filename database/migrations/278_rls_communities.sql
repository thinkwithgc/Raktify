-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 278: RLS policies for communities + community_moderators.
--
-- Phase 1 (mig 272) covered community_leaders profile-row RLS. This
-- migration extends RLS to the communities + community_moderators tables
-- now that those have polymorphic ownership (mig 275/276).
--
-- Scope for community_leader role:
--   SELECT  communities they OWN (owner_community_leader_id matches own
--           profile id) OR co-lead (community_moderators row matches)
--   INSERT  communities (with owner_community_leader_id = own profile)
--   UPDATE  communities they own (NOT communities where they're only
--           a co-leader; the owner controls the row)
--
--   SELECT  community_moderators for communities they own/co-lead
--   INSERT  community_moderators only for communities they OWN
--           (a co-leader can't add other co-leaders behind the owner's back)
--   DELETE  community_moderators only for communities they OWN
--           (an owner removes a co-leader; a co-leader can't remove others)
--
-- ngo_admin + super_admin keep wide access (already covered by existing
-- RLS migrations + their actor_role). 'system' actor_role retains access
-- for trigger / job paths.
--
-- coordinators (NGO) keep their existing policies for coordinator-owned
-- communities (migrations 100/200). Those policies stay untouched — this
-- migration ONLY adds community_leader-side rules.
--
-- A helper SQL function resolves the current actor's community_leaders.id
-- from the actor_user_id GUC. This lets the policy USING clauses stay
-- short + indexable.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper — returns the community_leaders.id row for the current actor, or
-- NULL if the actor isn't a community_leader. STABLE = the planner can
-- cache the result across rows in a single query.
CREATE OR REPLACE FUNCTION fn_actor_community_leader_id()
  RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT cl.id
    FROM community_leaders cl
    JOIN platform_users pu ON pu.id = cl.platform_user_id
   WHERE pu.id = nullif(current_setting('raktify.actor_user_id', TRUE), '')::uuid
     AND pu.role = 'community_leader';
$$;

-- ── communities ──────────────────────────────────────────────────────────
-- Note: ENABLE ROW LEVEL SECURITY already ran in migration 100 (Phase 1).
-- We're only ADDING new policies here for the community_leader role.

CREATE POLICY communities_cl_select ON communities FOR SELECT TO app_user
  USING (
    current_setting('raktify.actor_role', TRUE) = 'community_leader'
    AND (
      owner_community_leader_id = fn_actor_community_leader_id()
      OR id IN (
        SELECT community_id FROM community_moderators
         WHERE community_leader_id = fn_actor_community_leader_id()
      )
    )
  );

CREATE POLICY communities_cl_insert ON communities FOR INSERT TO app_user
  WITH CHECK (
    current_setting('raktify.actor_role', TRUE) = 'community_leader'
    AND owner_community_leader_id = fn_actor_community_leader_id()
  );

CREATE POLICY communities_cl_update ON communities FOR UPDATE TO app_user
  USING (
    current_setting('raktify.actor_role', TRUE) = 'community_leader'
    AND owner_community_leader_id = fn_actor_community_leader_id()
  )
  WITH CHECK (
    -- Can't transfer ownership away in an update.
    owner_community_leader_id = fn_actor_community_leader_id()
  );

-- ── community_moderators ─────────────────────────────────────────────────
ALTER TABLE community_moderators ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_cl_select ON community_moderators FOR SELECT TO app_user
  USING (
    current_setting('raktify.actor_role', TRUE) = 'community_leader'
    AND community_id IN (
      SELECT id FROM communities
       WHERE owner_community_leader_id = fn_actor_community_leader_id()
       UNION
      SELECT community_id FROM community_moderators
       WHERE community_leader_id = fn_actor_community_leader_id()
    )
  );

CREATE POLICY cm_cl_insert ON community_moderators FOR INSERT TO app_user
  WITH CHECK (
    current_setting('raktify.actor_role', TRUE) = 'community_leader'
    AND community_id IN (
      SELECT id FROM communities
       WHERE owner_community_leader_id = fn_actor_community_leader_id()
    )
  );

CREATE POLICY cm_cl_delete ON community_moderators FOR DELETE TO app_user
  USING (
    current_setting('raktify.actor_role', TRUE) = 'community_leader'
    AND community_id IN (
      SELECT id FROM communities
       WHERE owner_community_leader_id = fn_actor_community_leader_id()
    )
  );

-- ── ngo_admin / super_admin / system fallthrough ─────────────────────────
-- These roles touch communities + community_moderators from /admin paths;
-- give them full access on both tables. RLS on communities was enabled by
-- migration 100; we're adding admin policies now alongside the new CL ones.

CREATE POLICY communities_admin_all ON communities FOR ALL TO app_user
  USING (
    current_setting('raktify.actor_role', TRUE) IN ('ngo_admin', 'super_admin', 'system', 'onboarding')
  )
  WITH CHECK (
    current_setting('raktify.actor_role', TRUE) IN ('ngo_admin', 'super_admin', 'system', 'onboarding')
  );

CREATE POLICY cm_admin_all ON community_moderators FOR ALL TO app_user
  USING (
    current_setting('raktify.actor_role', TRUE) IN ('ngo_admin', 'super_admin', 'system', 'onboarding')
  )
  WITH CHECK (
    current_setting('raktify.actor_role', TRUE) IN ('ngo_admin', 'super_admin', 'system', 'onboarding')
  );

-- ROLLBACK
-- DROP POLICY IF EXISTS cm_admin_all          ON community_moderators;
-- DROP POLICY IF EXISTS communities_admin_all ON communities;
-- DROP POLICY IF EXISTS cm_cl_delete          ON community_moderators;
-- DROP POLICY IF EXISTS cm_cl_insert          ON community_moderators;
-- DROP POLICY IF EXISTS cm_cl_select          ON community_moderators;
-- ALTER TABLE community_moderators DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS communities_cl_update ON communities;
-- DROP POLICY IF EXISTS communities_cl_insert ON communities;
-- DROP POLICY IF EXISTS communities_cl_select ON communities;
-- DROP FUNCTION IF EXISTS fn_actor_community_leader_id;
