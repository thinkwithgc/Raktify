-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 021: donor_screening — TTI (Transfusion-Transmitted Infection)
-- results. The most restricted table in the schema.
--
-- (Spec migration 011 — renumbered to 021 due to 011_grant_schema_to_helpers.)
--
-- Sensitivity: TTI status is medical PII of the highest order. Per spec §1.3:
--   - Encrypted at rest with the SEPARATE screening KMS key (not the main key)
--   - Has its OWN audit log (screening_audit_log, migration 022) — every
--     SELECT is logged, every UPDATE is logged with mandatory access_reason
--   - Visible only to the blood bank that performed the test, plus
--     super_admin (who must record an access_reason)
--   - Coordinators have ZERO access. Hospitals have ZERO access. Donor sees
--     only the aggregate overall_clearance — never individual TTI fields.
--
-- Test fields per NBTC mandatory panel (DCG(I) order):
--   HIV (1+2 combined Ag/Ab)
--   HBsAg (Hepatitis B surface antigen)
--   HCV (Hepatitis C antibody)
--   Syphilis (RPR/VDRL or TPHA)
--   Malaria (rapid antigen)
--   NAT (Nucleic Acid Testing) — optional, where available
--
-- Result codes (per field):
--   PE Pending      NR Non-reactive
--   RR Reactive     ID Indeterminate
--
-- Four-eyes verification: when ANY field is RR (Reactive), the row stays at
-- overall_clearance='PE' until a SECOND blood-bank user (verified_by !=
-- entered_by) confirms via /donations/:id/screening/verify. Only then does
-- the lookback protocol fire.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE donor_screening (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id              UUID NOT NULL UNIQUE REFERENCES donation_history(id),
  donor_id                 UUID NOT NULL REFERENCES donors(id),    -- denormalized
  blood_bank_id            UUID NOT NULL REFERENCES institutions(id),

  -- Mandatory NBTC TTI panel
  hiv_status               CHAR(2) NOT NULL DEFAULT 'PE'
                           CHECK (hiv_status IN ('PE','NR','RR','ID')),
  hbsag_status             CHAR(2) NOT NULL DEFAULT 'PE'
                           CHECK (hbsag_status IN ('PE','NR','RR','ID')),
  hcv_status               CHAR(2) NOT NULL DEFAULT 'PE'
                           CHECK (hcv_status IN ('PE','NR','RR','ID')),
  syphilis_status          CHAR(2) NOT NULL DEFAULT 'PE'
                           CHECK (syphilis_status IN ('PE','NR','RR','ID')),
  malaria_status           CHAR(2) NOT NULL DEFAULT 'PE'
                           CHECK (malaria_status IN ('PE','NR','RR','ID')),

  -- Optional / advanced
  nat_status               CHAR(2) CHECK (nat_status IN ('PE','NR','RR','ID')),
  nat_target               TEXT,                                    -- HIV / HBV / HCV (or all three)

  -- Encrypted lab metadata
  hiv_method               TEXT,                                    -- encrypted (kit / lot)
  hbsag_method             TEXT,                                    -- encrypted
  hcv_method               TEXT,                                    -- encrypted
  syphilis_method          TEXT,                                    -- encrypted
  malaria_method           TEXT,                                    -- encrypted
  nat_method               TEXT,                                    -- encrypted

  -- Aggregate
  overall_clearance        CHAR(2) NOT NULL DEFAULT 'PE'
                           CHECK (overall_clearance IN ('PE','CL','IN','HD')),
  -- PE Pending  CL Cleared  IN Indeterminate  HD Held (admin hold)

  -- Four-eyes
  entered_by               UUID NOT NULL REFERENCES platform_users(id),
  entered_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by              UUID REFERENCES platform_users(id),       -- different person from entered_by
  verified_at              TIMESTAMPTZ,
  verification_required    BOOLEAN NOT NULL DEFAULT FALSE,           -- TRUE when any field is RR

  -- Lookback trigger marker — set by trg_screening_clearance when
  -- overall_clearance becomes IN.
  triggered_lookback_at    TIMESTAMPTZ,

  notes                    TEXT,                                     -- encrypted

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT four_eyes_distinct CHECK (
    verified_by IS NULL OR verified_by <> entered_by
  ),
  CONSTRAINT verified_at_consistent CHECK (
    (verified_by IS NULL AND verified_at IS NULL) OR
    (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE INDEX idx_screening_donor          ON donor_screening(donor_id);
CREATE INDEX idx_screening_blood_bank     ON donor_screening(blood_bank_id);
CREATE INDEX idx_screening_pending_verify ON donor_screening(blood_bank_id)
  WHERE verification_required = TRUE AND verified_by IS NULL;

-- Maintain verification_required flag whenever any TTI field is RR.
CREATE OR REPLACE FUNCTION fn_screening_set_verify_flag()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.verification_required = (
    NEW.hiv_status      = 'RR' OR
    NEW.hbsag_status    = 'RR' OR
    NEW.hcv_status      = 'RR' OR
    NEW.syphilis_status = 'RR' OR
    NEW.malaria_status  = 'RR' OR
    NEW.nat_status      = 'RR'
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_screening_set_verify_flag
  BEFORE INSERT OR UPDATE OF hiv_status, hbsag_status, hcv_status,
                              syphilis_status, malaria_status, nat_status
  ON donor_screening
  FOR EACH ROW EXECUTE FUNCTION fn_screening_set_verify_flag();

-- Recalculate overall_clearance. Spec §3 trg_screening_clearance.
-- Rules:
--   - Any RR (and verified) → IN (indeterminate-positive). Lookback triggers.
--   - Any ID, PE, or unverified RR → PE.
--   - All NR → CL.
CREATE OR REPLACE FUNCTION fn_screening_recompute_clearance()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_any_pending     BOOLEAN;
  v_any_indeterm    BOOLEAN;
  v_any_reactive    BOOLEAN;
  v_all_nr          BOOLEAN;
BEGIN
  v_any_pending := (
    NEW.hiv_status = 'PE' OR NEW.hbsag_status = 'PE' OR NEW.hcv_status = 'PE'
    OR NEW.syphilis_status = 'PE' OR NEW.malaria_status = 'PE'
  );
  v_any_indeterm := (
    NEW.hiv_status = 'ID' OR NEW.hbsag_status = 'ID' OR NEW.hcv_status = 'ID'
    OR NEW.syphilis_status = 'ID' OR NEW.malaria_status = 'ID' OR NEW.nat_status = 'ID'
  );
  v_any_reactive := (
    NEW.hiv_status = 'RR' OR NEW.hbsag_status = 'RR' OR NEW.hcv_status = 'RR'
    OR NEW.syphilis_status = 'RR' OR NEW.malaria_status = 'RR' OR NEW.nat_status = 'RR'
  );
  v_all_nr := (
    NEW.hiv_status = 'NR' AND NEW.hbsag_status = 'NR' AND NEW.hcv_status = 'NR'
    AND NEW.syphilis_status = 'NR' AND NEW.malaria_status = 'NR'
    AND (NEW.nat_status IS NULL OR NEW.nat_status = 'NR')
  );

  IF v_any_reactive AND NEW.verified_by IS NOT NULL THEN
    NEW.overall_clearance = 'IN';
    IF NEW.triggered_lookback_at IS NULL THEN
      NEW.triggered_lookback_at = clock_timestamp();
    END IF;
  ELSIF v_any_pending OR v_any_indeterm OR v_any_reactive THEN
    NEW.overall_clearance = 'PE';
  ELSIF v_all_nr THEN
    NEW.overall_clearance = 'CL';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_screening_recompute_clearance
  BEFORE INSERT OR UPDATE OF hiv_status, hbsag_status, hcv_status,
                              syphilis_status, malaria_status, nat_status,
                              verified_by, verified_at
  ON donor_screening
  FOR EACH ROW EXECUTE FUNCTION fn_screening_recompute_clearance();

-- Permissions: NO direct app_user read/write. Only the bb_writer role plus
-- ngo_admin/super_admin (controlled in 200_rls). Setting the table base GRANT
-- to no one prevents accidental leakage.
REVOKE ALL ON donor_screening FROM app_user;
GRANT SELECT, INSERT, UPDATE ON donor_screening TO bb_writer;

-- ROLLBACK
-- DROP TRIGGER trg_screening_recompute_clearance ON donor_screening;
-- DROP FUNCTION fn_screening_recompute_clearance;
-- DROP TRIGGER trg_screening_set_verify_flag ON donor_screening;
-- DROP FUNCTION fn_screening_set_verify_flag;
-- DROP TABLE donor_screening;
