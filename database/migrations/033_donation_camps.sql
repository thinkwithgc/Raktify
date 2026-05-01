-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 033: donation_camps — organised donation drives.
--
-- (Spec migration 022 — renumbered to 033.)
--
-- A camp is a scheduled drive (corporate, community, college). It generates
-- a unique QR code (qr_code_token) that pre-fills the donor registration
-- form's campaign attribution. Donations made at the camp link via
-- donation_history.donation_camp_id; the camp aggregates impact metrics.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE donation_camps (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL UNIQUE,
  qr_code_token            TEXT NOT NULL UNIQUE,                  -- random base64url
  poster_storage_key       TEXT,

  -- Geography
  state_id                 INTEGER NOT NULL REFERENCES states(id),
  district_id              INTEGER NOT NULL REFERENCES districts(id),
  taluka_id                INTEGER REFERENCES talukas(id),
  village_id               INTEGER REFERENCES villages(id),
  venue                    TEXT NOT NULL,
  address_line             TEXT NOT NULL,
  pincode                  CHAR(6),
  latitude                 NUMERIC(9,6),
  longitude                NUMERIC(9,6),

  -- Schedule
  scheduled_date           DATE NOT NULL,
  start_time               TIME NOT NULL,
  end_time                 TIME NOT NULL,
  timezone                 TEXT NOT NULL DEFAULT 'Asia/Kolkata',

  -- Organiser attribution
  organiser_type           CHAR(2) NOT NULL CHECK (organiser_type IN
                            ('CC','CO','EI','EO','MC','OT')),
  -- CC Corporate    CO Coordinator   EI Educational institution
  -- EO External org MC Medical college    OT Other
  organiser_name           TEXT NOT NULL,
  organiser_contact_name   TEXT,
  organiser_contact_mobile CHAR(13),                              -- encrypted
  partnered_blood_bank_id  UUID REFERENCES institutions(id),
  organising_coordinator_id UUID REFERENCES coordinators(id),

  -- Targets / metrics
  target_donor_count       SMALLINT,
  registered_donor_count   INTEGER NOT NULL DEFAULT 0,
  attended_donor_count     INTEGER NOT NULL DEFAULT 0,
  units_collected          INTEGER NOT NULL DEFAULT 0,

  -- Lifecycle
  status                   CHAR(2) NOT NULL DEFAULT 'PL'
                           CHECK (status IN ('PL','LV','CO','CA')),
  -- PL Planned, LV Live (in progress), CO Completed, CA Cancelled
  cancelled_reason         TEXT,
  created_by_user_id       UUID NOT NULL REFERENCES platform_users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT camp_time_window CHECK (end_time > start_time)
);

CREATE INDEX idx_camps_district_date ON donation_camps(district_id, scheduled_date);
CREATE INDEX idx_camps_status        ON donation_camps(status);
CREATE INDEX idx_camps_organiser_co  ON donation_camps(organising_coordinator_id) WHERE organising_coordinator_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_camps_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_camps_touch
  BEFORE UPDATE ON donation_camps
  FOR EACH ROW EXECUTE FUNCTION fn_camps_touch();

-- Late FKs that couldn't exist in earlier migrations
ALTER TABLE donors
  ADD CONSTRAINT fk_donors_registration_camp
  FOREIGN KEY (registration_camp_id) REFERENCES donation_camps(id);

ALTER TABLE donation_history
  ADD CONSTRAINT fk_donations_camp
  FOREIGN KEY (donation_camp_id) REFERENCES donation_camps(id);

GRANT SELECT, INSERT, UPDATE ON donation_camps TO app_user;

-- ROLLBACK
-- ALTER TABLE donation_history DROP CONSTRAINT fk_donations_camp;
-- ALTER TABLE donors DROP CONSTRAINT fk_donors_registration_camp;
-- DROP TRIGGER trg_camps_touch ON donation_camps;
-- DROP FUNCTION fn_camps_touch;
-- DROP TABLE donation_camps;
