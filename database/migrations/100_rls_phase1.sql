-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 100: Row Level Security policies for Phase 1 tables.
--
-- RLS enforces "every role sees only what they are entitled to" at the engine
-- level, independent of any application code that might forget a WHERE clause.
--
-- Pattern: ALTER TABLE … ENABLE ROW LEVEL SECURITY, then CREATE POLICY per
-- role. If no policy exists for a role on a table, that role sees zero rows.
--
-- Tables covered here (Phase 1 batch):
--   states, districts, talukas, villages   (public reference — every role reads)
--   blood_groups, blood_components,
--     compatibility_matrix                 (public reference — every role reads)
--   platform_users                         (self-only for non-admins)
--   institutions                           (self-row + ngo_admin)
--   mou_versions                           (own institution + ngo_admin)
--
-- Tables added in later migrations get their own RLS migration (200_rls_phase3,
-- 300_rls_phase4 …) to keep policy ownership co-located with the schema phase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Reference / geographic tables: open read for every authenticated role ──
ALTER TABLE states               ENABLE ROW LEVEL SECURITY;
ALTER TABLE districts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE talukas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE villages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE blood_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE blood_components     ENABLE ROW LEVEL SECURITY;
ALTER TABLE compatibility_matrix ENABLE ROW LEVEL SECURITY;

CREATE POLICY ref_read_all_states     ON states               FOR SELECT TO app_user USING (TRUE);
CREATE POLICY ref_read_all_districts  ON districts            FOR SELECT TO app_user USING (TRUE);
CREATE POLICY ref_read_all_talukas    ON talukas              FOR SELECT TO app_user USING (TRUE);
CREATE POLICY ref_read_all_villages   ON villages             FOR SELECT TO app_user USING (TRUE);
CREATE POLICY ref_read_all_groups     ON blood_groups         FOR SELECT TO app_user USING (TRUE);
CREATE POLICY ref_read_all_components ON blood_components     FOR SELECT TO app_user USING (TRUE);
CREATE POLICY ref_read_all_compat     ON compatibility_matrix FOR SELECT TO app_user USING (TRUE);

-- ── platform_users ────────────────────────────────────────────────────────
-- Self-only read; insert/update permitted only to a user editing their own row,
-- or to ngo_admin / super_admin (checked via session role).
ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY pu_self_select ON platform_users FOR SELECT TO app_user
  USING (
    id::text = current_setting('raktify.actor_user_id', TRUE)
    OR current_setting('raktify.actor_role', TRUE) IN ('ngo_admin','super_admin')
  );

CREATE POLICY pu_self_update ON platform_users FOR UPDATE TO app_user
  USING (
    id::text = current_setting('raktify.actor_user_id', TRUE)
    OR current_setting('raktify.actor_role', TRUE) IN ('ngo_admin','super_admin')
  )
  WITH CHECK (
    id::text = current_setting('raktify.actor_user_id', TRUE)
    OR current_setting('raktify.actor_role', TRUE) IN ('ngo_admin','super_admin')
  );

-- INSERT: only ngo_admin/super_admin can create users; donor self-registration
-- is performed by an unauthenticated route that runs SET LOCAL raktify.actor_role='registration'.
CREATE POLICY pu_admin_insert ON platform_users FOR INSERT TO app_user
  WITH CHECK (
    current_setting('raktify.actor_role', TRUE) IN ('ngo_admin','super_admin','registration')
  );

-- ── institutions ──────────────────────────────────────────────────────────
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;

-- Read your own institution; ngo_admin/super_admin read all.
CREATE POLICY inst_self_or_admin_select ON institutions FOR SELECT TO app_user
  USING (
    id::text = current_setting('raktify.actor_institution_id', TRUE)
    OR current_setting('raktify.actor_role', TRUE) IN ('ngo_admin','super_admin')
  );

-- Apply (public onboarding flow): allowed when role='onboarding'.
CREATE POLICY inst_onboarding_insert ON institutions FOR INSERT TO app_user
  WITH CHECK (
    current_setting('raktify.actor_role', TRUE) IN ('onboarding','ngo_admin','super_admin')
  );

-- Update: ngo_admin/super_admin only. Self-edit will be added in Phase 2 with
-- a narrower policy on a defined whitelist of fields (display_name, contact, etc.).
CREATE POLICY inst_admin_update ON institutions FOR UPDATE TO app_user
  USING (current_setting('raktify.actor_role', TRUE) IN ('ngo_admin','super_admin'))
  WITH CHECK (current_setting('raktify.actor_role', TRUE) IN ('ngo_admin','super_admin'));

-- ── mou_versions ──────────────────────────────────────────────────────────
ALTER TABLE mou_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY mou_own_or_admin_select ON mou_versions FOR SELECT TO app_user
  USING (
    institution_id::text = current_setting('raktify.actor_institution_id', TRUE)
    OR current_setting('raktify.actor_role', TRUE) IN ('ngo_admin','super_admin')
  );

CREATE POLICY mou_admin_insert ON mou_versions FOR INSERT TO app_user
  WITH CHECK (
    current_setting('raktify.actor_role', TRUE) IN ('ngo_admin','super_admin','onboarding')
  );

-- mou_versions is intentionally append-only via app_user. No UPDATE/DELETE policy
-- → those operations are denied by RLS (no policy = zero rows).

-- ROLLBACK
-- DROP POLICY mou_admin_insert ON mou_versions;
-- DROP POLICY mou_own_or_admin_select ON mou_versions;
-- ALTER TABLE mou_versions DISABLE ROW LEVEL SECURITY;
-- DROP POLICY inst_admin_update ON institutions;
-- DROP POLICY inst_onboarding_insert ON institutions;
-- DROP POLICY inst_self_or_admin_select ON institutions;
-- ALTER TABLE institutions DISABLE ROW LEVEL SECURITY;
-- DROP POLICY pu_admin_insert ON platform_users;
-- DROP POLICY pu_self_update ON platform_users;
-- DROP POLICY pu_self_select ON platform_users;
-- ALTER TABLE platform_users DISABLE ROW LEVEL SECURITY;
-- (… reference table policies …)
