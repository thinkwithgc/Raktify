-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 291: blood_requests.attributed_community_id
--
-- Community-first donor routing (V2 spec §6). When a request's requesting
-- hospital is attributed to a community, the donor-alert-gate service pings
-- the community leader's eligible donors FIRST (24-hour exclusive window)
-- before opening to the wider district pool.
--
-- Attribution rules:
--   • Onboarded hospital that names its community during onboarding → auto
--     populated on request creation.
--   • Coordinator can override manually on a per-request basis.
--   • NULL = no community routing; standard district-wide pool.
--
-- The community leader also gets a personal WhatsApp when a request lands
-- in their community — human-mediated push often beats platform pings.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE blood_requests
  ADD COLUMN attributed_community_id UUID REFERENCES communities(id);

CREATE INDEX idx_requests_community
  ON blood_requests(attributed_community_id)
  WHERE attributed_community_id IS NOT NULL
    AND status IN ('OP','MT','AS','PF');

-- ROLLBACK
-- DROP INDEX idx_requests_community;
-- ALTER TABLE blood_requests DROP COLUMN attributed_community_id;
