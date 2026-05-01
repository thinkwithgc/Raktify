-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 027: blood_requests — the operational heart of the platform.
--
-- (Spec migration 016 — renumbered to 027.)
--
-- Source tiers (spec §7):
--   OH Onboarded Hospital — full access, all urgency tiers
--   GH Guest Hospital     — coordinator submits on behalf of non-onboarded hospital
--   CR Coordinator        — coordinator on behalf of community patient (max URGENT)
--   CI Citizen            — donor self-service request (max URGENT, requires
--                           coordinator verification before donor activation)
--
-- Urgency:
--   PL Planned   — needed_by typically days/weeks away; auto-upgrades when close
--   UR Urgent    — needed_by < 24h; immediate matching, donor activation
--   CR Critical  — needed_by < 60min; bypasses DND, MSG91 voice escalation
--
-- Status:
--   OP Open       — accepted, matching in progress
--   MT Matched    — inventory reserved
--   AS Assigned   — coordinator assigned
--   PF Partial    — partly fulfilled (units_fulfilled > 0 < units_required)
--   FU Fulfilled  — units_fulfilled >= units_required
--   CL Closed     — terminal happy state, crossmatch confirmed
--   CA Cancelled  — terminal — request withdrawn by hospital
--   EX Expired    — terminal — needed_by passed without fulfilment
--   RE Rejected   — terminal — admin rejected (e.g. fraudulent)
--
-- escalation_timeout_minutes is GENERATED based on urgency_tier so we don't
-- have to maintain it in app code.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE blood_requests (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number                  TEXT NOT NULL UNIQUE,            -- BC-YYYY-DISTCODE-NNNNN

  -- Source
  source_tier                     CHAR(2) NOT NULL CHECK (source_tier IN ('OH','GH','CR','CI')),
  requesting_institution_id       UUID REFERENCES institutions(id),
  requesting_user_id              UUID NOT NULL REFERENCES platform_users(id),

  -- Guest hospital (Tier 2)
  guest_hospital_name             TEXT,
  guest_hospital_address          TEXT,
  guest_doctor_name               TEXT,
  guest_doctor_reg_number         TEXT,
  guest_nmc_check_status          CHAR(2) CHECK (guest_nmc_check_status IN ('PE','OK','FA')),

  -- Patient (encrypted)
  patient_initials                TEXT NOT NULL,                   -- short string only (e.g. "R.M.")
  patient_age                     SMALLINT NOT NULL CHECK (patient_age BETWEEN 0 AND 120),
  patient_gender                  CHAR(1) NOT NULL CHECK (patient_gender IN ('M','F','O')),
  patient_blood_group_id          SMALLINT NOT NULL REFERENCES blood_groups(id),
  patient_phenotype_note          TEXT,                            -- e.g. 'Bombay', 'Rh-null'

  -- Request specifics
  component_id                    SMALLINT NOT NULL REFERENCES blood_components(id),
  units_required                  SMALLINT NOT NULL CHECK (units_required BETWEEN 1 AND 50),
  units_fulfilled                 SMALLINT NOT NULL DEFAULT 0 CHECK (units_fulfilled >= 0),
  urgency_tier                    CHAR(2) NOT NULL CHECK (urgency_tier IN ('PL','UR','CR')),
  needed_by                       TIMESTAMPTZ NOT NULL,
  clinical_indication             TEXT,                            -- encrypted
  ward_or_bed                     TEXT,
  requesting_hospital_district_id INTEGER NOT NULL REFERENCES districts(id),

  -- State
  status                          CHAR(2) NOT NULL DEFAULT 'OP'
                                  CHECK (status IN ('OP','MT','AS','PF','FU','CL','CA','EX','RE')),
  matched_blood_bank_id           UUID REFERENCES institutions(id),
  donor_activation_required       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Compatibility fallback
  compatibility_fallback_used     BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_blood_group_id         SMALLINT REFERENCES blood_groups(id),

  -- Coordinator-tier verification (Tiers 3 & 4)
  coordinator_verified_at         TIMESTAMPTZ,
  coordinator_verified_by         UUID REFERENCES coordinators(id),

  -- Crossmatch confirmation (hospital after issue)
  crossmatch_confirmed            BOOLEAN NOT NULL DEFAULT FALSE,
  crossmatch_confirmed_at         TIMESTAMPTZ,

  -- Timestamps + computed thresholds
  raised_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_match_found_at            TIMESTAMPTZ,
  fulfilled_at                    TIMESTAMPTZ,
  closed_at                       TIMESTAMPTZ,
  cancelled_at                    TIMESTAMPTZ,
  cancellation_reason             TEXT,

  -- Auto-escalation tuning. Generated from urgency_tier so it's never wrong.
  escalation_timeout_minutes      INTEGER GENERATED ALWAYS AS (
    CASE urgency_tier
      WHEN 'CR' THEN 10
      WHEN 'UR' THEN 30
      WHEN 'PL' THEN 240
    END
  ) STORED,
  dho_alert_threshold_minutes     INTEGER GENERATED ALWAYS AS (
    CASE urgency_tier
      WHEN 'CR' THEN 30
      WHEN 'UR' THEN 90
      WHEN 'PL' THEN 720
    END
  ) STORED,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT oh_needs_institution CHECK (
    source_tier <> 'OH' OR requesting_institution_id IS NOT NULL
  ),
  CONSTRAINT gh_needs_guest_fields CHECK (
    source_tier <> 'GH' OR (guest_hospital_name IS NOT NULL AND guest_doctor_name IS NOT NULL)
  ),
  CONSTRAINT urgency_caps CHECK (
    -- CR / CI tiers cannot raise CRITICAL
    NOT (source_tier IN ('CR','CI') AND urgency_tier = 'CR')
  ),
  CONSTRAINT fulfilled_consistency CHECK (
    units_fulfilled <= units_required
  ),
  CONSTRAINT needed_by_future_at_creation CHECK (
    needed_by IS NOT NULL
  )
);

CREATE INDEX idx_requests_open_district ON blood_requests(requesting_hospital_district_id, status, urgency_tier)
  WHERE status IN ('OP','MT','AS','PF');
CREATE INDEX idx_requests_blood_group   ON blood_requests(patient_blood_group_id, component_id, status)
  WHERE status IN ('OP','MT','AS','PF');
CREATE INDEX idx_requests_needed_by     ON blood_requests(needed_by)
  WHERE status IN ('OP','MT','AS','PF');
CREATE INDEX idx_requests_coordinator_unverified
  ON blood_requests(source_tier) WHERE source_tier IN ('CR','CI') AND coordinator_verified_at IS NULL;

-- Per-district sequence for request_number (BC-YYYY-DISTCODE-NNNNN)
CREATE TABLE request_number_seq (
  district_id INTEGER NOT NULL,
  year        SMALLINT NOT NULL,
  next_value  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (district_id, year)
);

CREATE OR REPLACE FUNCTION fn_requests_generate_ref()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_year      SMALLINT := EXTRACT(YEAR FROM NEW.raised_at)::SMALLINT;
  v_dist_code TEXT;
  v_seq       INTEGER;
BEGIN
  IF NEW.request_number IS NOT NULL AND NEW.request_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(district_code_short, LPAD(id::text, 4, '0'))
    INTO v_dist_code
    FROM districts WHERE id = NEW.requesting_hospital_district_id;

  INSERT INTO request_number_seq (district_id, year, next_value)
  VALUES (NEW.requesting_hospital_district_id, v_year, 2)
  ON CONFLICT (district_id, year) DO UPDATE
    SET next_value = request_number_seq.next_value + 1
  RETURNING next_value - 1 INTO v_seq;

  NEW.request_number := format('BC-%s-%s-%s', v_year, v_dist_code, lpad(v_seq::text, 5, '0'));
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_requests_generate_ref
  BEFORE INSERT ON blood_requests
  FOR EACH ROW EXECUTE FUNCTION fn_requests_generate_ref();

-- Status validation + fulfilment book-keeping. Spec §7 trg_requests_fulfillment / trg_requests_status_validate.
CREATE OR REPLACE FUNCTION fn_requests_status_book()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();

  -- Fulfillment recompute
  IF NEW.units_fulfilled IS DISTINCT FROM OLD.units_fulfilled THEN
    IF NEW.units_fulfilled >= NEW.units_required AND NEW.status IN ('OP','MT','AS','PF') THEN
      NEW.status = 'FU';
      NEW.fulfilled_at = clock_timestamp();
    ELSIF NEW.units_fulfilled > 0 AND NEW.units_fulfilled < NEW.units_required
          AND NEW.status IN ('OP','MT','AS') THEN
      NEW.status = 'PF';
    END IF;
  END IF;

  -- Reject illegal transitions
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.status IN ('CL','CA','EX','RE') THEN
      RAISE EXCEPTION 'Request % is in terminal state %; cannot transition to %',
        OLD.request_number, OLD.status, NEW.status;
    END IF;
    -- FU may move to CL, no other forward moves from FU (except admin RE)
    IF OLD.status = 'FU' AND NEW.status NOT IN ('CL','RE') THEN
      RAISE EXCEPTION 'Fulfilled request % can only move to CL or RE (got %)',
        OLD.request_number, NEW.status;
    END IF;
    -- Set timestamps
    IF NEW.status = 'CL' AND NEW.closed_at IS NULL THEN NEW.closed_at = clock_timestamp(); END IF;
    IF NEW.status = 'CA' AND NEW.cancelled_at IS NULL THEN NEW.cancelled_at = clock_timestamp(); END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_requests_status_book
  BEFORE UPDATE ON blood_requests
  FOR EACH ROW EXECUTE FUNCTION fn_requests_status_book();

-- Default donor_activation_required: TRUE for UR/CR; FALSE for PL.
CREATE OR REPLACE FUNCTION fn_requests_default_activation()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.donor_activation_required IS NULL THEN
    NEW.donor_activation_required := (NEW.urgency_tier IN ('UR','CR'));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_requests_default_activation
  BEFORE INSERT ON blood_requests
  FOR EACH ROW EXECUTE FUNCTION fn_requests_default_activation();

-- Now wire blood_inventory.reserved_for_request_id ↔ blood_requests.id
ALTER TABLE blood_inventory
  ADD CONSTRAINT fk_inventory_reserved_request
  FOREIGN KEY (reserved_for_request_id) REFERENCES blood_requests(id);

GRANT SELECT, INSERT, UPDATE ON blood_requests TO app_user;
GRANT SELECT, INSERT, UPDATE ON request_number_seq TO app_user;

-- ROLLBACK
-- ALTER TABLE blood_inventory DROP CONSTRAINT fk_inventory_reserved_request;
-- DROP TRIGGER trg_requests_default_activation ON blood_requests;
-- DROP FUNCTION fn_requests_default_activation;
-- DROP TRIGGER trg_requests_status_book ON blood_requests;
-- DROP FUNCTION fn_requests_status_book;
-- DROP TRIGGER trg_requests_generate_ref ON blood_requests;
-- DROP FUNCTION fn_requests_generate_ref;
-- DROP TABLE request_number_seq;
-- DROP TABLE blood_requests;
