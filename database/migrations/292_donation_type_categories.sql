-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 292: donation_history.donation_type
--
-- HvPI reporting requires splitting donations by *why* they happened, not
-- just where. Adds a two-letter category tag distinct from donation_history.
-- source (which is about the entry mechanism).
--
-- Categories:
--   'VO'  Voluntary          — walk-in / camp / general drive (default)
--   'RE'  Replacement        — invited to replenish BB stock after another
--                              patient received units (V2 replacement flow)
--   'DR'  Directed           — patient's family named the specific donor
--   'DA'  Donor-response      — donor accepted an alert for a specific
--                              request via the platform (V2 donor-BB routing)
--   'AU'  Autologous         — patient donates for their own scheduled surgery
--
-- Auto-tagging happens in the donation-recording flow:
--   • If donation matches an active donor_alert_choice → 'DA'
--   • Else if matches an open replacement_obligation → 'RE'
--   • Else BB picks from dropdown at recording time (default 'VO')
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE donation_history
  ADD COLUMN donation_type CHAR(2) NOT NULL DEFAULT 'VO'
    CHECK (donation_type IN ('VO','RE','DR','DA','AU'));

CREATE INDEX idx_donation_type_hvpi
  ON donation_history(donation_type, collection_date);

-- ROLLBACK
-- DROP INDEX idx_donation_type_hvpi;
-- ALTER TABLE donation_history DROP COLUMN donation_type;
