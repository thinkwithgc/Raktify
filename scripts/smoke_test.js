#!/usr/bin/env node
/**
 * Phase 1 smoke test. Exercises the schema end-to-end:
 *   1. Reference data round-trip (blood_groups, components, compatibility)
 *   2. Insert a test state/district/village so institutions have geography
 *   3. Insert an institution under the "onboarding" actor role
 *   4. Verify audit_log captured every column
 *   5. Update institution.onboarding_status → AC and check is_active flips
 *   6. Confirm audit chain hashes link properly
 *   7. Tear everything down (via DELETE — also audited)
 *
 * Run: node scripts/smoke_test.js
 */
const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const useSsl = process.env.DATABASE_URL.includes('sslmode=');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  application_name: 'raktify-smoke',
});

async function setRlsContext(client, ctx) {
  for (const [k, v] of Object.entries(ctx)) {
    await client.query(`SELECT set_config('raktify.${k}', $1, TRUE)`, [v ?? '']);
  }
}

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    pass++;
  } else {
    console.error(`  ✗ ${msg}`);
    fail++;
  }
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('── 1. Reference data ─────────────────────────────────────');
    const groups = await client.query('SELECT count(*)::int AS n FROM blood_groups');
    assert(groups.rows[0].n === 8, `blood_groups has 8 rows (got ${groups.rows[0].n})`);

    const components = await client.query('SELECT count(*)::int AS n FROM blood_components');
    assert(components.rows[0].n === 6, `blood_components has 6 rows (got ${components.rows[0].n})`);

    const compat = await client.query(
      `SELECT count(*)::int AS n FROM compatibility_matrix
        WHERE component_id = 2 AND donor_group_id = 8 AND is_compatible = TRUE`,
    );
    assert(compat.rows[0].n === 8, `O- PRBC compatible with all 8 groups (got ${compat.rows[0].n})`);

    console.log('── 2. Geography stub ─────────────────────────────────────');
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO states (id, name, name_hi, iso_code, is_active)
       VALUES (27, 'Maharashtra (test)', 'महाराष्ट्र', 'IN-MH', TRUE)
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO districts (id, state_id, name, district_code_short, is_active)
       VALUES (491, 27, 'Amravati (test)', 'AMRA', TRUE)
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query('COMMIT');
    console.log('  ✓ inserted state/district stubs');

    console.log('── 3. Institution insert under onboarding role ───────────');
    await client.query('BEGIN');
    await setRlsContext(client, {
      actor_role: 'onboarding',
      change_reason: 'smoke-test institution onboarding',
      actor_session_id: 'smoke-' + Date.now(),
    });
    const ins = await client.query(
      `INSERT INTO institutions (
         kind, shortname, legal_name, display_name,
         state_id, district_id, address_line, pincode,
         primary_contact_name, primary_contact_mobile,
         cdsco_licence_number, cdsco_licence_expires
       ) VALUES (
         'BB','smoketest','Smoke Test Hospital BB','Smoke BB',
         27, 491, 'enc:address', '444601',
         'Test Contact', '+919999999999',
         'CDSCO-TEST-001', (CURRENT_DATE + INTERVAL '1 year')::date
       ) RETURNING id`,
    );
    const instId = ins.rows[0].id;
    await client.query('COMMIT');
    assert(!!instId, `institution row inserted: ${instId}`);

    console.log('── 4. audit_log captured the INSERT ──────────────────────');
    const auditIns = await client.query(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE table_name = 'institutions' AND record_id = $1 AND event_type = 'INSERT'`,
      [instId],
    );
    assert(auditIns.rows[0].n === 1, `audit_log has 1 INSERT row for institution (got ${auditIns.rows[0].n})`);

    const auditFields = await client.query(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE table_name = 'institutions' AND record_id = $1`,
      [instId],
    );
    assert(auditFields.rows[0].n >= 1, `audit_log has audit row(s) for institution (got ${auditFields.rows[0].n})`);

    console.log('── 5. UPDATE → activate ──────────────────────────────────');
    await client.query('BEGIN');
    await setRlsContext(client, {
      actor_role: 'ngo_admin',
      change_reason: 'smoke-test activation',
      actor_session_id: 'smoke-' + Date.now(),
    });
    await client.query(
      `UPDATE institutions SET onboarding_status = 'AC' WHERE id = $1`,
      [instId],
    );
    await client.query('COMMIT');

    const afterUpd = await client.query(
      'SELECT is_active, onboarded_at FROM institutions WHERE id = $1',
      [instId],
    );
    assert(afterUpd.rows[0].is_active === true, 'is_active flipped TRUE after status=AC');
    assert(afterUpd.rows[0].onboarded_at !== null, 'onboarded_at populated by trigger');

    const auditUpd = await client.query(
      `SELECT field_name FROM audit_log
        WHERE table_name = 'institutions' AND record_id = $1 AND event_type = 'UPDATE'
        ORDER BY id`,
      [instId],
    );
    const fields = auditUpd.rows.map((r) => r.field_name).sort();
    assert(
      fields.includes('onboarding_status') && fields.includes('is_active'),
      `audit captured per-field changes: ${fields.join(', ')}`,
    );

    console.log('── 6. Hash chain integrity ───────────────────────────────');
    const chain = await client.query(
      `SELECT id, row_hash, previous_row_hash
         FROM audit_log
        WHERE table_name = 'institutions' AND record_id = $1
        ORDER BY id`,
      [instId],
    );
    let chainOk = true;
    for (let i = 1; i < chain.rows.length; i++) {
      if (chain.rows[i].previous_row_hash !== chain.rows[i - 1].row_hash) {
        chainOk = false;
        break;
      }
    }
    assert(chainOk && chain.rows.length > 0, `hash chain links across ${chain.rows.length} audit rows`);

    console.log('── 7. Permissions: app_user cannot write audit_log ───────');
    await client.query('BEGIN');
    let denied = false;
    try {
      await client.query('SET LOCAL ROLE app_user');
      await client.query(`
        INSERT INTO audit_log (event_type, table_name, record_id, actor_role, row_hash)
        VALUES ('INSERT','test','x','app_user', repeat('a',64))
      `);
    } catch (err) {
      denied = /permission denied/i.test(err.message);
    }
    await client.query('ROLLBACK');
    assert(denied, 'app_user role is denied INSERT into audit_log');

    console.log('── 8. Cleanup ────────────────────────────────────────────');
    await client.query('BEGIN');
    await setRlsContext(client, {
      actor_role: 'super_admin',
      change_reason: 'smoke-test teardown',
    });
    await client.query('DELETE FROM institutions WHERE id = $1', [instId]);
    await client.query("DELETE FROM districts WHERE id = 491 AND name = 'Amravati (test)'");
    await client.query("DELETE FROM states WHERE id = 27 AND name = 'Maharashtra (test)'");
    await client.query('COMMIT');
    console.log('  ✓ teardown complete');
  } finally {
    client.release();
    await pool.end();
  }

  console.log('');
  console.log('─'.repeat(58));
  console.log(`Smoke test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(2);
});
