-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 024: thalassemia_patients — recurring transfusion patients with
-- optional paired-donor relationships.
--
-- (Spec migration 014 — renumbered to 024.)
--
-- Thalassemia majors typically need transfusions every 2–4 weeks. Tracking
-- them lets us:
--   - Pre-schedule next transfusion and pre-reserve units (auto-creates a
--     blood_request 7 days ahead at urgency=PL planned)
--   - Pair them with a long-term family/community donor whose donations are
--     prioritised for that patient (paired_donor_ids[])
--   - Surface them on the coordinator dashboard with countdown
--
-- transfusion_interval_days is the patient-specific cadence; default 21.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE thalassemia_patients (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Patient identity (encrypted)
  full_name                     TEXT NOT NULL,                    -- encrypted
  date_of_birth                 DATE NOT NULL,
  gender                        CHAR(1) NOT NULL CHECK (gender IN ('M','F','O')),
  abha_id                       CHAR(17),                          -- encrypted, optional
  guardian_name                 TEXT,                              -- encrypted (paediatric)
  guardian_mobile               CHAR(13),                          -- encrypted

  -- Clinical
  blood_group_id                SMALLINT NOT NULL REFERENCES blood_groups(id),
  diagnosis_subtype             TEXT,                              -- e.g. 'Beta major'
  diagnosed_at                  DATE,
  treating_hospital_id          UUID NOT NULL REFERENCES institutions(id),
  treating_doctor_name          TEXT,
  notes                         TEXT,                              -- encrypted

  -- Cadence
  transfusion_interval_days     SMALLINT NOT NULL DEFAULT 21
                                CHECK (transfusion_interval_days BETWEEN 7 AND 90),
  last_transfusion_date         DATE,
  next_transfusion_due          DATE,
  default_units                 SMALLINT NOT NULL DEFAULT 1
                                CHECK (default_units BETWEEN 1 AND 10),
  default_component_id          SMALLINT NOT NULL REFERENCES blood_components(id),

  -- Geography (where they live; for matching local donors)
  state_id                      INTEGER REFERENCES states(id),
  district_id                   INTEGER REFERENCES districts(id),
  village_id                    INTEGER REFERENCES villages(id),

  -- Donor pairing (donors who pledge to support this patient long-term)
  paired_donor_ids              UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],

  -- Lifecycle
  is_active                     BOOLEAN NOT NULL DEFAULT TRUE,
  inactive_reason               TEXT,                              -- encrypted; e.g. 'BMT successful', 'deceased'
  registered_by_coordinator     UUID REFERENCES coordinators(id),
  registered_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_thal_district_active ON thalassemia_patients(district_id) WHERE is_active = TRUE;
CREATE INDEX idx_thal_next_due        ON thalassemia_patients(next_transfusion_due) WHERE is_active = TRUE;
CREATE INDEX idx_thal_blood_group     ON thalassemia_patients(blood_group_id);
CREATE INDEX idx_thal_paired_donors_g ON thalassemia_patients USING gin (paired_donor_ids);

-- Auto-update next_transfusion_due whenever last_transfusion_date is set.
CREATE OR REPLACE FUNCTION fn_thal_update_next_due()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  IF NEW.last_transfusion_date IS NOT NULL
     AND NEW.last_transfusion_date IS DISTINCT FROM OLD.last_transfusion_date THEN
    NEW.next_transfusion_due = NEW.last_transfusion_date + (NEW.transfusion_interval_days * INTERVAL '1 day');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_thal_touch
  BEFORE UPDATE ON thalassemia_patients
  FOR EACH ROW EXECUTE FUNCTION fn_thal_update_next_due();

GRANT SELECT, INSERT, UPDATE ON thalassemia_patients TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_thal_touch ON thalassemia_patients;
-- DROP FUNCTION fn_thal_update_next_due;
-- DROP TABLE thalassemia_patients;
