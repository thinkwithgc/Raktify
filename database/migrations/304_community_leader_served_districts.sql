-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 304: community-leader served districts (multi-district opt-in)
--
-- Founder decision (this session): restricting a leader to only their OWN
-- community's requests wastes the human resource. A leader should see BB-unfilled
-- requests across their home district, and may OPT IN to additional districts
-- they're willing to mobilise for. Leaders stay mobilise-only (they never raise
-- requests) and never see patient PII.
--
-- A leader's served set = their home district (community_leaders.district_id)
-- UNION the rows here. This table only holds the ADDITIONAL opt-ins.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE community_leader_served_districts (
  community_leader_id UUID NOT NULL REFERENCES community_leaders(id) ON DELETE CASCADE,
  district_id         INT  NOT NULL REFERENCES districts(id),
  added_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (community_leader_id, district_id)
);

CREATE INDEX idx_cl_served_districts_district
  ON community_leader_served_districts (district_id);

COMMENT ON TABLE community_leader_served_districts IS
  'Additional districts (beyond their home district) a community leader has '
  'opted in to help serve. Served set = home district UNION these rows.';

-- RLS (belt-and-suspenders; app also scopes since the runtime role is BYPASSRLS):
-- a leader manages only their own rows; admins see all.
ALTER TABLE community_leader_served_districts ENABLE ROW LEVEL SECURITY;

CREATE POLICY clsd_self ON community_leader_served_districts FOR ALL TO app_user
  USING (
    fn_is_admin()
    OR community_leader_id = (
         SELECT id FROM community_leaders WHERE platform_user_id = fn_actor_user_id())
  )
  WITH CHECK (
    fn_is_admin()
    OR community_leader_id = (
         SELECT id FROM community_leaders WHERE platform_user_id = fn_actor_user_id())
  );

GRANT SELECT, INSERT, DELETE ON community_leader_served_districts TO app_user;

-- ROLLBACK
-- DROP TABLE IF EXISTS community_leader_served_districts;
