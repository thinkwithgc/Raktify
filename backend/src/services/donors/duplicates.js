/**
 * Donor duplicate detection (spec §5.3).
 *
 * Run BEFORE INSERT on every new donor registration. Three sequential checks:
 *
 *   Check 1 — ABHA ID match: if submitted ABHA ID exists on another donor,
 *             BLOCK registration. Return code='abha_collision'.
 *
 *   Check 2 — Name + DOB exact match (case-insensitive): flag the new row's
 *             suspected_duplicate_of and ALLOW registration. Alert ngo_admin.
 *             Return code='name_dob_collision'.
 *
 *   Check 3 — Aadhaar last4 + DOB match: same action as Check 2.
 *             Return code='aadhaar_dob_collision'.
 *
 *   Check 4 — Soundex match (deferred). Logged for periodic review only.
 *
 * Caller pattern:
 *   const dup = await checkDuplicates(client, candidate);
 *   if (dup.action === 'BLOCK') return 409;
 *   // candidate.suspected_duplicate_of = dup.match_id  (set on INSERT below)
 */

const { blindIndex } = require('../pii');

async function checkDuplicates(client, candidate) {
  // 1. ABHA — strict block (one identity per platform)
  if (candidate.abha_id) {
    const r = await client.query(
      `SELECT id FROM donors WHERE abha_id = $1 AND is_active = TRUE LIMIT 1`,
      [candidate.abha_id],
    );
    if (r.rowCount > 0) {
      return {
        action: 'BLOCK',
        code: 'abha_collision',
        match_id: r.rows[0].id,
        message:
          'A profile already exists with this health ID. If you changed your number, contact support.',
      };
    }
  }

  // 2. Name + DOB exact (case-insensitive). full_name is column-encrypted,
  //    so we can no longer LOWER()-compare it — match on the keyed blind
  //    index instead (same normalisation as the write path).
  if (candidate.full_name && candidate.date_of_birth) {
    const r = await client.query(
      `SELECT id FROM donors
        WHERE full_name_bidx = $1
          AND date_of_birth = $2
          AND is_active = TRUE
        LIMIT 1`,
      [blindIndex(candidate.full_name), candidate.date_of_birth],
    );
    if (r.rowCount > 0) {
      return {
        action: 'FLAG',
        code: 'name_dob_collision',
        match_id: r.rows[0].id,
        message: 'Possible duplicate detected — flagged for admin review.',
      };
    }
  }

  // 3. Aadhaar last4 + DOB
  if (candidate.aadhaar_last4 && candidate.date_of_birth) {
    const r = await client.query(
      `SELECT id FROM donors
        WHERE aadhaar_last4 = $1
          AND date_of_birth = $2
          AND is_active = TRUE
        LIMIT 1`,
      [candidate.aadhaar_last4, candidate.date_of_birth],
    );
    if (r.rowCount > 0) {
      return {
        action: 'FLAG',
        code: 'aadhaar_dob_collision',
        match_id: r.rows[0].id,
        message: 'Possible duplicate detected (aadhaar+DOB) — flagged for admin review.',
      };
    }
  }

  return { action: 'OK' };
}

module.exports = { checkDuplicates };
