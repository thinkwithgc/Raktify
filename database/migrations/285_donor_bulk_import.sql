-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 285: bulk-import support for donors.
--
-- Per Phase 4c design: ngo_admin + blood_bank can upload CSVs of legacy
-- donors (existing BB records, community lists). Imported rows are
-- INERT — no outbound notification, no matching engine inclusion —
-- until the donor next walks in for a donation OR self-activates via
-- the web register. Then they complete pre-screening + consent + KYC.
--
-- Schema changes:
--   1. Add 'IMP' to registration_source CHECK (ngo_admin imports);
--      'BBK' (existing) covers blood-bank-side imports.
--   2. Relax date_of_birth NOT NULL — many legacy records won't have it.
--      Donor completes at next donation.
--   3. Relax gender NOT NULL — same reason.
--
-- Clinical-safety implication: the matching engine MUST skip donors
-- with NULL date_of_birth (can't compute eligibility) and NULL gender
-- (gender-specific Hb thresholds). The "inert until activated" rule
-- (consent_data_use=FALSE) already excludes them, but defence-in-depth
-- is to ALSO filter on DOB+gender NOT NULL. Verified at the engine.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add 'IMP' to registration_source enum.
ALTER TABLE donors DROP CONSTRAINT IF EXISTS donors_registration_source_check;
ALTER TABLE donors
  ADD CONSTRAINT donors_registration_source_check CHECK (
    registration_source IN ('QRC','WAB','WEB','APP','BBK','CAM','IMP')
  );

-- 2. Relax DOB NOT NULL.
ALTER TABLE donors ALTER COLUMN date_of_birth DROP NOT NULL;

-- 3. Relax gender NOT NULL. Existing CHECK on values stays.
ALTER TABLE donors ALTER COLUMN gender DROP NOT NULL;

COMMENT ON COLUMN donors.date_of_birth IS
  'May be NULL for bulk-imported donors (registration_source IN (BBK,IMP)). Donor completes at next donation. Matching engine excludes NULL DOB rows because age determines eligibility.';
COMMENT ON COLUMN donors.gender IS
  'May be NULL for bulk-imported donors. Donor completes at next donation. Matching engine excludes NULL gender rows because gender-specific Hb thresholds apply.';

-- ROLLBACK
-- ALTER TABLE donors ALTER COLUMN gender       SET NOT NULL;
-- ALTER TABLE donors ALTER COLUMN date_of_birth SET NOT NULL;
-- ALTER TABLE donors DROP CONSTRAINT IF EXISTS donors_registration_source_check;
-- ALTER TABLE donors
--   ADD CONSTRAINT donors_registration_source_check CHECK (
--     registration_source IN ('QRC','WAB','WEB','APP','BBK','CAM')
--   );
