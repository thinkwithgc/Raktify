-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 271: community_leaders profile table.
--
-- Parallel to coordinators (migration 006) but SLIMMER:
--   • No district_id  — communities are NOT district-bound (per design Q5);
--     the leader's authority follows their communities, donors can be from
--     anywhere in India.
--   • No on_duty      — they're not on a request-fulfillment rota.
--   • No reliability_score — they don't accept requests; no SLA to measure.
--   • No is_district_lead — escalation handover doesn't pass through them.
--
-- What they DO have:
--   • Identity + light verification (Aadhaar last-4 optional; ngo_admin
--     approval is the real trust anchor).
--   • Approval audit (approved_at + approved_by → which ngo_admin invited).
--   • Suspension fields (with reason; co-leader auto-takeover handled by
--     application logic in Phase 2).
--   • Impact metrics maintained by triggers in Phase 2 (communities, donors,
--     donations, camps). All zero at Phase 1.
--
-- Role-of-platform_user invariant:
--   Postgres CHECK cannot reference other tables. The link is enforced by
--   the FK on platform_user_id + the application code only inserting a
--   community_leaders row when platform_users.role='community_leader'.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE community_leaders (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id            UUID NOT NULL UNIQUE REFERENCES platform_users(id),

  full_name                   TEXT NOT NULL,                    -- encrypted
  display_name                TEXT NOT NULL,                    -- public, used on community profiles
  date_of_birth               DATE,
  gender                      CHAR(1) CHECK (gender IN ('M','F','O')),
  preferred_language          CHAR(2) NOT NULL DEFAULT 'mr'
                              CHECK (preferred_language IN ('mr','hi','en')),

  -- Optional centre-of-gravity geography (helps surface "leaders near you"
  -- discovery later, but does NOT bound the communities they run).
  state_id                    INTEGER REFERENCES states(id),
  district_id                 INTEGER REFERENCES districts(id),

  -- Contact (primary mobile = platform_users.mobile)
  email                       CITEXT,                           -- encrypted, optional
  whatsapp_number             CHAR(13),                         -- encrypted, optional override

  -- Light verification (compared to coordinators' fuller vetting)
  id_proof_type               CHAR(3) CHECK (id_proof_type IN ('AAD','PAN','VOT','DRV','PAS')),
  id_proof_last4              CHAR(4),
  id_verified_at              TIMESTAMPTZ,
  id_verified_by              UUID REFERENCES platform_users(id),

  -- Approval audit — which ngo_admin invited this leader
  approved_at                 TIMESTAMPTZ,
  approved_by                 UUID REFERENCES platform_users(id),
  invitation_notes            TEXT,                             -- "Volunteer ops lead, Marwadi Yuva Manch chapter" — free text

  -- Operational
  joined_at                   DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  suspended_at                TIMESTAMPTZ,
  suspended_by                UUID REFERENCES platform_users(id),
  suspension_reason           TEXT,

  -- Impact metrics — maintained by triggers in Phase 2 (communities/donors/
  -- camps/donation events). Zero at Phase 1.
  communities_count           INTEGER NOT NULL DEFAULT 0,
  total_donor_count           INTEGER NOT NULL DEFAULT 0,
  donations_facilitated       INTEGER NOT NULL DEFAULT 0,
  camps_hosted                INTEGER NOT NULL DEFAULT 0,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_community_leaders_active        ON community_leaders(is_active);
CREATE INDEX idx_community_leaders_district      ON community_leaders(district_id) WHERE district_id IS NOT NULL;
CREATE INDEX idx_community_leaders_platform_user ON community_leaders(platform_user_id);

CREATE OR REPLACE FUNCTION fn_community_leaders_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  -- is_active mirrors suspended_at: setting suspended_at flips is_active off.
  -- Clearing suspended_at (re-activation) flips is_active back on.
  IF NEW.suspended_at IS NOT NULL THEN
    NEW.is_active = FALSE;
  ELSIF OLD.suspended_at IS NOT NULL AND NEW.suspended_at IS NULL THEN
    NEW.is_active = TRUE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_community_leaders_touch
  BEFORE UPDATE ON community_leaders
  FOR EACH ROW EXECUTE FUNCTION fn_community_leaders_touch();

GRANT SELECT, INSERT, UPDATE ON community_leaders TO app_user;

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_community_leaders_touch ON community_leaders;
-- DROP FUNCTION IF EXISTS fn_community_leaders_touch;
-- DROP TABLE IF EXISTS community_leaders;
