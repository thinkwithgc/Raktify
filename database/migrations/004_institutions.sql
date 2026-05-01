-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004: institutions — hospitals and blood banks.
--
-- One row per onboarded organization. Hospitals and blood banks share the
-- table (kind discriminator) because they share the onboarding lifecycle,
-- the MoU flow, and the platform_users → institution_id linkage.
--
-- Self-referencing FK parent_institution_id supports in-house blood banks:
-- a hospital that runs its own licensed blood bank gets two rows — one of
-- kind='hospital' (parent) and one of kind='blood_bank' (child) pointing
-- back via parent_institution_id.
--
-- onboarding_status flow:
--   PE pending → VE verified → AC active → SU suspended (admin) → AR archived
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE institutions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                        CHAR(2) NOT NULL CHECK (kind IN ('HO','BB')),  -- HO hospital, BB blood bank
  parent_institution_id       UUID REFERENCES institutions(id),
  shortname                   TEXT NOT NULL UNIQUE,                          -- used in subdomain / role email prefix
  legal_name                  TEXT NOT NULL,
  display_name                TEXT NOT NULL,

  -- Geography
  state_id                    INTEGER NOT NULL REFERENCES states(id),
  district_id                 INTEGER NOT NULL REFERENCES districts(id),
  taluka_id                   INTEGER REFERENCES talukas(id),
  village_id                  INTEGER REFERENCES villages(id),
  address_line                TEXT NOT NULL,                                 -- encrypted
  pincode                     CHAR(6) NOT NULL,
  latitude                    NUMERIC(9,6),
  longitude                   NUMERIC(9,6),

  -- Licensing (CDSCO blood bank licence required for kind='BB')
  cdsco_licence_number        TEXT,
  cdsco_licence_expires       DATE,
  hospital_registration_no    TEXT,                                          -- Clinical Establishments Act / state registry
  license_verified_at         TIMESTAMPTZ,
  license_verified_by         UUID REFERENCES platform_users(id),

  -- Primary point of contact
  primary_contact_name        TEXT NOT NULL,
  primary_contact_designation TEXT,
  primary_contact_mobile      CHAR(13) NOT NULL,                             -- encrypted
  primary_contact_email       CITEXT,                                        -- encrypted; pre-credentials provisioning

  -- Onboarding lifecycle
  onboarding_status           CHAR(2) NOT NULL DEFAULT 'PE'
                              CHECK (onboarding_status IN ('PE','VE','AC','SU','AR')),
  onboarding_started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  onboarded_at                TIMESTAMPTZ,
  suspended_at                TIMESTAMPTZ,
  suspension_reason           TEXT,

  -- MoU (latest active version mirrors mou_versions; full archive in 005)
  mou_signed_at               TIMESTAMPTZ,
  mou_expires_at              DATE,
  mou_leegally_doc_id         TEXT,
  mou_signatory_name          TEXT,
  mou_signatory_designation   TEXT,

  -- Capability flags
  has_inhouse_blood_bank      BOOLEAN NOT NULL DEFAULT FALSE,
  is_blood_bank_software_user BOOLEAN NOT NULL DEFAULT FALSE,                -- runs RAKT/etc; relevant for V2 sync
  software_vendor             TEXT,

  is_active                   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bb_requires_cdsco CHECK (
    kind <> 'BB' OR (cdsco_licence_number IS NOT NULL AND cdsco_licence_expires IS NOT NULL)
  ),
  CONSTRAINT licence_not_expired CHECK (
    cdsco_licence_expires IS NULL OR cdsco_licence_expires > created_at::date
  ),
  CONSTRAINT shortname_format CHECK (shortname ~ '^[a-z][a-z0-9_-]{2,31}$'),
  CONSTRAINT pincode_format CHECK (pincode ~ '^[1-9][0-9]{5}$')
);

CREATE INDEX idx_institutions_district     ON institutions(district_id);
CREATE INDEX idx_institutions_kind_active  ON institutions(kind) WHERE is_active = TRUE;
CREATE INDEX idx_institutions_status       ON institutions(onboarding_status);
CREATE INDEX idx_institutions_parent       ON institutions(parent_institution_id) WHERE parent_institution_id IS NOT NULL;
CREATE INDEX idx_institutions_mou_expiry   ON institutions(mou_expires_at) WHERE mou_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_institutions_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  -- Mirror onboarding completion → is_active
  IF NEW.onboarding_status = 'AC' AND OLD.onboarding_status <> 'AC' THEN
    NEW.is_active = TRUE;
    NEW.onboarded_at = COALESCE(NEW.onboarded_at, clock_timestamp());
  ELSIF NEW.onboarding_status IN ('SU','AR') THEN
    NEW.is_active = FALSE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_institutions_touch
  BEFORE UPDATE ON institutions
  FOR EACH ROW EXECUTE FUNCTION fn_institutions_touch();

-- The platform_users → institutions linkage. Added now so future migrations
-- can FK against it. Donors/coordinators have NULL institution_id; staff users
-- (hospital, blood_bank) MUST have one.
ALTER TABLE platform_users
  ADD COLUMN institution_id UUID REFERENCES institutions(id),
  ADD CONSTRAINT staff_requires_institution CHECK (
    (role IN ('donor','coordinator','ngo_admin','super_admin'))
    OR (role IN ('hospital','blood_bank') AND institution_id IS NOT NULL)
  );

CREATE INDEX idx_platform_users_institution ON platform_users(institution_id) WHERE institution_id IS NOT NULL;

-- District activity flag: whenever a blood bank goes active in a district, has_blood_centre flips TRUE.
CREATE OR REPLACE FUNCTION fn_districts_track_blood_centre()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'BB' AND NEW.is_active = TRUE
     AND (OLD IS NULL OR OLD.is_active = FALSE) THEN
    UPDATE districts SET has_blood_centre = TRUE WHERE id = NEW.district_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_districts_track_blood_centre
  AFTER INSERT OR UPDATE OF is_active ON institutions
  FOR EACH ROW EXECUTE FUNCTION fn_districts_track_blood_centre();

GRANT SELECT, INSERT, UPDATE ON institutions TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_districts_track_blood_centre ON institutions;
-- DROP FUNCTION fn_districts_track_blood_centre;
-- ALTER TABLE platform_users DROP CONSTRAINT staff_requires_institution;
-- ALTER TABLE platform_users DROP COLUMN institution_id;
-- DROP TRIGGER trg_institutions_touch ON institutions;
-- DROP FUNCTION fn_institutions_touch;
-- DROP TABLE institutions;
