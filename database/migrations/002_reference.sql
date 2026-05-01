-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002: Immutable reference tables — blood groups, components, and
-- ABO/Rh compatibility matrix.
--
-- ⚠ CLINICAL DATA WARNING ⚠
-- The seed data for blood_components and compatibility_matrix is loaded by
-- separate seed files (database/seeds/002a*, 002b*, 002c*). Those seeds are
-- currently marked _DRAFT_PENDING_REVIEW and MUST be replaced with values
-- confirmed in writing by the medical advisor before this migration is
-- promoted beyond development.
--
-- Per spec §1.2: "All clinical data fields validated at the database level."
-- After seeding, INSERT/UPDATE/DELETE on these tables are revoked from app_user
-- by the seed file's final block. Only super_admin via DDL can change them.
-- ─────────────────────────────────────────────────────────────────────────────

-- Eight blood groups, ABO × Rh.
CREATE TABLE blood_groups (
  id                    SMALLINT PRIMARY KEY,
  code                  VARCHAR(3) NOT NULL UNIQUE,        -- A+, A-, B+, B-, AB+, AB-, O+, O-
  abo_type              CHAR(2) NOT NULL CHECK (abo_type IN ('A','B','AB','O')),
  rh_factor             CHAR(1) NOT NULL CHECK (rh_factor IN ('+','-')),
  is_rare               BOOLEAN NOT NULL DEFAULT FALSE,
  population_pct_india  NUMERIC(4,1)                       -- approximate population share
);

-- Blood components issued from a single donation (whole blood, PRBC, plasma, …).
-- Shelf life and Hb thresholds are CLINICAL — values populated by seed file.
CREATE TABLE blood_components (
  id                       SMALLINT PRIMARY KEY,
  code                     VARCHAR(8) NOT NULL UNIQUE,
  name_en                  TEXT NOT NULL,
  name_hi                  TEXT,
  name_mr                  TEXT,
  shelf_life_days          SMALLINT NOT NULL CHECK (shelf_life_days > 0),
  storage_temp_min_c       NUMERIC(4,1) NOT NULL,
  storage_temp_max_c       NUMERIC(4,1) NOT NULL,
  requires_agitation       BOOLEAN NOT NULL DEFAULT FALSE,
  requires_crossmatch      BOOLEAN NOT NULL DEFAULT TRUE,
  can_self_donate          BOOLEAN NOT NULL DEFAULT TRUE,
  min_donor_hb_male        NUMERIC(4,1) NOT NULL,
  min_donor_hb_female      NUMERIC(4,1) NOT NULL,
  min_gap_days             SMALLINT NOT NULL CHECK (min_gap_days > 0),
  volume_ml_typical        SMALLINT NOT NULL CHECK (volume_ml_typical > 0),
  isbt_product_code        VARCHAR(8),
  CONSTRAINT temp_range CHECK (storage_temp_max_c >= storage_temp_min_c)
);

-- Per-component compatibility lookup. Used by the matching engine (Phase 5).
-- Whether donor_group→recipient_group is medically permitted for that component.
CREATE TABLE compatibility_matrix (
  component_id        SMALLINT NOT NULL REFERENCES blood_components(id),
  donor_group_id      SMALLINT NOT NULL REFERENCES blood_groups(id),
  recipient_group_id  SMALLINT NOT NULL REFERENCES blood_groups(id),
  is_compatible       BOOLEAN NOT NULL,
  is_preferred        BOOLEAN NOT NULL DEFAULT FALSE,    -- TRUE for same-group matches
  note                TEXT,
  PRIMARY KEY (component_id, donor_group_id, recipient_group_id)
);

CREATE INDEX idx_compat_lookup
  ON compatibility_matrix(component_id, recipient_group_id, is_compatible)
  WHERE is_compatible = TRUE;

-- Reads only — no role writes via API. Seed file flips writes off after data load.
GRANT SELECT ON blood_groups, blood_components, compatibility_matrix TO app_user;

-- ROLLBACK
-- DROP TABLE compatibility_matrix;
-- DROP TABLE blood_components;
-- DROP TABLE blood_groups;
