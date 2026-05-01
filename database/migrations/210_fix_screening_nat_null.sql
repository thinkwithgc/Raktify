-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 210: Patch fn_screening_set_verify_flag to handle NULL nat_status.
--
-- Bug: nat_status is nullable (NAT testing is optional). The original
-- expression `... OR NEW.nat_status = 'RR'` evaluates to NULL when
-- nat_status IS NULL and all other fields are FALSE — producing a NULL
-- verification_required, which violates the NOT NULL column constraint.
--
-- Fix: wrap nat_status with a NULL-safe check. Same pattern applied to
-- fn_screening_recompute_clearance for consistency.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_screening_set_verify_flag()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.verification_required = (
    NEW.hiv_status      = 'RR' OR
    NEW.hbsag_status    = 'RR' OR
    NEW.hcv_status      = 'RR' OR
    NEW.syphilis_status = 'RR' OR
    NEW.malaria_status  = 'RR' OR
    COALESCE(NEW.nat_status, 'NR') = 'RR'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_screening_recompute_clearance()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_any_pending     BOOLEAN;
  v_any_indeterm    BOOLEAN;
  v_any_reactive    BOOLEAN;
  v_all_nr          BOOLEAN;
  v_nat             CHAR(2) := COALESCE(NEW.nat_status, 'NR');
BEGIN
  v_any_pending := (
    NEW.hiv_status = 'PE' OR NEW.hbsag_status = 'PE' OR NEW.hcv_status = 'PE'
    OR NEW.syphilis_status = 'PE' OR NEW.malaria_status = 'PE'
  );
  v_any_indeterm := (
    NEW.hiv_status = 'ID' OR NEW.hbsag_status = 'ID' OR NEW.hcv_status = 'ID'
    OR NEW.syphilis_status = 'ID' OR NEW.malaria_status = 'ID' OR v_nat = 'ID'
  );
  v_any_reactive := (
    NEW.hiv_status = 'RR' OR NEW.hbsag_status = 'RR' OR NEW.hcv_status = 'RR'
    OR NEW.syphilis_status = 'RR' OR NEW.malaria_status = 'RR' OR v_nat = 'RR'
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

-- ROLLBACK
-- (CREATE OR REPLACE FUNCTION is idempotent; no rollback needed beyond
-- restoring the prior body from 021_donor_screening.sql.)
