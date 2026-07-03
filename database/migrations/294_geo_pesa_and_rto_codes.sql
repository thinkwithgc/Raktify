-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 294: Geographic metadata refinements
--
-- 1. villages.is_pesa
--    LGD's Villagecode export ships a "Pesa Status" column (Y / N). PESA =
--    Panchayats (Extension to Scheduled Areas) Act, 1996. In Amravati district
--    this flags Melghat (Chikhaldara + Dharni talukas) — a Schedule V tribal
--    area. Cheap to record, high value for CSR reporting + DHO governance
--    ("% Scheduled Area coverage") + optional tribal-outreach filters later.
--
-- 2. districts.rto_codes_all
--    district_code_short is already the "canonical" 4-char district code used
--    in blood-request refs (BC-YYYY-MH27-NNNNN). We adopt the RTO code as
--    that canonical value (MH27 for Amravati). But ~12 populous districts in
--    India hold multiple RTO codes (Amravati = MH27 + MH37, Mumbai City = MH01
--    + MH02 + MH03, etc.). rto_codes_all[] records the alternates so a
--    hospital in Achalpur (MH37) can still be mapped to the same district
--    row (490) without a duplicate district.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. villages.is_pesa ────────────────────────────────────────────────────────
ALTER TABLE villages
  ADD COLUMN IF NOT EXISTS is_pesa BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — most villages are non-PESA; only the small set is queried.
CREATE INDEX IF NOT EXISTS idx_villages_pesa
  ON villages(is_pesa)
  WHERE is_pesa = TRUE;

COMMENT ON COLUMN villages.is_pesa IS
  'LGD PESA Status F or P. Village lies in a Schedule V Scheduled Area under the Panchayats (Extension to Scheduled Areas) Act 1996. Used for CSR reporting and DHO tribal-coverage metrics.';

-- 2. districts.rto_codes_all ─────────────────────────────────────────────────
ALTER TABLE districts
  ADD COLUMN IF NOT EXISTS rto_codes_all TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN districts.rto_codes_all IS
  'Every RTO code that maps to this LGD district. district_code_short is the canonical/main RTO code used in BC-YYYY-DIST-NNNNN refs; rto_codes_all keeps the alternates (e.g. Amravati main = MH27, Achalpur = MH37). Empty array means the district has not been onboarded yet.';

-- GIN index — small array per row, cheap. Enables IN-lookups when an inbound
-- hospital form arrives with any RTO code from a multi-code district.
CREATE INDEX IF NOT EXISTS idx_districts_rto_codes
  ON districts USING gin (rto_codes_all);

COMMIT;

-- ROLLBACK:
--   BEGIN;
--   DROP INDEX IF EXISTS idx_districts_rto_codes;
--   ALTER TABLE districts DROP COLUMN IF EXISTS rto_codes_all;
--   DROP INDEX IF EXISTS idx_villages_pesa;
--   ALTER TABLE villages DROP COLUMN IF EXISTS is_pesa;
--   COMMIT;
