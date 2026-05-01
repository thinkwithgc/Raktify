-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020: donation_history — one row per donation event.
--
-- (Spec migration 010 — renumbered to 020 because 010 was already used by
-- 010_grant_helper_roles in this repo. See CLAUDE.md "Migration numbering"
-- for the full mapping.)
--
-- Three trust levels (source) per spec §3:
--   V verified         — donation recorded by an onboarded blood bank,
--                        TTI screening done, ISBT barcode known
--   S self-reported    — donor reported via WhatsApp/web, no record
--                        with us; counted for impact metrics only,
--                        NEVER used to gate eligibility
--   R retroactive      — recorded by blood bank for a past donation that
--                        happened before they onboarded; TTI may be
--                        unavailable, treated as legacy data
--
-- A successful donation creates blood_inventory rows automatically via the
-- trg_donation_creates_inventory trigger (added in migration 023).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE donation_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id              UUID NOT NULL REFERENCES donors(id),
  blood_bank_id         UUID REFERENCES institutions(id),

  -- Trust / provenance
  trust_level           CHAR(1) NOT NULL CHECK (trust_level IN ('V','S','R')),
  source                CHAR(2) NOT NULL CHECK (source IN ('BB','SR','RA','CA','PT')),
  -- BB blood-bank, SR self-report, RA retroactive, CA at camp, PT partner-system

  -- Event
  collection_date       DATE NOT NULL,
  collection_time       TIME,
  component_id          SMALLINT NOT NULL REFERENCES blood_components(id),
  volume_ml             SMALLINT NOT NULL CHECK (volume_ml > 0),

  -- Donor vitals captured at donation
  hb_gdl                NUMERIC(4,1),                     -- haemoglobin g/dL
  hb_method             CHAR(2) CHECK (hb_method IN ('CS','HC','LB')),
  pulse_bpm             SMALLINT,
  bp_systolic           SMALLINT,
  bp_diastolic          SMALLINT,
  weight_kg             NUMERIC(5,1),

  -- Identity of the bag(s) created
  isbt_barcode          TEXT,                             -- NULL for self-reported
  donation_camp_id      UUID,                             -- FK added in 033
  recorded_by_user_id   UUID REFERENCES platform_users(id),

  -- Eligibility book-keeping
  next_eligible_date_at_record DATE,                      -- snapshot for audit purposes
  notes                 TEXT,

  is_invalidated        BOOLEAN NOT NULL DEFAULT FALSE,
  invalidation_reason   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT verified_needs_blood_bank CHECK (
    trust_level <> 'V' OR blood_bank_id IS NOT NULL
  ),
  CONSTRAINT verified_needs_barcode CHECK (
    trust_level <> 'V' OR isbt_barcode IS NOT NULL
  ),
  CONSTRAINT collection_not_future CHECK (collection_date <= CURRENT_DATE)
);

CREATE INDEX idx_donations_donor          ON donation_history(donor_id, collection_date DESC);
CREATE INDEX idx_donations_blood_bank     ON donation_history(blood_bank_id, collection_date DESC)
  WHERE blood_bank_id IS NOT NULL;
CREATE INDEX idx_donations_trust_verified ON donation_history(donor_id) WHERE trust_level = 'V';
CREATE INDEX idx_donations_camp           ON donation_history(donation_camp_id) WHERE donation_camp_id IS NOT NULL;
CREATE UNIQUE INDEX uq_isbt_barcode       ON donation_history(isbt_barcode) WHERE isbt_barcode IS NOT NULL;

-- After INSERT/UPDATE on donation_history (verified donations only) → recompute
-- donors.total_donations / total_units_ml / next_eligible_date.
-- Spec §3 trg_donors_update_eligibility.
CREATE OR REPLACE FUNCTION fn_donations_update_donor_eligibility()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_min_gap SMALLINT;
BEGIN
  -- Only verified donations gate next_eligible_date.
  IF NEW.trust_level <> 'V' THEN
    RETURN NEW;
  END IF;

  SELECT min_gap_days INTO v_min_gap FROM blood_components WHERE id = NEW.component_id;

  UPDATE donors
     SET total_donations  = total_donations  + 1,
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

CREATE TRIGGER trg_donations_update_donor_eligibility
  AFTER INSERT ON donation_history
  FOR EACH ROW EXECUTE FUNCTION fn_donations_update_donor_eligibility();

CREATE OR REPLACE FUNCTION fn_donation_history_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_donation_history_touch
  BEFORE UPDATE ON donation_history
  FOR EACH ROW EXECUTE FUNCTION fn_donation_history_touch();

GRANT SELECT, INSERT, UPDATE ON donation_history TO app_user;
GRANT UPDATE (is_invalidated, invalidation_reason) ON donation_history TO bb_writer;

-- ROLLBACK
-- DROP TRIGGER trg_donation_history_touch ON donation_history;
-- DROP FUNCTION fn_donation_history_touch;
-- DROP TRIGGER trg_donations_update_donor_eligibility ON donation_history;
-- DROP FUNCTION fn_donations_update_donor_eligibility;
-- DROP TABLE donation_history;
