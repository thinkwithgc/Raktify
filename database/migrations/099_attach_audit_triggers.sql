-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 099: Attach the generic audit trigger to every Phase 1 feature
-- table created in migrations 006–035.
--
-- Why a separate migration: feature tables are created BEFORE audit_log
-- exists (audit_log is migration 025). On a fresh database, calling
-- attach_audit_trigger() inside migrations 006–024 would fail with
-- "relation audit_log does not exist". Centralising the attach calls here
-- (after both audit_log AND every feature table exist) keeps fresh-DB
-- bootstrap deterministic.
--
-- platform_users, institutions, mou_versions are already attached in 025.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT attach_audit_trigger('coordinators');
SELECT attach_audit_trigger('communities');
SELECT attach_audit_trigger('community_moderators');
SELECT attach_audit_trigger('donors');
SELECT attach_audit_trigger('institution_referrals');
SELECT attach_audit_trigger('donation_history');
-- donor_screening has its own dedicated screening_audit_log; it does NOT
-- get the generic trigger. (Spec §1.3: TTI data uses the separate KMS key
-- and separate audit log.)
SELECT attach_audit_trigger('blood_inventory');
SELECT attach_audit_trigger('thalassemia_patients');
SELECT attach_audit_trigger('rare_blood_registry');
SELECT attach_audit_trigger('blood_requests');
SELECT attach_audit_trigger('request_assignments');
SELECT attach_audit_trigger('request_documents');
SELECT attach_audit_trigger('donor_alerts');
-- escalation_log is itself an audit-style log; do not double-audit it.
SELECT attach_audit_trigger('request_threads');
SELECT attach_audit_trigger('donation_camps');
-- notification_log is high-volume operational; auditing every send would
-- explode audit_log. We rely on notification_log itself as the source of
-- truth for outbound comms. Audit only opt-out flips via the existing trigger.
SELECT attach_audit_trigger('lookback_registry');

-- ── Donor consent protection (spec §3 trg_consent_protect) ────────────────
-- Only the donor themselves (actor_role='donor' AND actor_user_id == this
-- donor's platform_user_id) can flip consent_data_use. ngo_admin and
-- super_admin can flip it OFF (compliance withdrawal) but not ON.
CREATE OR REPLACE FUNCTION fn_consent_protect()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_actor_role TEXT;
  v_actor_uid  UUID;
BEGIN
  IF NEW.consent_data_use IS DISTINCT FROM OLD.consent_data_use THEN
    v_actor_role := nullif(current_setting('raktify.actor_role', TRUE), '');
    BEGIN v_actor_uid := nullif(current_setting('raktify.actor_user_id', TRUE), '')::uuid;
          EXCEPTION WHEN OTHERS THEN v_actor_uid := NULL; END;

    IF NEW.consent_data_use = TRUE THEN
      -- Granting consent must be self-initiated.
      IF v_actor_role <> 'donor' OR v_actor_uid IS NULL OR v_actor_uid <> NEW.platform_user_id THEN
        RAISE EXCEPTION 'consent_data_use can only be granted by the donor themselves';
      END IF;
    ELSE
      -- Revoking consent: donor self OR ngo_admin / super_admin.
      IF NOT (
        (v_actor_role = 'donor' AND v_actor_uid = NEW.platform_user_id)
        OR v_actor_role IN ('ngo_admin','super_admin')
      ) THEN
        RAISE EXCEPTION 'consent_data_use can only be revoked by the donor or an admin';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_donors_consent_protect
  BEFORE UPDATE OF consent_data_use ON donors
  FOR EACH ROW EXECUTE FUNCTION fn_consent_protect();

-- ROLLBACK
-- DROP TRIGGER trg_donors_consent_protect ON donors;
-- DROP FUNCTION fn_consent_protect;
-- (Audit triggers can be dropped per-table via DROP TRIGGER trg_audit_<name> ON <name>.)
