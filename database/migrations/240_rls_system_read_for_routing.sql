-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 240: Allow the 'system' actor role to SELECT donors and
-- platform_users for delivery routing in services/notifications.
--
-- The notification chokepoint resolves a recipient ID/mobile to the right
-- recipient_* foreign-key column on notification_log. That lookup needs
-- to read donors + platform_users, but the existing SELECT policies don't
-- list the system role.
--
-- Scope: SELECT only. Writes are still gated as before.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS donors_self ON donors;
CREATE POLICY donors_self ON donors FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() = 'system'
    OR platform_user_id = fn_actor_user_id()
    OR (fn_actor_role() = 'coordinator' AND is_active = TRUE)
    OR (
      fn_actor_role() = 'blood_bank'
      AND EXISTS (
        SELECT 1 FROM donation_history dh
         WHERE dh.donor_id = donors.id
           AND dh.blood_bank_id = fn_actor_institution_id()
      )
    )
  );

-- platform_users: extend pu_self_select to permit 'system'.
DROP POLICY IF EXISTS pu_self_select ON platform_users;
CREATE POLICY pu_self_select ON platform_users FOR SELECT TO app_user
  USING (
    id::text = current_setting('raktify.actor_user_id', TRUE)
    OR current_setting('raktify.actor_role', TRUE) IN ('ngo_admin','super_admin','system')
  );

-- ROLLBACK
-- (Restore prior bodies from 200_rls_phase1_extra and 100_rls_phase1.)
