-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 305: horizon-based donor engagement — alert_mode (fulfil vs replenish)
--
-- Founder decision (this session): engage donors by the NEED-BY HORIZON, not the
-- urgency tier. A fresh donation must clear TTI screening before it can be issued
-- (~24h, DONATION_USABLE_LEAD_HOURS), so a donor CANNOT fulfil a same-hour need —
-- for short-horizon requests the donor is REPLENISHING stock, not saving that
-- specific patient. Only requests with enough lead time (typically PLANNED) are
-- genuinely donor-FULFILLABLE.
--
--   alert_mode 'FU' = fulfil   (horizon >= lead time; "a patient needs your group
--                               by <date> — can you donate?")
--   alert_mode 'RP' = replenish (horizon < lead time; "we're short on <group> in
--                               <district> — please donate to restock")
--
-- The mode is computed at fire time (donor-alert-gate) from needed_by and stamped
-- on both the pending row (audit) and each donor_alert (drives the notification
-- template). No new tables; no clinical-constant seed (lead time is an operational
-- env value, DONATION_USABLE_LEAD_HOURS).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pending_donor_alerts
  ADD COLUMN alert_mode CHAR(2)
      CHECK (alert_mode IS NULL OR alert_mode IN ('FU','RP'));

ALTER TABLE donor_alerts
  ADD COLUMN alert_mode CHAR(2)
      CHECK (alert_mode IS NULL OR alert_mode IN ('FU','RP'));

COMMENT ON COLUMN donor_alerts.alert_mode IS
  'Horizon-based purpose of this alert: FU = donor can fulfil the request (needed '
  '>= DONATION_USABLE_LEAD_HOURS out); RP = replenish (needed sooner — patient is '
  'served from tested stock, the donor restocks). Drives the notification template.';

-- ROLLBACK
-- ALTER TABLE donor_alerts DROP COLUMN alert_mode;
-- ALTER TABLE pending_donor_alerts DROP COLUMN alert_mode;
