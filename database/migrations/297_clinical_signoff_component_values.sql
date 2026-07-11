-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 297: clinical sign-off — component Hb + gender-based donation gap
--
-- Applies the haematologist's answers (Medical Review, 10-Jul-2026) to the
-- reference data that was seeded provisionally. The compatibility matrix
-- (002c) was confirmed AS-IS (no change). This migration promotes the two
-- values the advisor changed:
--
--   1. Minimum donor Hb = 12.5 g/dL for BOTH genders, every component
--      (was M 13.0 / F 12.5, and F 11.5 for platelets).
--   2. Whole-blood donation interval is gender-based: 90 days (male) /
--      120 days (female). Plateletpheresis (SDP) may be repeated after
--      48 hours. (RDP / random platelets unchanged at 14 days.)
--
-- The gap was a single per-component `min_gap_days`; a female-specific
-- `min_gap_days_female` column is added and the next-eligible-date trigger
-- is made gender-aware. NOTE (advisor): SDP is additionally capped at
-- ≤2/week and ≤4/month — that rate limit is a documented follow-up, not
-- modelled here; the blood bank enforces it at the apheresis chair.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Minimum donor Hb → 12.5 g/dL for both genders, all components.
UPDATE blood_components SET min_donor_hb_male = 12.5, min_donor_hb_female = 12.5;

-- 2. Gender-based donation interval.
ALTER TABLE blood_components ADD COLUMN min_gap_days_female SMALLINT;

-- Default the female gap to the existing (male) gap, then apply the split.
UPDATE blood_components SET min_gap_days_female = min_gap_days;
-- Whole-blood-derived components: 90 d male / 120 d female.
UPDATE blood_components SET min_gap_days_female = 120 WHERE code IN ('WB', 'PRBC', 'FFP', 'CRYO');
-- Plateletpheresis (SDP): 48 h (= 2 days) for both genders.
UPDATE blood_components SET min_gap_days = 2, min_gap_days_female = 2 WHERE code = 'SDP';

ALTER TABLE blood_components
  ALTER COLUMN min_gap_days_female SET NOT NULL,
  ADD CONSTRAINT min_gap_days_female_positive CHECK (min_gap_days_female > 0);

-- 3. Make the next-eligible-date trigger gender-aware. Replaces the function
--    from migration 020 (which used min_gap_days for everyone).
CREATE OR REPLACE FUNCTION fn_donations_update_donor_eligibility()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_min_gap SMALLINT;
  v_gender  CHAR(1);
BEGIN
  -- Only verified donations gate next_eligible_date.
  IF NEW.trust_level <> 'V' THEN
    RETURN NEW;
  END IF;

  SELECT gender INTO v_gender FROM donors WHERE id = NEW.donor_id;

  -- 'M' → male interval; 'F' and 'O'/unknown → the longer female interval
  -- (safer default, and consistent with the gender branch in validate.js).
  SELECT CASE WHEN v_gender = 'M' THEN min_gap_days ELSE min_gap_days_female END
    INTO v_min_gap
    FROM blood_components WHERE id = NEW.component_id;

  UPDATE donors
     SET total_donations  = total_donations + 1,
         total_units_ml   = total_units_ml + NEW.volume_ml,
         next_eligible_date = GREATEST(
                                COALESCE(next_eligible_date, '1970-01-01'::date),
                                NEW.collection_date + (v_min_gap * INTERVAL '1 day')
                              )::date,
         updated_at = clock_timestamp()
   WHERE id = NEW.donor_id;

  RETURN NEW;
END;
$$;

-- ROLLBACK
-- ALTER TABLE blood_components DROP CONSTRAINT min_gap_days_female_positive;
-- ALTER TABLE blood_components DROP COLUMN min_gap_days_female;
-- UPDATE blood_components SET min_donor_hb_male = 13.0;
-- UPDATE blood_components SET min_donor_hb_female = 11.5 WHERE code IN ('PLT','SDP');
-- UPDATE blood_components SET min_gap_days = 28 WHERE code = 'SDP';
-- (then re-create fn_donations_update_donor_eligibility from migration 020)
