-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 300: robust per-request case chat — add community_leader as a full
-- participant + per-user unread tracking. ADDITIVE to migration 299 (which
-- request-scoped the thread for hospital / blood_bank / coordinator / admin).
--
-- community_leader coverage reuses two pieces that already exist:
--   • migration 291 put attributed_community_id on blood_requests
--   • migration 281 established owned/co-led community scoping for leaders
-- A SELECT policy that lets a leader see blood_requests attributed to their
-- community makes migration 299's thread policies (which gate on
-- EXISTS(blood_requests) + visible_to_roles) cover the leader automatically —
-- so NO thread-policy rewrite is needed here.
--
-- Why the SECURITY DEFINER helper (not the inline subquery from migration 281):
-- putting a `... IN (SELECT ... FROM communities ...)` directly in a
-- blood_requests policy makes evaluating blood_requests trigger the communities
-- RLS (comm_read → coordinators → community_moderators), which cycles →
-- "infinite recursion detected in policy for relation communities" (42P17).
-- fn_actor_leads_community() runs as owner, so its reads of communities /
-- community_moderators / community_leaders are RLS-free and cannot cycle. It
-- returns only a boolean derived from the caller's own GUC identity.
--
-- PII: as with migration 281's donor policy, the row-level grant is broad; the
-- API layer MUST return only non-sensitive request columns to community_leader
-- (never patient_initials / clinical_indication / ward_or_bed / patient detail).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. RLS-safe "does the current leader own/co-lead this community?" check.
CREATE OR REPLACE FUNCTION fn_actor_leads_community(p_community_id UUID)
  RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_community_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM communities
     WHERE id = p_community_id
       AND owner_community_leader_id = fn_actor_community_leader_id()
    UNION ALL
    SELECT 1 FROM community_moderators
     WHERE community_id = p_community_id
       AND community_leader_id = fn_actor_community_leader_id()
  )
$$;
REVOKE ALL ON FUNCTION fn_actor_leads_community(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_actor_leads_community(UUID) TO app_user;

-- 2. community_leader sees blood_requests attributed to an owned/co-led community
CREATE POLICY req_community_leader ON blood_requests FOR SELECT TO app_user
  USING (
    fn_actor_role() = 'community_leader'
    AND fn_actor_leads_community(attributed_community_id)
  );
COMMENT ON POLICY req_community_leader ON blood_requests IS
  'community_leader SELECT — requests attributed to an owned/co-led community (via SECURITY DEFINER fn_actor_leads_community to avoid RLS recursion). Patient PII columns masked at the API layer (see migration 281 rationale).';

-- 3. community_leader as a thread participant: message type + default visibility
ALTER TABLE request_threads DROP CONSTRAINT IF EXISTS request_threads_message_type_check;
ALTER TABLE request_threads ADD CONSTRAINT request_threads_message_type_check
  CHECK (message_type IN ('CO','SY','HO','BB','ND','DH','CL'));
ALTER TABLE request_threads ALTER COLUMN visible_to_roles
  SET DEFAULT ARRAY['coordinator','hospital','blood_bank','ngo_admin','super_admin','community_leader'];

-- 4. Per-user unread tracking — one "last read" marker per (user, request).
--    High-volume operational, like notification_log → not audited.
CREATE TABLE request_thread_reads (
  user_id      UUID NOT NULL REFERENCES platform_users(id),
  request_id   UUID NOT NULL REFERENCES blood_requests(id),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
ALTER TABLE request_thread_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY ttr_self ON request_thread_reads FOR ALL TO app_user
  USING (user_id = fn_actor_user_id())
  WITH CHECK (user_id = fn_actor_user_id());
GRANT SELECT, INSERT, UPDATE ON request_thread_reads TO app_user;

-- ROLLBACK
-- DROP TABLE IF EXISTS request_thread_reads;
-- ALTER TABLE request_threads ALTER COLUMN visible_to_roles SET DEFAULT ARRAY['coordinator','hospital','blood_bank','ngo_admin','super_admin'];
-- ALTER TABLE request_threads DROP CONSTRAINT IF EXISTS request_threads_message_type_check;
-- ALTER TABLE request_threads ADD CONSTRAINT request_threads_message_type_check CHECK (message_type IN ('CO','SY','HO','BB','ND','DH'));
-- DROP POLICY IF EXISTS req_community_leader ON blood_requests;
-- DROP FUNCTION IF EXISTS fn_actor_leads_community(UUID);
