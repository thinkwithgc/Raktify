/**
 * PII field helper — thin, tolerant wrapper over services/encryption.
 *
 * Two rules make a zero-downtime encryption rollout safe:
 *
 *   seal(value, keyKind)  — encrypt free-text PII for storage.
 *       • null / undefined  → null (never stores the string "null")
 *       • already-sealed     → returned unchanged (idempotent; safe to
 *                              double-call, safe for backfills)
 *       • otherwise          → ciphertext "v1:<provider>:<kind>:<payload>"
 *
 *   open(value)            — decrypt a stored value for use.
 *       • null               → null
 *       • legacy PLAINTEXT   → returned as-is (no cipher header) ← the key
 *                              property: reads keep working while some rows
 *                              are still plaintext, so we can deploy
 *                              encrypt-on-write first and backfill later,
 *                              with no flag day and no broken reads.
 *       • ciphertext         → decrypted (key kind is read from the header,
 *                              so callers don't have to know which key).
 *
 * ONLY use this for free-text (TEXT) PII columns. Fixed-width identifier
 * columns (CHAR(N): mobile, abha_id, aadhaar_last4, guardian_mobile) stay
 * plaintext by design — ciphertext won't fit, and they need equality
 * lookups. See the "Encryption policy" section in CLAUDE.md.
 *
 * keyKind: 'main' (default, general PII) | 'screening' (TTI / health data,
 * backed by a separate key so a main-key compromise can't read health data).
 */
const encryption = require('../encryption');

// Ciphertext header produced by both providers: "v1:loc:..." (local) or
// "v1:kms:..." (KMS). A value that doesn't match is treated as legacy
// plaintext on read.
const SEALED_RE = /^v1:(loc|kms):/;

function isSealed(value) {
  return typeof value === 'string' && SEALED_RE.test(value);
}

function seal(value, keyKind = 'main') {
  if (value == null) return null;
  if (isSealed(value)) return value;
  return encryption.encrypt(String(value), { keyKind });
}

function open(value) {
  if (value == null) return null;
  if (!isSealed(value)) return value; // legacy plaintext passthrough
  // The key kind is encoded in the ciphertext header, so decrypt() reads it
  // itself — callers never have to know which key sealed the value.
  return encryption.decrypt(value);
}

// Convenience for the common case of decrypting several fields on one row
// object in place. Mutates + returns the row. `fields` is a list of column
// names to open.
function openRow(row, fields) {
  if (!row) return row;
  for (const f of fields) {
    if (f in row) row[f] = open(row[f]);
  }
  return row;
}

module.exports = { seal, open, openRow, isSealed };
