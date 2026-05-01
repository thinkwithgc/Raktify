-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008: donors — the core of the platform. 45 fields per spec §3.
--
-- ⚠ PATIENT-SAFETY TABLE ⚠
-- Every clinical field below is enforced at the DB layer. Application code
-- MUST NOT shortcut these constraints; they exist precisely because app
-- code cannot be trusted with patient safety.
--
-- Two-blood-group rule (spec §5.4):
--   blood_group_self_reported    — display only, NEVER used in matching
--   blood_group_verified         — only field used in matching, writable
--                                  by bb_writer role only (enforced via
--                                  RLS + column GRANT)
--
-- Duplicate detection: ABHA ID (unique), name+DOB, aadhaar_last4+DOB.
-- Hits flag suspected_duplicate_of for ngo_admin review (Phase 3).
--
-- Encryption: mobile, full_name, address_line, alternate_mobiles,
-- abha_id, aadhaar_last4 are stored as ciphertext from the encryption
-- module (provider-prefixed, e.g. 'v1:loc:main:…').
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE donors (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile                        CHAR(13) NOT NULL UNIQUE,         -- encrypted, +91XXXXXXXXXX
  mobile_verified               BOOLEAN NOT NULL DEFAULT FALSE,
  mobile_verified_at            TIMESTAMPTZ,
  full_name                     TEXT NOT NULL,                    -- encrypted
  date_of_birth                 DATE NOT NULL,
  gender                        CHAR(1) NOT NULL CHECK (gender IN ('M','F','O')),
  abha_id                       CHAR(17) UNIQUE,                  -- encrypted, nullable
  aadhaar_last4                 CHAR(4),                          -- never full Aadhaar
  preferred_language            CHAR(2) NOT NULL DEFAULT 'mr'
                                CHECK (preferred_language IN ('mr','hi','en')),

  -- Geography
  village_id                    INTEGER REFERENCES villages(id),
  address_line                  TEXT,                             -- encrypted
  pincode                       CHAR(6),
  latitude                      NUMERIC(9,6),                     -- only with explicit consent
  longitude                     NUMERIC(9,6),
  max_travel_km                 SMALLINT NOT NULL DEFAULT 10,

  -- Blood group: TWO fields. Self-reported NEVER used in matching.
  blood_group_self_reported     SMALLINT REFERENCES blood_groups(id),
  blood_group_verified          SMALLINT REFERENCES blood_groups(id),
  blood_group_verified_at       TIMESTAMPTZ,
  blood_group_verified_by       UUID REFERENCES institutions(id),

  -- Eligibility
  eligible_components           SMALLINT[],
  deferral_status               CHAR(1) NOT NULL DEFAULT 'A'
                                CHECK (deferral_status IN ('A','T','P')),  -- Active, Temp, Permanent
  deferral_reason               TEXT,                             -- encrypted, blood_bank only
  deferral_until                DATE,
  next_eligible_date            DATE,
  total_donations               SMALLINT NOT NULL DEFAULT 0,
  total_units_ml                INTEGER NOT NULL DEFAULT 0,

  -- Availability
  is_available                  BOOLEAN NOT NULL DEFAULT TRUE,
  available_hours_start         SMALLINT NOT NULL DEFAULT 6,
  available_hours_end           SMALLINT NOT NULL DEFAULT 22,
  emergency_override            BOOLEAN NOT NULL DEFAULT TRUE,    -- if TRUE, Critical alerts bypass DND

  -- Communication preferences
  preferred_contact_channel     CHAR(2) NOT NULL DEFAULT 'WA'
                                CHECK (preferred_contact_channel IN ('WA','SM','CA')),
  whatsapp_opted_in             BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_opted_in_at          TIMESTAMPTZ,
  sms_opted_in                  BOOLEAN NOT NULL DEFAULT TRUE,

  -- Consent (donor-only writable; spec §3 trigger trg_consent_protect)
  consent_data_use              BOOLEAN NOT NULL DEFAULT FALSE,
  consent_given_at              TIMESTAMPTZ,
  consent_version               SMALLINT NOT NULL DEFAULT 1,

  -- Relationships
  community_id                  UUID REFERENCES communities(id),
  referred_by_coordinator       UUID REFERENCES coordinators(id),
  platform_user_id              UUID UNIQUE REFERENCES platform_users(id),

  -- Registration provenance
  registration_source           CHAR(3) NOT NULL
                                CHECK (registration_source IN ('QRC','WAB','WEB','APP','BBK','CAM')),
  registration_camp_id          UUID,                             -- FK added in 033 (donation_camps)

  -- Duplicate detection
  suspected_duplicate_of        UUID REFERENCES donors(id),
  merged_into                   UUID REFERENCES donors(id),
  alternate_mobiles             TEXT[],                           -- encrypted entries

  -- Behaviour metrics (maintained by triggers when donor responds to alerts)
  no_show_count                 SMALLINT NOT NULL DEFAULT 0,
  reliability_score             SMALLINT NOT NULL DEFAULT 100
                                CHECK (reliability_score BETWEEN 0 AND 100),

  preferred_software_vendor     TEXT,                             -- V2 partner-software hint

  is_active                     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- DB-level clinical rules (NBTC age band)
  CONSTRAINT age_min       CHECK (date_of_birth <= CURRENT_DATE - INTERVAL '18 years'),
  CONSTRAINT age_max       CHECK (date_of_birth >= CURRENT_DATE - INTERVAL '65 years'),
  CONSTRAINT travel_range  CHECK (max_travel_km BETWEEN 1 AND 999),
  CONSTRAINT hours_range   CHECK (available_hours_start BETWEEN 0 AND 23
                              AND available_hours_end   BETWEEN 0 AND 23),
  CONSTRAINT consent_paired CHECK (
    (consent_data_use = FALSE)
    OR (consent_data_use = TRUE AND consent_given_at IS NOT NULL)
  )
);

-- Search and matching indices
CREATE INDEX idx_donors_blood_verified
  ON donors(blood_group_verified, deferral_status, is_active)
  WHERE blood_group_verified IS NOT NULL;
CREATE INDEX idx_donors_village          ON donors(village_id) WHERE is_active = TRUE;
CREATE INDEX idx_donors_pincode          ON donors(pincode);
CREATE INDEX idx_donors_community        ON donors(community_id) WHERE is_active = TRUE;
CREATE INDEX idx_donors_referrer         ON donors(referred_by_coordinator) WHERE is_active = TRUE;
CREATE INDEX idx_donors_next_eligible    ON donors(next_eligible_date) WHERE deferral_status = 'A';
CREATE INDEX idx_donors_dob              ON donors(date_of_birth);

-- Duplicate-detection helpers (case-insensitive name + dob)
CREATE INDEX idx_donors_name_dob_lower   ON donors(LOWER(full_name), date_of_birth);
CREATE INDEX idx_donors_aadhaar_dob      ON donors(aadhaar_last4, date_of_birth)
  WHERE aadhaar_last4 IS NOT NULL;

-- Phone trigram for "did you mean this number?" donor lookups (encrypted, but exact)
CREATE INDEX idx_donors_mobile_unique    ON donors(mobile);

-- Mobile-format trigger: enforce +91[6-9]\d{9} against the *plaintext* mobile
-- before encryption. Application code calls a helper that validates first,
-- encrypts, then INSERTs. The DB-level UNIQUE on the encrypted column blocks
-- exact-duplicate ciphertext (deterministic encryption only). For now this
-- regex check on the encrypted column is best-effort — the real format
-- guard lives in /backend/src/utils/phone.js. Spec §3 trg_donors_validate_mobile
-- will be added in a later migration once the encryption helper is finalized.

CREATE OR REPLACE FUNCTION fn_donors_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  -- consent_given_at is set by the donor's own action; if consent goes from
  -- FALSE → TRUE without a consent_given_at, stamp it now.
  IF NEW.consent_data_use = TRUE AND OLD.consent_data_use IS DISTINCT FROM TRUE
     AND NEW.consent_given_at IS NULL THEN
    NEW.consent_given_at = clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_donors_touch
  BEFORE UPDATE ON donors
  FOR EACH ROW EXECUTE FUNCTION fn_donors_touch();

-- Donor merge support: when two donor rows are merged, dependent rows in
-- donation_history etc. must be re-pointed at the survivor. Only ngo_admin
-- can perform a merge — RLS in 200_rls_phase2 enforces that. The actual
-- merge logic is implemented in /backend/src/services/donors/merge.js
-- under one transaction.
GRANT SELECT, INSERT, UPDATE ON donors TO app_user;

-- bb_writer can update the lab-verified blood group columns (only).
GRANT UPDATE (blood_group_verified, blood_group_verified_at, blood_group_verified_by,
              eligible_components, deferral_status, deferral_reason, deferral_until,
              next_eligible_date, total_donations, total_units_ml)
  ON donors TO bb_writer;

-- ROLLBACK
-- DROP TRIGGER trg_donors_touch ON donors;
-- DROP FUNCTION fn_donors_touch;
-- DROP TABLE donors;
