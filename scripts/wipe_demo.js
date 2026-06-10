#!/usr/bin/env node
/**
 * Wipe all demo-seed data from the database — WITHOUT re-seeding.
 *
 * Used for the staging→production cutover: once a real hospital is about to
 * onboard, the seeded fake donors / institutions / requests / camps must be
 * removed so they cannot pollute the real donor pool, leak into reports,
 * match a real emergency, or fire notifications to fake recipients.
 *
 * Reuses the resetDemo() function exported by scripts/seed_demo.js — exactly
 * the same markers, so this script can never drift from the seeder:
 *   • donors        — mobile LIKE '+9190000%'
 *   • institutions  — shortname IN (irwin-hospital, amravati-bloodbank, …)
 *   • requests      — clinical_indication LIKE 'Demo:%'
 *   • camps         — slug LIKE 'demo-camp-%'
 *   • inventory     — isbt_barcode LIKE 'DEMOISBT%' / 'DEMOLEG%'
 *   • thalassemia   — full_name LIKE '[Demo]%'
 *   • rare blood    — phenotype_description LIKE '[Demo]%'
 *   • platform_users — emails @raktify.ngo, dho.*@choudhari.ngo, staff.*@choudhari.ngo
 *
 * Reference data (blood_groups, blood_components, compatibility_matrix,
 * LGD geographic data) is NOT touched — it stays intact for real users.
 * Schema, triggers, RLS policies, audit_log structure: untouched.
 *
 * USAGE:
 *   node scripts/wipe_demo.js              # dry-run: prints before-counts only
 *   node scripts/wipe_demo.js --confirm    # actually wipe
 *
 * The --confirm flag is mandatory for the actual delete. The dry-run shows
 * you exactly how many rows the seeded markers match — sanity-check that
 * before running with --confirm.
 *
 * SAFETY:
 *   • Runs inside a single transaction; any error rolls back the whole wipe.
 *   • Reuses the same session_replication_role=replica context the seeder
 *     uses to bypass append-only triggers on audit_log / escalation_log.
 *   • Connects as the DATABASE_URL user (Azure server admin / Neon admin),
 *     which owns the tables and therefore bypasses RLS.
 *
 * AFTER RUNNING:
 *   1. Verify dashboards show empty / reference-data-only state.
 *   2. Set OTP_ECHO=false in App Service → Configuration.
 *   3. Confirm NOTIFICATIONS_PROVIDER=whatsapp_cloud.
 *   4. Onboard the first real institution via /admin or /onboarding/apply.
 *   5. From this point forward, this DB has real data — DO NOT re-run
 *      seed_demo.js or wipe_demo.js against it.
 */
const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Check .env');
  process.exit(1);
}

const CONFIRM = process.argv.includes('--confirm');
const useSsl = process.env.DATABASE_URL.includes('sslmode=');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  application_name: 'raktify-wipe-demo',
});

const { resetDemo } = require('./seed_demo.js');

// Each entry is [label, count-query]. Counts show how many demo rows
// match before / after the wipe so the operator can verify correctness.
const COUNT_QUERIES = [
  ['donors (demo)',                "SELECT COUNT(*)::int AS n FROM donors WHERE mobile LIKE '+9190000%'"],
  ['platform_users (demo)',        "SELECT COUNT(*)::int AS n FROM platform_users WHERE email LIKE '%@raktify.ngo' OR email LIKE 'dho.%@choudhari.ngo' OR email LIKE 'staff.%@choudhari.ngo' OR mobile LIKE '+9190000%'"],
  ['institutions (demo)',          "SELECT COUNT(*)::int AS n FROM institutions WHERE shortname IN ('irwin-hospital','amravati-bloodbank','civilhospital-amravati','sangamtirth-bb','pending-hosp-1','pending-bb-1')"],
  ['blood_requests (demo)',        "SELECT COUNT(*)::int AS n FROM blood_requests WHERE clinical_indication LIKE 'Demo:%' OR clinical_indication = 'Demo seeded request'"],
  ['donation_camps (demo)',        "SELECT COUNT(*)::int AS n FROM donation_camps WHERE slug LIKE 'demo-camp-%'"],
  ['blood_inventory (demo)',       "SELECT COUNT(*)::int AS n FROM blood_inventory WHERE isbt_barcode LIKE 'DEMOISBT%' OR isbt_barcode LIKE 'DEMOLEG%'"],
  ['donation_history (demo)',      "SELECT COUNT(*)::int AS n FROM donation_history WHERE isbt_barcode LIKE 'DEMOISBT%'"],
  ['thalassemia_patients (demo)',  "SELECT COUNT(*)::int AS n FROM thalassemia_patients WHERE full_name LIKE '[Demo]%'"],
  ['rare_blood_registry (demo)',   "SELECT COUNT(*)::int AS n FROM rare_blood_registry WHERE phenotype_description LIKE '[Demo]%'"],
];

// Reference-data counts (must NOT change after wipe).
const PRESERVED_QUERIES = [
  ['blood_groups (reference)',       'SELECT COUNT(*)::int AS n FROM blood_groups'],
  ['blood_components (reference)',   'SELECT COUNT(*)::int AS n FROM blood_components'],
  ['compatibility_matrix (reference)', 'SELECT COUNT(*)::int AS n FROM compatibility_matrix'],
  ['states (LGD)',                   'SELECT COUNT(*)::int AS n FROM states'],
  ['districts (LGD)',                'SELECT COUNT(*)::int AS n FROM districts'],
];

async function countAll(c, queries) {
  const results = {};
  for (const [label, sql] of queries) {
    // eslint-disable-next-line no-restricted-syntax
    const { rows } = await c.query(sql);
    results[label] = rows[0].n;
  }
  return results;
}

function printCounts(title, counts) {
  console.log(`\n${title}`);
  const w = Math.max(...Object.keys(counts).map((k) => k.length));
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(w)}  ${v}`);
  }
}

(async () => {
  console.log('Raktify · wipe_demo');
  console.log('DATABASE_URL host:', (() => {
    try { return new URL(process.env.DATABASE_URL).host; } catch { return '(unparseable)'; }
  })());
  console.log('Mode:', CONFIRM ? 'DELETE (real wipe)' : 'DRY RUN (counts only — pass --confirm to delete)');

  const c = await pool.connect();
  try {
    const before = await countAll(c, COUNT_QUERIES);
    const preservedBefore = await countAll(c, PRESERVED_QUERIES);
    printCounts('Demo-marker row counts BEFORE:', before);
    printCounts('Reference-data row counts BEFORE (must NOT change):', preservedBefore);

    if (!CONFIRM) {
      console.log('\nDry-run complete. To actually delete, re-run with --confirm.');
      return;
    }

    console.log('\n▸ Beginning transaction…');
    await c.query('BEGIN');
    try {
      await resetDemo(c);
      await c.query('COMMIT');
      console.log('▸ Transaction committed.');
    } catch (err) {
      await c.query('ROLLBACK');
      console.error('Wipe failed — transaction rolled back. No rows deleted.');
      throw err;
    }

    const after = await countAll(c, COUNT_QUERIES);
    const preservedAfter = await countAll(c, PRESERVED_QUERIES);
    printCounts('Demo-marker row counts AFTER (should all be 0):', after);
    printCounts('Reference-data row counts AFTER (must match BEFORE):', preservedAfter);

    // Soft-verify
    const stillDemo = Object.values(after).reduce((a, b) => a + b, 0);
    const refDelta = Object.keys(preservedBefore).some((k) => preservedBefore[k] !== preservedAfter[k]);

    if (stillDemo > 0) {
      console.warn('\nWarning: some demo rows still remain. Review marker filters in seed_demo.js / resetDemo().');
      process.exitCode = 2;
    } else if (refDelta) {
      console.error('\nERROR: reference-data counts changed. This should never happen. Investigate immediately.');
      process.exitCode = 3;
    } else {
      console.log('\n✓ Wipe complete. Schema, reference data, and audit-log structure intact.');
      console.log('Next steps:');
      console.log('  1. Verify dashboards show empty / reference-only state.');
      console.log('  2. Set OTP_ECHO=false in App Service → Configuration → restart.');
      console.log('  3. Confirm NOTIFICATIONS_PROVIDER=whatsapp_cloud.');
      console.log('  4. Onboard first real institution via /admin or /onboarding/apply.');
      console.log('  5. DO NOT run seed_demo.js against this DB again.');
    }
  } finally {
    c.release();
    await pool.end();
  }
})().catch((err) => {
  console.error('wipe_demo failed:', err.message);
  process.exit(1);
});
