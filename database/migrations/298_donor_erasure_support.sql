-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 298: donor erasure support (DPDP Act 2023 §12 — right to erasure)
--
-- Founder decision (docs/Raktify_Data_Retention_Matrix.md): on an erasure
-- request we ANONYMISE the donor — scrub every identifying field on the
-- `donors` row AND the linked `platform_users` auth row — but KEEP the
-- de-identified clinical record (donation_history, donor_screening) and the
-- immutable audit_log. Blood-safety lookback + hemovigilance depend on those,
-- and DPDP §12 exempts data retained under a legal obligation.
--
-- This migration only adds the storage support; the scrub itself lives in
-- backend/src/services/donors/erasure.js so it runs in one transaction under
-- the caller's RLS context.
--
--   • donors.erased_at   — NULL = live record; a timestamp = anonymised.
--   • donor_erasure_seq  — feeds a unique, format-agnostic tombstone for the
--     scrubbed mobile. `mobile` is CHAR(13) NOT NULL UNIQUE on donors and
--     (for the donor role) NOT NULL UNIQUE on platform_users, so it cannot be
--     nulled — it is overwritten with 'ERSD' || 9-digit seq (= 13 chars).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE donors ADD COLUMN erased_at TIMESTAMPTZ;

COMMENT ON COLUMN donors.erased_at IS
  'DPDP §12: timestamp the donor PII was erased/anonymised. NULL = active record.';

CREATE INDEX idx_donors_erased ON donors(erased_at) WHERE erased_at IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS donor_erasure_seq;

-- ROLLBACK
-- DROP SEQUENCE IF EXISTS donor_erasure_seq;
-- DROP INDEX IF EXISTS idx_donors_erased;
-- ALTER TABLE donors DROP COLUMN erased_at;
