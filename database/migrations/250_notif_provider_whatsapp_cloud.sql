-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 250: allow 'WC' (WhatsApp Cloud API) as a notification_log provider.
--
-- The provider column was CHECK (provider IN ('M9','LO')) — MSG91 + local
-- console. Raktify sends via the Meta-hosted WhatsApp Business Cloud API
-- directly (no BSP, no India DLT for WhatsApp), so the notifications
-- chokepoint records provider='WC' for those sends. Widen the constraint.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_provider_check;

ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_provider_check
  CHECK (provider IN ('M9', 'LO', 'WC'));   -- M9 MSG91, LO local-console, WC WhatsApp Cloud

COMMENT ON COLUMN notification_log.provider IS
  'M9 = MSG91 BSP, LO = local console outbox, WC = Meta WhatsApp Cloud API';

-- ROLLBACK
-- ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_provider_check;
-- ALTER TABLE notification_log
--   ADD CONSTRAINT notification_log_provider_check CHECK (provider IN ('M9','LO'));
