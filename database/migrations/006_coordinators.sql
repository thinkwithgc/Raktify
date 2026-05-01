-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 006: coordinators — volunteer coordinator profiles and metrics.
--
-- A coordinator is a verified volunteer who fields blood requests in their
-- assigned district, manages a community of donors, and is the human in the
-- loop for Tier 3/4 (community/citizen) request verification.
--
-- Auth links to platform_users (mobile OTP). The 1:1 link is enforced by
-- UNIQUE(platform_user_id) — one coordinator profile per auth row.
--
-- Impact metrics (donations_facilitated, lives_saved_estimate …) are
-- denormalized counters maintained by triggers in later migrations. Storing
-- them on the row makes the public coordinator profile page a single SELECT.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE coordinators (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id            UUID NOT NULL UNIQUE REFERENCES platform_users(id),

  full_name                   TEXT NOT NULL,                    -- encrypted
  display_name                TEXT NOT NULL,                    -- shown on public profile
  date_of_birth               DATE,
  gender                      CHAR(1) CHECK (gender IN ('M','F','O')),
  preferred_language          CHAR(2) NOT NULL DEFAULT 'mr'
                              CHECK (preferred_language IN ('mr','hi','en')),

  -- Geography (where they are assigned)
  state_id                    INTEGER NOT NULL REFERENCES states(id),
  district_id                 INTEGER NOT NULL REFERENCES districts(id),
  taluka_id                   INTEGER REFERENCES talukas(id),
  village_id                  INTEGER REFERENCES villages(id),
  address_line                TEXT,                             -- encrypted

  -- Contact (primary mobile = platform_users.mobile; backup channels here)
  whatsapp_number             CHAR(13),                         -- encrypted; if different from auth mobile
  email                       CITEXT,                           -- encrypted
  emergency_contact_name      TEXT,
  emergency_contact_mobile    CHAR(13),                         -- encrypted

  -- Verification
  id_proof_type               CHAR(3) CHECK (id_proof_type IN ('AAD','PAN','VOT','DRV','PAS')),
  id_proof_last4              CHAR(4),                          -- never full ID
  id_verified_at              TIMESTAMPTZ,
  id_verified_by              UUID REFERENCES platform_users(id),

  -- Operational
  on_duty                     BOOLEAN NOT NULL DEFAULT FALSE,
  on_duty_until               TIMESTAMPTZ,
  is_district_lead            BOOLEAN NOT NULL DEFAULT FALSE,   -- escalation handover anchor
  joined_at                   DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Impact metrics (denormalized; maintained by triggers in later migrations)
  donations_facilitated       INTEGER NOT NULL DEFAULT 0,
  requests_fulfilled          INTEGER NOT NULL DEFAULT 0,
  community_donor_count       INTEGER NOT NULL DEFAULT 0,
  lives_saved_estimate        INTEGER NOT NULL DEFAULT 0,
  median_response_time_min    INTEGER,
  reliability_score           SMALLINT NOT NULL DEFAULT 100
                              CHECK (reliability_score BETWEEN 0 AND 100),

  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  suspended_at                TIMESTAMPTZ,
  suspension_reason           TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Role-of-platform_user check is enforced at the API layer (registration
  -- code only creates a coordinators row when platform_users.role='coordinator').
  -- Postgres CHECK constraints cannot reference other tables, so the link is
  -- maintained by the foreign key + the API.
);

CREATE INDEX idx_coordinators_district ON coordinators(district_id) WHERE is_active = TRUE;
CREATE INDEX idx_coordinators_on_duty  ON coordinators(district_id, on_duty)
  WHERE on_duty = TRUE AND is_active = TRUE;
CREATE INDEX idx_coordinators_lead     ON coordinators(district_id) WHERE is_district_lead = TRUE;

CREATE OR REPLACE FUNCTION fn_coordinators_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  -- on_duty auto-expiry: if on_duty_until is in the past, force off-duty.
  IF NEW.on_duty = TRUE AND NEW.on_duty_until IS NOT NULL
     AND NEW.on_duty_until < clock_timestamp() THEN
    NEW.on_duty = FALSE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_coordinators_touch
  BEFORE UPDATE ON coordinators
  FOR EACH ROW EXECUTE FUNCTION fn_coordinators_touch();

GRANT SELECT, INSERT, UPDATE ON coordinators TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_coordinators_touch ON coordinators;
-- DROP FUNCTION fn_coordinators_touch;
-- DROP TABLE coordinators;
