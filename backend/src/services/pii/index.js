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
 *
 * blindIndex(value) — a deterministic, keyed HMAC used to look up a column
 * whose plaintext we can no longer query once it's sealed (AES-GCM uses a
 * random IV, so equal names produce different ciphertexts — no equality
 * match). We store blindIndex(full_name) in a side column and query THAT for
 * duplicate detection. The index key is derived from the main encryption key
 * via a domain-separation label, so there's no separate secret to provision
 * and the two never share raw key material.
 */
const crypto = require('crypto');
const encryption = require('../encryption');
const env = require('../../config/env');

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

// openRows — openRow across an array of rows. Returns the same array.
function openRows(rows, fields) {
  if (!Array.isArray(rows)) return rows;
  for (const r of rows) openRow(r, fields);
  return rows;
}

// Derive the blind-index HMAC key once from the main encryption key. Domain
// separated by a fixed label so it can never equal the key used for
// encryption. Cached — the key material doesn't change at runtime.
let _blindIndexKey = null;
function blindIndexKey() {
  if (_blindIndexKey) return _blindIndexKey;
  const mainHex = env.local && env.local.encryptionKeyHex;
  if (!mainHex) {
    throw new Error(
      'blindIndex requires the main encryption key (LOCAL_ENCRYPTION_KEY_HEX) to derive its index key',
    );
  }
  _blindIndexKey = crypto
    .createHmac('sha256', Buffer.from(mainHex, 'hex'))
    .update('raktify:blind-index:full_name:v1')
    .digest();
  return _blindIndexKey;
}

// blindIndex(value) — deterministic keyed hash for equality lookup of a
// sealed column. Normalisation (trim + collapse internal whitespace +
// lowercase) mirrors — and slightly widens — the old `LOWER(full_name)`
// match: it still catches every case-insensitive duplicate, plus trivial
// spacing variants ("Ravi  Kumar" == "Ravi Kumar"). Returns null for
// null/blank so a missing name never collides.
function blindIndex(value) {
  if (value == null) return null;
  const norm = String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (norm === '') return null;
  return 'bi1:' + crypto.createHmac('sha256', blindIndexKey()).update(norm, 'utf8').digest('hex');
}

module.exports = { seal, open, openRow, openRows, isSealed, blindIndex };
