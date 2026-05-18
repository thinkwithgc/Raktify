-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 200: Row Level Security policies for Phase 1 feature tables
-- (006-035). Extends 100_rls_phase1.sql which covered the foundational tables.
--
-- Role conventions used by these policies (set via SET LOCAL on each
-- transaction by backend/src/middleware/rlsContext.js):
--   donor          — own row only on donors / donor_alerts; never PII of others
--   coordinator    — district-scoped reads; restricted donor PII via mask view
--   blood_bank     — own institution-scoped inventory + donor screening; donor PII fenced
--   hospital       — own requests + counts only; never bag-level inventory; never donor PII
--   ngo_admin      — read all except screening_audit_log
--   super_admin    — read all; never UPDATE/DELETE on audit_log or screening_audit_log
--
-- Pattern — current_setting('raktify.actor_role', TRUE) is the role,
-- 'raktify.actor_user_id' is the user, 'raktify.actor_institution_id'
-- is the staff user's institution (NULL for donor / coordinator / admins).
-- ─────────────────────────────────────────────────────────────────────────────

-- Helpers to keep policy bodies short.
CREATE OR REPLACE FUNCTION fn_actor_role() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('raktify.actor_role', TRUE), '')
$$;
CREATE OR REPLACE FUNCTION fn_actor_user_id() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('raktify.actor_user_id', TRUE), '')::uuid
$$;
CREATE OR REPLACE FUNCTION fn_actor_institution_id() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('raktify.actor_institution_id', TRUE), '')::uuid
$$;
CREATE OR REPLACE FUNCTION fn_is_admin() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT fn_actor_role() IN ('ngo_admin','super_admin')
$$;

-- ── coordinators ─────────────────────────────────────────────────────────
ALTER TABLE coordinators ENABLE ROW LEVEL SECURITY;

CREATE POLICY coord_read ON coordinators FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR platform_user_id = fn_actor_user_id()                         -- self
    OR fn_actor_role() IN ('coordinator','hospital','blood_bank')    -- discoverable by other ops
  );

CREATE POLICY coord_self_or_admin_update ON coordinators FOR UPDATE TO app_user
  USING (fn_is_admin() OR platform_user_id = fn_actor_user_id())
  WITH CHECK (fn_is_admin() OR platform_user_id = fn_actor_user_id());

CREATE POLICY coord_admin_insert ON coordinators FOR INSERT TO app_user
  WITH CHECK (fn_is_admin() OR fn_actor_role() = 'registration');

-- ── communities + community_moderators ───────────────────────────────────
ALTER TABLE communities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_moderators ENABLE ROW LEVEL SECURITY;

CREATE POLICY comm_read ON communities FOR SELECT TO app_user
  USING (
    is_public = TRUE OR fn_is_admin()
    OR EXISTS (
      SELECT 1 FROM coordinators c
       WHERE c.platform_user_id = fn_actor_user_id()
         AND (c.id = communities.owner_coordinator_id
              OR EXISTS (SELECT 1 FROM community_moderators m
                          WHERE m.community_id = communities.id
                            AND m.coordinator_id = c.id))
    )
  );

CREATE POLICY comm_owner_update ON communities FOR UPDATE TO app_user
  USING (
    fn_is_admin() OR EXISTS (
      SELECT 1 FROM coordinators c
       WHERE c.id = communities.owner_coordinator_id
         AND c.platform_user_id = fn_actor_user_id()
    )
  );

CREATE POLICY comm_coord_insert ON communities FOR INSERT TO app_user
  WITH CHECK (fn_is_admin() OR fn_actor_role() = 'coordinator');

CREATE POLICY commod_read ON community_moderators FOR SELECT TO app_user
  USING (TRUE);
CREATE POLICY commod_owner_write ON community_moderators FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin() OR EXISTS (
      SELECT 1 FROM communities c JOIN coordinators co ON co.id = c.owner_coordinator_id
       WHERE c.id = community_moderators.community_id
         AND co.platform_user_id = fn_actor_user_id()
    )
  );

-- ── donors ───────────────────────────────────────────────────────────────
-- Donors see only their own row. Coordinators see a restricted projection (mask
-- the mobile by handling at the API layer; RLS only gates row-existence).
-- Blood banks see donors only via the join chain (donations they've made for).
-- Hospitals see ZERO donor PII rows.
ALTER TABLE donors ENABLE ROW LEVEL SECURITY;

CREATE POLICY donors_self ON donors FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR platform_user_id = fn_actor_user_id()
    OR (fn_actor_role() = 'coordinator' AND is_active = TRUE)
    OR (fn_actor_role() = 'blood_bank'
        AND EXISTS (SELECT 1 FROM donation_history dh
                     WHERE dh.donor_id = donors.id
                       AND dh.blood_bank_id = fn_actor_institution_id()))
  );

CREATE POLICY donors_self_update ON donors FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR platform_user_id = fn_actor_user_id()
  )
  WITH CHECK (
    fn_is_admin()
    OR platform_user_id = fn_actor_user_id()
  );

CREATE POLICY donors_register ON donors FOR INSERT TO app_user
  WITH CHECK (fn_actor_role() IN ('registration','ngo_admin','super_admin','coordinator'));

-- ── institution_referrals ────────────────────────────────────────────────
ALTER TABLE institution_referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY refer_donor_self ON institution_referrals FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR primary_referrer_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id())
    OR fn_actor_role() = 'coordinator'
  );

CREATE POLICY refer_donor_create ON institution_referrals FOR INSERT TO app_user
  WITH CHECK (fn_actor_role() IN ('donor','coordinator','ngo_admin','super_admin'));

CREATE POLICY refer_admin_update ON institution_referrals FOR UPDATE TO app_user
  USING (fn_is_admin() OR fn_actor_role() = 'coordinator')
  WITH CHECK (fn_is_admin() OR fn_actor_role() = 'coordinator');

-- ── donation_history ─────────────────────────────────────────────────────
ALTER TABLE donation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY dh_self_blood_bank_admin ON donation_history FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR donor_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id())
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
    OR fn_actor_role() = 'coordinator'
  );
CREATE POLICY dh_blood_bank_insert ON donation_history FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
    OR fn_actor_role() IN ('donor','coordinator')   -- self-report (trust_level='S')
  );
CREATE POLICY dh_blood_bank_update ON donation_history FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  );

-- ── donor_screening (most restricted) ────────────────────────────────────
ALTER TABLE donor_screening ENABLE ROW LEVEL SECURITY;

CREATE POLICY scr_blood_bank_own ON donor_screening FOR SELECT TO bb_writer
  USING (blood_bank_id = fn_actor_institution_id());
CREATE POLICY scr_admin ON donor_screening FOR SELECT TO bb_writer
  USING (fn_actor_role() = 'super_admin'
         AND nullif(current_setting('raktify.access_reason', TRUE), '') IS NOT NULL);

CREATE POLICY scr_blood_bank_insert ON donor_screening FOR INSERT TO bb_writer
  WITH CHECK (
    fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id()
  );

CREATE POLICY scr_blood_bank_update ON donor_screening FOR UPDATE TO bb_writer
  USING (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  WITH CHECK (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id());

-- screening_audit_log: super_admin only, requires access_reason GUC.
ALTER TABLE screening_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY scr_audit_super_admin ON screening_audit_log FOR SELECT TO audit_writer
  USING (
    fn_actor_role() = 'super_admin'
    AND nullif(current_setting('raktify.access_reason', TRUE), '') IS NOT NULL
  );

-- ── blood_inventory ──────────────────────────────────────────────────────
ALTER TABLE blood_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY inv_bb_own ON blood_inventory FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
    OR fn_actor_role() = 'coordinator'
    -- hospitals see counts only — those views aggregate, so no row-level access needed.
  );

CREATE POLICY inv_bb_write ON blood_inventory FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  );

CREATE POLICY inv_bb_update ON blood_inventory FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  )
  WITH CHECK (
    fn_is_admin()
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  );

-- ── thalassemia_patients ─────────────────────────────────────────────────
ALTER TABLE thalassemia_patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY thal_treating_or_admin ON thalassemia_patients FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR (fn_actor_role() = 'hospital' AND treating_hospital_id = fn_actor_institution_id())
    OR fn_actor_role() = 'coordinator'
  );
CREATE POLICY thal_admin_write ON thalassemia_patients FOR INSERT TO app_user
  WITH CHECK (fn_is_admin() OR fn_actor_role() = 'coordinator' OR fn_actor_role() = 'hospital');
CREATE POLICY thal_admin_update ON thalassemia_patients FOR UPDATE TO app_user
  USING (fn_is_admin() OR fn_actor_role() = 'coordinator' OR fn_actor_role() = 'hospital');

-- ── rare_blood_registry ──────────────────────────────────────────────────
ALTER TABLE rare_blood_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY rare_read ON rare_blood_registry FOR SELECT TO app_user
  USING (fn_is_admin() OR fn_actor_role() IN ('coordinator','blood_bank'));
CREATE POLICY rare_admin_insert ON rare_blood_registry FOR INSERT TO app_user
  WITH CHECK (fn_is_admin() OR fn_actor_role() = 'blood_bank');
CREATE POLICY rare_admin_update ON rare_blood_registry FOR UPDATE TO app_user
  USING (fn_is_admin() OR fn_actor_role() = 'blood_bank');

-- ── blood_requests ───────────────────────────────────────────────────────
ALTER TABLE blood_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY req_actors ON blood_requests FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR (fn_actor_role() = 'hospital' AND requesting_institution_id = fn_actor_institution_id())
    OR (fn_actor_role() = 'coordinator')
    OR (fn_actor_role() = 'donor' AND requesting_user_id = fn_actor_user_id())
    OR (fn_actor_role() = 'blood_bank' AND matched_blood_bank_id = fn_actor_institution_id())
  );

CREATE POLICY req_create ON blood_requests FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR (fn_actor_role() = 'hospital' AND requesting_institution_id = fn_actor_institution_id())
    OR fn_actor_role() IN ('coordinator','donor')
  );

CREATE POLICY req_update ON blood_requests FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR (fn_actor_role() = 'hospital' AND requesting_institution_id = fn_actor_institution_id())
    OR fn_actor_role() IN ('coordinator','blood_bank')
  );

-- ── request_assignments ──────────────────────────────────────────────────
ALTER TABLE request_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY assign_read ON request_assignments FOR SELECT TO app_user
  USING (fn_is_admin() OR fn_actor_role() IN ('coordinator','hospital','blood_bank'));
CREATE POLICY assign_write ON request_assignments FOR INSERT TO app_user
  WITH CHECK (fn_is_admin() OR fn_actor_role() = 'coordinator');
CREATE POLICY assign_update ON request_assignments FOR UPDATE TO app_user
  USING (fn_is_admin() OR fn_actor_role() = 'coordinator');

-- ── request_documents ────────────────────────────────────────────────────
ALTER TABLE request_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_read ON request_documents FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator','blood_bank')
    OR EXISTS (
      SELECT 1 FROM blood_requests br
       WHERE br.id = request_documents.request_id
         AND ((fn_actor_role() = 'hospital' AND br.requesting_institution_id = fn_actor_institution_id())
              OR (fn_actor_role() = 'donor' AND br.requesting_user_id = fn_actor_user_id()))
    )
  );
CREATE POLICY doc_insert ON request_documents FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin() OR fn_actor_role() IN ('hospital','coordinator','donor')
  );

-- ── donor_alerts ─────────────────────────────────────────────────────────
ALTER TABLE donor_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY alert_read ON donor_alerts FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR donor_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id())
    OR fn_actor_role() = 'coordinator'
  );
CREATE POLICY alert_write ON donor_alerts FOR INSERT TO app_user
  WITH CHECK (fn_is_admin() OR fn_actor_role() IN ('coordinator','registration'));
CREATE POLICY alert_update ON donor_alerts FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR donor_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id())
    OR fn_actor_role() = 'coordinator'
  );

-- ── escalation_log (insert-only by API; reads broad) ─────────────────────
ALTER TABLE escalation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY esc_read ON escalation_log FOR SELECT TO app_user
  USING (fn_is_admin() OR fn_actor_role() IN ('coordinator','hospital','blood_bank'));
CREATE POLICY esc_write ON escalation_log FOR INSERT TO app_user
  WITH CHECK (fn_is_admin() OR fn_actor_role() = 'coordinator' OR fn_actor_role() = 'system');

-- ── request_threads ──────────────────────────────────────────────────────
ALTER TABLE request_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY thr_read ON request_threads FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR (fn_actor_role() = ANY(visible_to_roles))
  );
CREATE POLICY thr_write ON request_threads FOR INSERT TO app_user
  WITH CHECK (fn_actor_role() IS NOT NULL);
CREATE POLICY thr_update_own ON request_threads FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR author_user_id = fn_actor_user_id()
  );

-- ── donation_camps ───────────────────────────────────────────────────────
ALTER TABLE donation_camps ENABLE ROW LEVEL SECURITY;
CREATE POLICY camp_read ON donation_camps FOR SELECT TO app_user USING (TRUE);
CREATE POLICY camp_create ON donation_camps FOR INSERT TO app_user
  WITH CHECK (fn_is_admin() OR fn_actor_role() IN ('coordinator','blood_bank'));
CREATE POLICY camp_update ON donation_camps FOR UPDATE TO app_user
  USING (fn_is_admin() OR fn_actor_role() IN ('coordinator','blood_bank'));

-- ── notification_log ─────────────────────────────────────────────────────
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_admin_read ON notification_log FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR recipient_donor_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id())
    OR recipient_user_id  = fn_actor_user_id()
    OR fn_actor_role() = 'coordinator'
  );
CREATE POLICY notif_system_insert ON notification_log FOR INSERT TO app_user
  WITH CHECK (fn_actor_role() IS NOT NULL);
CREATE POLICY notif_webhook_update ON notification_log FOR UPDATE TO app_user
  USING (fn_is_admin() OR fn_actor_role() IN ('webhook','system','coordinator'));

-- ── lookback_registry ────────────────────────────────────────────────────
ALTER TABLE lookback_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY lb_admin_only_read ON lookback_registry FOR SELECT TO app_user
  USING (fn_is_admin());
CREATE POLICY lb_system_insert ON lookback_registry FOR INSERT TO app_user
  WITH CHECK (TRUE);  -- inserts are trigger-driven; no role gating
CREATE POLICY lb_admin_update ON lookback_registry FOR UPDATE TO app_user
  USING (fn_is_admin());

-- ROLLBACK
-- (Drop all policies and disable RLS on each table; full sequence omitted for brevity.)
