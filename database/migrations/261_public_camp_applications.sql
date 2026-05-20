-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 261: public camp applications.
--
-- Camps can be hosted by hospitals, blood banks, community groups, colleges,
-- corporates, and other NGOs — many of whom are not yet onboarded as
-- Raktify users. This migration relaxes donation_camps to support a public
-- self-apply path while keeping NGO review in the loop:
--
--   PE Pending review     (NEW — public submission landed)
--   PL Planned            (verified by coordinator/admin)
--   LV Live               (in progress)
--   CO Completed
--   CA Cancelled
--   DC Declined           (NEW — coordinator/admin rejected the application)
--
-- Schema changes:
--   • Status CHECK widened to include PE and DC.
--   • created_by_user_id made nullable (public submissions have no user).
--   • New columns capture the external submitter's contact details + the
--     review trail.
--   • CHECK ensures every row has either a created_by_user_id OR a public
--     submitter (name + mobile) so we can always reach back to the host.
--   • camp_create RLS extended to allow actor_role='onboarding' INSERTs
--     when status='PE' (mirrors POST /onboarding/apply pattern).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Widen the status enum
ALTER TABLE donation_camps DROP CONSTRAINT IF EXISTS donation_camps_status_check;
ALTER TABLE donation_camps
  ADD CONSTRAINT donation_camps_status_check
  CHECK (status IN ('PE','PL','LV','CO','CA','DC'));

-- 2. Relax the FK on created_by_user_id
ALTER TABLE donation_camps ALTER COLUMN created_by_user_id DROP NOT NULL;

-- 3. Add submitter + review-trail columns
ALTER TABLE donation_camps
  ADD COLUMN IF NOT EXISTS submitted_by_name          TEXT,
  ADD COLUMN IF NOT EXISTS submitted_by_mobile        CHAR(13),
  ADD COLUMN IF NOT EXISTS submitted_by_email         CITEXT,
  ADD COLUMN IF NOT EXISTS submitted_by_role          TEXT,
  ADD COLUMN IF NOT EXISTS volunteer_training_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS expected_volunteer_count   SMALLINT,
  ADD COLUMN IF NOT EXISTS review_notes               TEXT,
  ADD COLUMN IF NOT EXISTS verified_by_user_id        UUID REFERENCES platform_users(id),
  ADD COLUMN IF NOT EXISTS verified_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_reason            TEXT;

COMMENT ON COLUMN donation_camps.submitted_by_name IS
  'Public submitter name (NULL when created_by_user_id is set, i.e. staff-created)';

-- 4. Source-of-record CHECK: either staff-created or public-submitted
ALTER TABLE donation_camps DROP CONSTRAINT IF EXISTS camp_has_owner;
ALTER TABLE donation_camps
  ADD CONSTRAINT camp_has_owner
  CHECK (
    created_by_user_id IS NOT NULL
    OR (submitted_by_name IS NOT NULL AND submitted_by_mobile IS NOT NULL)
  );

-- 5. Extend RLS to allow public submissions via actor_role='onboarding'
DROP POLICY IF EXISTS camp_create ON donation_camps;
CREATE POLICY camp_create ON donation_camps FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'blood_bank')
    OR (fn_actor_role() = 'onboarding' AND status = 'PE')
  );

CREATE INDEX IF NOT EXISTS idx_camps_pending_review
  ON donation_camps(scheduled_date)
  WHERE status = 'PE';

-- ROLLBACK
-- DROP INDEX IF EXISTS idx_camps_pending_review;
-- DROP POLICY IF EXISTS camp_create ON donation_camps;
-- CREATE POLICY camp_create ON donation_camps FOR INSERT TO app_user
--   WITH CHECK (fn_is_admin() OR fn_actor_role() IN ('coordinator','blood_bank'));
-- ALTER TABLE donation_camps DROP CONSTRAINT IF EXISTS camp_has_owner;
-- ALTER TABLE donation_camps
--   DROP COLUMN IF EXISTS declined_reason,
--   DROP COLUMN IF EXISTS declined_at,
--   DROP COLUMN IF EXISTS verified_at,
--   DROP COLUMN IF EXISTS verified_by_user_id,
--   DROP COLUMN IF EXISTS review_notes,
--   DROP COLUMN IF EXISTS expected_volunteer_count,
--   DROP COLUMN IF EXISTS volunteer_training_requested,
--   DROP COLUMN IF EXISTS submitted_by_role,
--   DROP COLUMN IF EXISTS submitted_by_email,
--   DROP COLUMN IF EXISTS submitted_by_mobile,
--   DROP COLUMN IF EXISTS submitted_by_name;
-- ALTER TABLE donation_camps ALTER COLUMN created_by_user_id SET NOT NULL;
-- ALTER TABLE donation_camps DROP CONSTRAINT IF EXISTS donation_camps_status_check;
-- ALTER TABLE donation_camps
--   ADD CONSTRAINT donation_camps_status_check CHECK (status IN ('PL','LV','CO','CA'));
