#!/usr/bin/env node
/**
 * Backfill: encrypt existing plaintext free-text PII in place.
 *
 * The application seals these columns on write (services/pii). This script
 * catches rows written BEFORE that shipped. Idempotent + re-runnable:
 * `seal()` returns already-sealed values unchanged and skips nulls, and we
 * only touch rows whose value is non-null and not already `v1:`-prefixed.
 *
 * Column → key kind must match what the write path uses:
 *   main key      : donors.address_line, blood_requests.clinical_indication,
 *                   thalassemia_patients.guardian_name
 *   screening key : donor_screening.{notes, nat_target, *_method}
 *
 * donors.full_name is handled separately (backfillDonorFullName): as well as
 * sealing it we must compute its blind index from the PLAINTEXT — once sealed
 * the name is gone, so the seal + index have to happen in the same pass.
 *
 * Fixed-width identifier columns (mobile, abha_id, aadhaar_last4,
 * guardian_mobile) are intentionally NOT here — they stay plaintext (disk
 * encryption + RLS). See CLAUDE.md "Encryption policy".
 *
 * Usage:
 *   node scripts/backfill_pii_encryption.js            # do it
 *   node scripts/backfill_pii_encryption.js --dry-run  # count only
 *
 * Requires DATABASE_URL + the LOCAL_*ENCRYPTION_KEY_HEX env vars (same ones
 * the app uses). Connects as the DB owner, which bypasses RLS for this
 * maintenance write.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { Pool } = require('pg');
const { seal, blindIndex } = require(path.join(
  __dirname,
  '..',
  'backend',
  'src',
  'services',
  'pii',
));

const DRY_RUN = process.argv.includes('--dry-run');

const TARGETS = [
  { table: 'donors', columns: ['address_line'], keyKind: 'main' },
  { table: 'blood_requests', columns: ['clinical_indication'], keyKind: 'main' },
  { table: 'thalassemia_patients', columns: ['guardian_name'], keyKind: 'main' },
  {
    table: 'donor_screening',
    columns: [
      'notes',
      'nat_target',
      'hiv_method',
      'hbsag_method',
      'hcv_method',
      'syphilis_method',
      'malaria_method',
      'nat_method',
    ],
    keyKind: 'screening',
  },
];

async function backfillTable(client, { table, columns, keyKind }) {
  // Rows where at least one target column is plaintext (non-null, no v1: header).
  const whereAny = columns
    .map((c) => `(${c} IS NOT NULL AND ${c} NOT LIKE 'v1:%')`)
    .join(' OR ');
  // eslint-disable-next-line no-restricted-syntax
  const rows = (
    await client.query(`SELECT id, ${columns.join(', ')} FROM ${table} WHERE ${whereAny}`)
  ).rows;

  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows to encrypt`);
    return 0;
  }
  if (DRY_RUN) {
    console.log(`  ${table}: ${rows.length} row(s) would be encrypted (${columns.join(', ')})`);
    return rows.length;
  }

  let updated = 0;
  for (const row of rows) {
    const sets = [];
    const vals = [];
    for (const col of columns) {
      const v = row[col];
      if (v == null || String(v).startsWith('v1:')) continue; // already sealed / null
      vals.push(seal(v, keyKind));
      sets.push(`${col} = $${vals.length}`);
    }
    if (sets.length === 0) continue;
    vals.push(row.id);
    // eslint-disable-next-line no-restricted-syntax
    await client.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    updated += 1;
  }
  console.log(`  ${table}: encrypted ${updated} row(s)`);
  return updated;
}

// donors.full_name — seal + populate the blind index in the same pass. The
// blind index is computed from the PLAINTEXT (before sealing), so we can't
// split this into "seal now, index later": once sealed the name is gone.
async function backfillDonorFullName(client) {
  const rows = (
    await client.query(
      `SELECT id, full_name FROM donors
        WHERE full_name IS NOT NULL AND full_name NOT LIKE 'v1:%'`,
    )
  ).rows;

  if (rows.length === 0) {
    console.log('  donors.full_name: 0 rows to encrypt');
    return 0;
  }
  if (DRY_RUN) {
    console.log(`  donors.full_name: ${rows.length} row(s) would be sealed + indexed`);
    return rows.length;
  }

  let updated = 0;
  for (const row of rows) {
    await client.query(`UPDATE donors SET full_name = $1, full_name_bidx = $2 WHERE id = $3`, [
      seal(row.full_name),
      blindIndex(row.full_name),
      row.id,
    ]);
    updated += 1;
  }
  console.log(`  donors.full_name: sealed + indexed ${updated} row(s)`);
  return updated;
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const useSsl = process.env.DATABASE_URL.includes('sslmode=');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: true } : false,
    application_name: 'raktify-pii-backfill',
  });
  console.log(`PII encryption backfill${DRY_RUN ? ' (dry-run)' : ''}:`);
  const client = await pool.connect();
  let total = 0;
  try {
    for (const t of TARGETS) {
      total += await backfillTable(client, t);
    }
    total += await backfillDonorFullName(client);
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`\nDone. ${total} row(s) ${DRY_RUN ? 'pending' : 'encrypted'}.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
