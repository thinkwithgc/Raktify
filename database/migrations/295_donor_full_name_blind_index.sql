-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 295: donors.full_name_bidx (blind index)
--
-- DPDP Act 2023 §8(5) — column-level encryption of donor names. Once
-- donors.full_name is sealed with AES-256-GCM (random IV), equal names no
-- longer produce equal ciphertext, so the duplicate-detection query
-- `WHERE LOWER(full_name) = LOWER($1)` can no longer match. We add a keyed
-- blind index — a deterministic HMAC of the normalised name
-- (services/pii.blindIndex) — and query THAT instead.
--
-- The column is nullable and back-filled by scripts/backfill_pii_encryption.js.
-- New rows populate it on INSERT (donor register + BB bulk import). It holds
-- an opaque HMAC digest, never the name, so it is safe at rest even though it
-- is indexed. The partial index keeps it out of the way for the (transient,
-- pre-backfill) rows where it is still NULL.
--
-- No data is destroyed here; the plaintext→ciphertext migration of the
-- full_name column itself is done by the backfill, not this DDL.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE donors
  ADD COLUMN full_name_bidx TEXT;

COMMENT ON COLUMN donors.full_name_bidx IS
  'Keyed HMAC blind index of full_name (services/pii.blindIndex). Enables '
  'exact duplicate lookup once full_name is column-encrypted. Never the name.';

CREATE INDEX idx_donors_full_name_bidx
  ON donors(full_name_bidx)
  WHERE full_name_bidx IS NOT NULL;

-- ROLLBACK
-- DROP INDEX idx_donors_full_name_bidx;
-- ALTER TABLE donors DROP COLUMN full_name_bidx;
