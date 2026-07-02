-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 293: communities.blood_donor_alert_priority
--
-- Per-community opt-in for the 24-hour community-first alert window (V2
-- spec §6). Default TRUE — community routing helps most communities and is
-- the pro-social pattern we want to encourage. Leaders can flip to FALSE if
-- their community prefers not to see internal blood-need broadcasts.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE communities
  ADD COLUMN blood_donor_alert_priority BOOLEAN NOT NULL DEFAULT TRUE;

-- ROLLBACK
-- ALTER TABLE communities DROP COLUMN blood_donor_alert_priority;
