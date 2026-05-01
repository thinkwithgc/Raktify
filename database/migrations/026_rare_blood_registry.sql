-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026: rare_blood_registry — Bombay (Oh) phenotype and other rare
-- blood-group donors. National-broadcast eligible.
--
-- (Spec migration 015 — renumbered to 026 because 025 is audit_log.)
--
-- Bombay phenotype (hh / Oh) is genetically O but lacks the H antigen, and
-- can ONLY receive Bombay blood. Rare phenotype donors (Rh-null, Bombay,
-- specific minor antigen combinations) are entered here so that:
--   - When a rare-blood request is raised, the matching engine bypasses
--     district radius and queries the national registry directly.
--   - Donors here can opt into nation-wide alerts (broadcast_consent).
--
-- A row may reference a donor (donor_id) — preferred — or be a "shadow"
-- entry (donor_id NULL) for a known rare-phenotype individual we have not
-- yet onboarded as a donor (e.g. flagged by an outside blood bank).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE rare_blood_registry (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id                 UUID UNIQUE REFERENCES donors(id),

  -- Phenotype description
  phenotype_code           TEXT NOT NULL,                       -- 'BOMBAY','RH_NULL','MNS_LOW_INC' …
  phenotype_description    TEXT NOT NULL,
  abo_type                 CHAR(2) CHECK (abo_type IN ('A','B','AB','O')),
  rh_factor                CHAR(1) CHECK (rh_factor IN ('+','-')),
  is_bombay                BOOLEAN NOT NULL DEFAULT FALSE,

  -- Verification
  verified_by_institution_id UUID NOT NULL REFERENCES institutions(id),
  verified_method            TEXT,                              -- 'IAT','Genotyping','Reference panel'
  verified_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_doc_storage_key TEXT,

  -- Shadow-entry contact (when donor_id IS NULL)
  contact_name             TEXT,                                -- encrypted
  contact_mobile           CHAR(13),                            -- encrypted
  contact_state_id         INTEGER REFERENCES states(id),
  contact_district_id      INTEGER REFERENCES districts(id),
  contact_notes            TEXT,                                -- encrypted

  -- Broadcast policy
  broadcast_consent        BOOLEAN NOT NULL DEFAULT FALSE,
  broadcast_consent_at     TIMESTAMPTZ,
  national_alert_pause_until DATE,                              -- temporary pause requested by donor

  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  removed_reason           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT donor_or_shadow CHECK (
    donor_id IS NOT NULL OR (contact_name IS NOT NULL AND contact_mobile IS NOT NULL)
  )
);

CREATE INDEX idx_rare_phenotype     ON rare_blood_registry(phenotype_code) WHERE is_active = TRUE;
CREATE INDEX idx_rare_district      ON rare_blood_registry(contact_district_id) WHERE is_active = TRUE;
CREATE INDEX idx_rare_broadcast     ON rare_blood_registry(broadcast_consent) WHERE is_active = TRUE AND broadcast_consent = TRUE;

CREATE OR REPLACE FUNCTION fn_rare_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_rare_touch
  BEFORE UPDATE ON rare_blood_registry
  FOR EACH ROW EXECUTE FUNCTION fn_rare_touch();

-- Maintain donors.is_rare flag in sync with this registry.
CREATE OR REPLACE FUNCTION fn_rare_sync_donor_flag()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.donor_id IS NOT NULL THEN
    -- We don't have donor.is_rare; this is reflected via the rare_blood_registry presence.
    -- This function is a hook for future denormalization; intentionally no-op.
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_rare_sync_donor_flag
  AFTER INSERT OR UPDATE ON rare_blood_registry
  FOR EACH ROW EXECUTE FUNCTION fn_rare_sync_donor_flag();

GRANT SELECT, INSERT, UPDATE ON rare_blood_registry TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_rare_sync_donor_flag ON rare_blood_registry;
-- DROP FUNCTION fn_rare_sync_donor_flag;
-- DROP TRIGGER trg_rare_touch ON rare_blood_registry;
-- DROP FUNCTION fn_rare_touch;
-- DROP TABLE rare_blood_registry;
