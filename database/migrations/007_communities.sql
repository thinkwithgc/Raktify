-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 007: communities — coordinator-led donor groups, with optional
-- WhatsApp Group bridge config.
--
-- A community is the social unit donors register into. Examples:
--   "Amravati Engineering Students", "Irwin Hospital Staff Donors",
--   "Walking-distance neighbours of Saiyog Apartments".
--
-- Each community has exactly one coordinator owner (1-N) and zero-or-more
-- additional moderator coordinators (handover support). When the owning
-- coordinator goes off-duty for > 7 days, the lead coordinator for the
-- district auto-takes over via Phase 5 escalation logic.
--
-- WhatsApp bridge: optional. If wa_group_jid is present, alerts can be
-- broadcast to the WhatsApp group via MSG91 instead of individual donor pings.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE communities (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_coordinator_id     UUID NOT NULL REFERENCES coordinators(id),
  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL UNIQUE,
  description              TEXT,

  -- Geography (the community's centre of gravity — used to suggest joins)
  state_id                 INTEGER NOT NULL REFERENCES states(id),
  district_id              INTEGER NOT NULL REFERENCES districts(id),
  taluka_id                INTEGER REFERENCES talukas(id),

  -- WhatsApp bridge (optional)
  wa_group_jid             TEXT,                             -- @g.us identifier
  wa_group_invite_link     TEXT,
  wa_bridge_enabled        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Counters (denormalized; maintained by trigger when donor.community_id changes)
  donor_count              INTEGER NOT NULL DEFAULT 0,
  active_donor_count       INTEGER NOT NULL DEFAULT 0,
  donations_facilitated    INTEGER NOT NULL DEFAULT 0,

  is_public                BOOLEAN NOT NULL DEFAULT TRUE,    -- discoverable in search
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT slug_format CHECK (slug ~ '^[a-z][a-z0-9-]{2,63}$'),
  CONSTRAINT wa_bridge_consistent CHECK (wa_bridge_enabled = FALSE OR wa_group_jid IS NOT NULL)
);

CREATE INDEX idx_communities_owner    ON communities(owner_coordinator_id);
CREATE INDEX idx_communities_district ON communities(district_id) WHERE is_active = TRUE;

-- Optional secondary moderators (many-to-many)
CREATE TABLE community_moderators (
  community_id     UUID NOT NULL REFERENCES communities(id),
  coordinator_id   UUID NOT NULL REFERENCES coordinators(id),
  added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by         UUID REFERENCES platform_users(id),
  PRIMARY KEY (community_id, coordinator_id)
);

CREATE OR REPLACE FUNCTION fn_communities_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_communities_touch
  BEFORE UPDATE ON communities
  FOR EACH ROW EXECUTE FUNCTION fn_communities_touch();

GRANT SELECT, INSERT, UPDATE ON communities, community_moderators TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_communities_touch ON communities;
-- DROP FUNCTION fn_communities_touch;
-- DROP TABLE community_moderators;
-- DROP TABLE communities;
