-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 303: citizen-raised requests + onboarded-hospital confirmation
--
-- Founder decision (this session): until every hospital is onboarded ("golden
-- era"), a donor/citizen may raise a blood request on a patient's behalf and
-- either (a) PICK an already-onboarded hospital, or (b) NAME a hospital that
-- isn't on Raktify yet. Path (b) is the growth flywheel — the named hospital
-- becomes an institution_referrals onboarding lead (that table already models
-- referrer_count / referrer_donor_ids / funnel_status).
--
-- Path (a) needs the named hospital to CONFIRM the clinical need before the
-- request behaves like a real hospital request (a citizen is asserting a need on
-- the hospital's behalf — the hospital is the clinical authority). Hence a
-- confirmation gate: PE pending → OK confirmed (runs the matcher) / RJ rejected
-- (request cancelled). Path (b) keeps the existing CI coordinator-verify gate.
--
-- This migration only adds the columns + the referral-dedup index; the flow
-- lives in the app layer (routes/requests.js).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE blood_requests
  ADD COLUMN citizen_raised BOOLEAN NOT NULL DEFAULT FALSE,
  -- Only set when a citizen request PICKED an onboarded hospital:
  --   PE pending hospital confirmation · OK confirmed · RJ rejected
  ADD COLUMN hospital_confirmation_status CHAR(2)
      CHECK (hospital_confirmation_status IS NULL
             OR hospital_confirmation_status IN ('PE','OK','RJ')),
  ADD COLUMN hospital_confirmed_at TIMESTAMPTZ,
  ADD COLUMN hospital_confirmed_by UUID REFERENCES platform_users(id),
  -- The onboarding lead a NAMED-hospital citizen request generated (path b).
  ADD COLUMN referral_id UUID REFERENCES institution_referrals(id);

COMMENT ON COLUMN blood_requests.citizen_raised IS
  'Request originated by a donor/citizen on a patient''s behalf (Tier CI). Either '
  'names an onboarded hospital (hospital_confirmation_status set) or a new one '
  '(referral_id set).';

-- The hospital''s "raised on your behalf — confirm?" queue.
CREATE INDEX idx_requests_awaiting_hospital_confirm
  ON blood_requests (requesting_institution_id)
  WHERE hospital_confirmation_status = 'PE';

-- Dedup onboarding leads: many relatives of patients at the same un-onboarded
-- hospital must produce ONE lead with a rising referrer_count, not many leads.
-- Scoped to still-open leads (not yet onboarded) so a fresh lead can be opened
-- if an onboarded hospital ever churns off.
CREATE UNIQUE INDEX uq_referral_open_target
  ON institution_referrals (target_kind, lower(target_name), target_district_id)
  WHERE onboarded_institution_id IS NULL;

-- ROLLBACK
-- DROP INDEX IF EXISTS uq_referral_open_target;
-- DROP INDEX IF EXISTS idx_requests_awaiting_hospital_confirm;
-- ALTER TABLE blood_requests
--   DROP COLUMN referral_id, DROP COLUMN hospital_confirmed_by,
--   DROP COLUMN hospital_confirmed_at, DROP COLUMN hospital_confirmation_status,
--   DROP COLUMN citizen_raised;
