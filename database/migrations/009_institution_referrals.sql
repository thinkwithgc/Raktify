-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 009: institution_referrals — donor-initiated blood-bank referrals.
--
-- A donor at a non-onboarded hospital encounters BloodConnect and refers
-- their hospital/blood-bank for onboarding. Multiple donors can refer the
-- same institution; the first one creates the referral, subsequent ones
-- are added as co-referrers (referrer_donor_ids[]).
--
-- Funnel states:
--   NE new       → CO contacted → IN interested → ON onboarded
--                                              → DC declined
--                                              → DR dropped (no response 90d)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE institution_referrals (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Target institution (free-text — they're not yet in the institutions table)
  target_kind            CHAR(2) NOT NULL CHECK (target_kind IN ('HO','BB')),
  target_name            TEXT NOT NULL,
  target_district_id     INTEGER REFERENCES districts(id),
  target_address         TEXT,
  target_contact_mobile  CHAR(13),                        -- encrypted
  target_contact_email   CITEXT,                          -- encrypted
  target_contact_name    TEXT,

  -- Referrer chain
  primary_referrer_id    UUID NOT NULL REFERENCES donors(id),
  referrer_donor_ids     UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  referrer_count         SMALLINT GENERATED ALWAYS AS (1 + COALESCE(array_length(referrer_donor_ids, 1), 0)) STORED,

  -- Funnel
  funnel_status          CHAR(2) NOT NULL DEFAULT 'NE'
                         CHECK (funnel_status IN ('NE','CO','IN','ON','DC','DR')),
  status_changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_by      UUID REFERENCES platform_users(id),
  notes                  TEXT,                            -- ngo_admin notes

  -- Outcome
  onboarded_institution_id UUID REFERENCES institutions(id),
  onboarded_at             TIMESTAMPTZ,
  declined_reason          TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referrals_status      ON institution_referrals(funnel_status);
CREATE INDEX idx_referrals_district    ON institution_referrals(target_district_id);
CREATE INDEX idx_referrals_primary     ON institution_referrals(primary_referrer_id);
CREATE INDEX idx_referrals_target_name ON institution_referrals USING gin (target_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION fn_referrals_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  IF NEW.funnel_status IS DISTINCT FROM OLD.funnel_status THEN
    NEW.status_changed_at = clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_referrals_touch
  BEFORE UPDATE ON institution_referrals
  FOR EACH ROW EXECUTE FUNCTION fn_referrals_touch();

GRANT SELECT, INSERT, UPDATE ON institution_referrals TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_referrals_touch ON institution_referrals;
-- DROP FUNCTION fn_referrals_touch;
-- DROP TABLE institution_referrals;
