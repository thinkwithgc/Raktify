-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001: Geographic hierarchy — states, districts, talukas, villages.
--
-- Sourced from LGD (Local Government Directory, Ministry of Panchayati Raj).
-- LGD codes are the natural keys: states.id and districts.id are the LGD
-- numeric codes, NOT surrogate serials. This keeps imports idempotent and
-- lets us roundtrip with government data sources without translation.
--
-- Activation gating: rows are inserted with is_active = FALSE by the importer.
-- Maharashtra (state code 27) and Amravati district are flipped to TRUE for
-- v1 launch — see scripts/import_lgd.js post-import step.
--
-- has_blood_centre on districts is set TRUE the first time a blood bank
-- onboards in that district (Phase 2 trigger, not enforced here).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE states (
  id            INTEGER PRIMARY KEY,                -- LGD state code
  name          TEXT NOT NULL,
  name_hi       TEXT,
  iso_code      CHAR(5),                            -- e.g. IN-MH
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_states_active ON states(is_active);

CREATE TABLE districts (
  id                 INTEGER PRIMARY KEY,           -- LGD district code
  state_id           INTEGER NOT NULL REFERENCES states(id),
  name               TEXT NOT NULL,
  name_hi            TEXT,
  district_code_short CHAR(4),                       -- 4-char code used in BC-YYYY-DIST-NNNNN refs
  is_active          BOOLEAN NOT NULL DEFAULT FALSE,
  has_blood_centre   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_districts_state ON districts(state_id);
CREATE INDEX idx_districts_active ON districts(is_active) WHERE is_active = TRUE;
CREATE UNIQUE INDEX uq_district_short_per_state ON districts(state_id, district_code_short)
  WHERE district_code_short IS NOT NULL;

CREATE TABLE talukas (
  id            INTEGER PRIMARY KEY,                -- LGD subdistrict code
  district_id   INTEGER NOT NULL REFERENCES districts(id),
  name          TEXT NOT NULL,
  name_hi       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_talukas_district ON talukas(district_id);

CREATE TABLE villages (
  id            INTEGER PRIMARY KEY,                -- LGD village code
  taluka_id     INTEGER NOT NULL REFERENCES talukas(id),
  district_id   INTEGER NOT NULL REFERENCES districts(id),
  state_id      INTEGER NOT NULL REFERENCES states(id),
  name          TEXT NOT NULL,
  name_hi       TEXT,
  pincode       CHAR(6),
  latitude      NUMERIC(9,6),
  longitude     NUMERIC(9,6),
  is_urban      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Search indices: villages will be queried by name during donor registration.
CREATE INDEX idx_villages_taluka  ON villages(taluka_id);
CREATE INDEX idx_villages_district ON villages(district_id);
CREATE INDEX idx_villages_pincode ON villages(pincode);
-- pg_trgm trigram index on village name (extension created in migration 000).
CREATE INDEX idx_villages_name_trgm ON villages USING gin (name gin_trgm_ops);

-- Grants. Geographic data is public reference — every role reads, no role writes via app.
GRANT SELECT ON states, districts, talukas, villages TO app_user;

-- ROLLBACK
-- DROP TABLE villages;
-- DROP TABLE talukas;
-- DROP TABLE districts;
-- DROP TABLE states;
