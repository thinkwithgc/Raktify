-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 263: track which share channel a camp RSVP came from.
--
-- The existing camp_registrations.source captures the high-level bucket
-- (WB / WA / CO / QR). We need finer attribution because organizers will
-- share the public /c/<slug> URL across multiple channels (WhatsApp,
-- Facebook, Instagram, X, Email, QR poster) and want to see which one
-- actually produced donors.
--
-- Free-form TEXT instead of a CHECK so a new channel doesn't require a
-- migration. The frontend canonicalises to a short lowercase string;
-- analytics groups by exact match.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE camp_registrations
  ADD COLUMN IF NOT EXISTS referral_channel TEXT;

CREATE INDEX IF NOT EXISTS idx_camp_reg_channel
  ON camp_registrations(camp_id, referral_channel)
  WHERE referral_channel IS NOT NULL;

COMMENT ON COLUMN camp_registrations.referral_channel IS
  'Fine-grained channel attribution from the share toolkit. '
  'Canonical values: whatsapp, facebook, instagram, twitter, email, qr, direct, web.';

-- ROLLBACK
-- DROP INDEX IF EXISTS idx_camp_reg_channel;
-- ALTER TABLE camp_registrations DROP COLUMN IF EXISTS referral_channel;
