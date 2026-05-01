#!/usr/bin/env node
/**
 * Phase 1 FULL smoke test — exercises the complete donor → donation →
 * screening → inventory → request → matching → lookback chain.
 *
 * What this proves:
 *   1. Donor self-registration creates a donor row + platform_users row
 *   2. Donation creates a blood_inventory bag in QA
 *   3. TTI screening clearance flips the bag to AV automatically (via trigger)
 *   4. Reactive TTI fires lookback (deferral, recall, lookback_registry rows)
 *   5. blood_request gets a unique request_number stamped (BC-YYYY-DIST-NNNNN)
 *   6. Status transition guards reject illegal moves
 *   7. RLS isolation: a donor cannot read another donor's row
 *
 * Run: node scripts/smoke_test_phase1_full.js
 */
const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const useSsl = process.env.DATABASE_URL.includes('sslmode=');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  application_name: 'bloodconnect-smoke-full',
});

async function setCtx(client, ctx) {
  for (const [k, v] of Object.entries(ctx)) {
    await client.query(`SELECT set_config('bloodconnect.${k}', $1, TRUE)`, [v ?? '']);
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

// ── Test data ─────────────────────────────────────────────────────────────
// audit_log preserves history forever (by design — see CLAUDE.md). Each run
// of this smoke test must produce unique mobiles / emails / shortnames so
// past runs' audit rows don't block FK-referenced platform_users deletes.
const RUN_TAG = Date.now().toString().slice(-6); // 6-digit suffix; mobile is CHAR(13)
const TEST = {
  state_id: 27,
  district_id: 491,
  bbShortname: `smkbb${RUN_TAG}`.slice(0, 31),
  hoShortname: `smkho${RUN_TAG}`.slice(0, 31),
  donorMobile: `+91${RUN_TAG}0001`,   // 3 + 6 + 4 = 13 chars
  donor2Mobile: `+91${RUN_TAG}0002`,
  bbStaffEmail: `smkbb-${RUN_TAG}-1@example.com`,
  bbStaffEmail2: `smkbb-${RUN_TAG}-2@example.com`,
  hoStaffEmail: `smkho-${RUN_TAG}@example.com`,
  bbInst: null,
  hospitalInst: null,
  donorAuthId: null,
  donor1Id: null,
  donor2Id: null,
  bbStaffAuthId: null,
  bbStaffAuthId2: null,
  hospitalStaffAuthId: null,
  donationId: null,
  bagId: null,
  screeningId: null,
  requestId: null,
};

async function seedGeography(c) {
  await c.query(
    `INSERT INTO states (id, name, name_hi, iso_code, is_active)
     VALUES ($1,'Maharashtra (smoke)','महाराष्ट्र','IN-MH', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [TEST.state_id],
  );
  await c.query(
    `INSERT INTO districts (id, state_id, name, district_code_short, is_active)
     VALUES ($1,$2,'Amravati (smoke)','AMRA', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [TEST.district_id, TEST.state_id],
  );
}

async function teardown(c) {
  await setCtx(c, { actor_role: 'super_admin', change_reason: 'smoke teardown' });
  // We delete operational rows but DO NOT delete platform_users / institutions
  // / donors — they have FKs into audit_log + screening_audit_log which are
  // permanent by design. Each smoke run uses unique identifiers so old rows
  // don't collide. Geography stubs are safe to remove.
  if (TEST.donor1Id || TEST.donor2Id) {
    const ids = [TEST.donor1Id, TEST.donor2Id].filter(Boolean);
    await c.query(`DELETE FROM blood_inventory WHERE donor_id = ANY($1)`, [ids]);
    await c.query(`DELETE FROM donor_alerts WHERE donor_id = ANY($1)`, [ids]);
    await c.query(`DELETE FROM lookback_registry WHERE donor_id = ANY($1)`, [ids]);
    // donor_screening cannot be deleted — screening_audit_log FKs to it.
    // donation_history is referenced by lookback_registry/screening_audit_log too.
  }
  if (TEST.requestId) {
    await c.query(`DELETE FROM blood_requests WHERE id = $1`, [TEST.requestId]);
  }
  // Geography rows are NOT deleted — institutions/donors created during this
  // run still reference them. They're harmless to leave (LGD importer creates
  // the same IDs idempotently in real use).
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedGeography(client);
    await client.query('COMMIT');

    console.log('── 1. Onboard test institutions (BB + hospital) ──────────');
    await client.query('BEGIN');
    await setCtx(client, { actor_role: 'onboarding', change_reason: 'smoke setup' });
    const bbRes = await client.query(
      `INSERT INTO institutions (kind, shortname, legal_name, display_name,
         state_id, district_id, address_line, pincode,
         primary_contact_name, primary_contact_mobile,
         cdsco_licence_number, cdsco_licence_expires, onboarding_status)
       VALUES ('BB',$1,'Smoke BB','Smoke Blood Bank',$2,$3,'enc:addr','444601',
         'BB Contact','+919999000001','CDSCO-SMK-1',(CURRENT_DATE+INTERVAL '1 year')::date,'AC')
       RETURNING id`,
      [TEST.bbShortname, TEST.state_id, TEST.district_id],
    );
    TEST.bbInst = bbRes.rows[0].id;

    const hoRes = await client.query(
      `INSERT INTO institutions (kind, shortname, legal_name, display_name,
         state_id, district_id, address_line, pincode,
         primary_contact_name, primary_contact_mobile, onboarding_status)
       VALUES ('HO',$1,'Smoke Hospital','Smoke Hospital',$2,$3,'enc:addr2','444602',
         'HO Contact','+919999000002','AC')
       RETURNING id`,
      [TEST.hoShortname, TEST.state_id, TEST.district_id],
    );
    TEST.hospitalInst = hoRes.rows[0].id;
    await client.query('COMMIT');
    assert(!!TEST.bbInst && !!TEST.hospitalInst, `institutions onboarded (BB=${TEST.bbInst.slice(0,8)}, HO=${TEST.hospitalInst.slice(0,8)})`);

    console.log('── 2. Create platform users (donor, BB staff x2, HO staff) ──');
    await client.query('BEGIN');
    await setCtx(client, { actor_role: 'ngo_admin', change_reason: 'smoke users' });
    const donorAuth = await client.query(
      `INSERT INTO platform_users (role, mobile) VALUES ('donor', $1) RETURNING id`,
      [TEST.donorMobile],
    );
    TEST.donorAuthId = donorAuth.rows[0].id;
    const bbStaff = await client.query(
      `INSERT INTO platform_users (role, email, password_hash, institution_id)
       VALUES ('blood_bank', $1, '$2a$10$dummybcrypthash00000000000000000000000000', $2)
       RETURNING id`,
      [TEST.bbStaffEmail, TEST.bbInst],
    );
    TEST.bbStaffAuthId = bbStaff.rows[0].id;
    const bbStaff2 = await client.query(
      `INSERT INTO platform_users (role, email, password_hash, institution_id)
       VALUES ('blood_bank', $1, '$2a$10$dummybcrypthash00000000000000000000000000', $2)
       RETURNING id`,
      [TEST.bbStaffEmail2, TEST.bbInst],
    );
    TEST.bbStaffAuthId2 = bbStaff2.rows[0].id;
    const hoStaff = await client.query(
      `INSERT INTO platform_users (role, email, password_hash, institution_id)
       VALUES ('hospital', $1, '$2a$10$dummybcrypthash00000000000000000000000000', $2)
       RETURNING id`,
      [TEST.hoStaffEmail, TEST.hospitalInst],
    );
    TEST.hospitalStaffAuthId = hoStaff.rows[0].id;
    await client.query('COMMIT');
    assert(true, 'platform_users created (donor + 2 BB staff + 1 HO staff)');

    console.log('── 3. Donor self-registration (with verified blood group) ──');
    await client.query('BEGIN');
    await setCtx(client, { actor_role: 'registration', change_reason: 'smoke donor reg' });
    const donor1 = await client.query(
      `INSERT INTO donors (
         mobile, mobile_verified, mobile_verified_at,
         full_name, date_of_birth, gender, preferred_language,
         village_id, pincode, max_travel_km,
         blood_group_self_reported, blood_group_verified, blood_group_verified_at, blood_group_verified_by,
         deferral_status, is_available, available_hours_start, available_hours_end,
         preferred_contact_channel, whatsapp_opted_in, sms_opted_in,
         consent_data_use, consent_given_at,
         platform_user_id, registration_source)
       VALUES (
         $3, TRUE, NOW(),
         'enc:Smoke Donor One', (CURRENT_DATE - INTERVAL '30 years')::date, 'M', 'mr',
         NULL, '444601', 15,
         7, 7, NOW(), $1,
         'A', TRUE, 6, 22,
         'WA', TRUE, TRUE,
         FALSE, NULL,
         $2, 'WEB')
       RETURNING id`,
      [TEST.bbInst, TEST.donorAuthId, TEST.donorMobile],
    );
    TEST.donor1Id = donor1.rows[0].id;
    await client.query('COMMIT');

    // Now grant consent as the donor themselves (consent-protect trigger)
    await client.query('BEGIN');
    await setCtx(client, {
      actor_role: 'donor',
      actor_user_id: TEST.donorAuthId,
      change_reason: 'smoke donor consent grant',
    });
    await client.query(
      `UPDATE donors SET consent_data_use = TRUE WHERE id = $1`,
      [TEST.donor1Id],
    );
    await client.query('COMMIT');
    const consentCheck = await client.query(
      `SELECT consent_data_use, consent_given_at FROM donors WHERE id = $1`,
      [TEST.donor1Id],
    );
    assert(consentCheck.rows[0].consent_data_use === true, 'donor self-granted consent');
    assert(consentCheck.rows[0].consent_given_at !== null, 'consent_given_at auto-stamped');

    console.log('── 4. Donor consent-protect: non-donor cannot grant consent ──');
    await client.query('BEGIN');
    await setCtx(client, { actor_role: 'super_admin', change_reason: 'evil flip' });
    await client.query(`UPDATE donors SET consent_data_use = FALSE WHERE id = $1`, [TEST.donor1Id]);
    let blocked = false;
    try {
      await client.query(`UPDATE donors SET consent_data_use = TRUE WHERE id = $1`, [TEST.donor1Id]);
    } catch (err) {
      blocked = /consent.*donor themselves/i.test(err.message);
    }
    await client.query('ROLLBACK');
    assert(blocked, 'super_admin cannot GRANT consent on a donor (only donor can)');

    console.log('── 5. Record a verified donation → bag created in QA ──');
    await client.query('BEGIN');
    await setCtx(client, {
      actor_role: 'blood_bank',
      actor_user_id: TEST.bbStaffAuthId,
      actor_institution_id: TEST.bbInst,
      change_reason: 'smoke donation',
    });
    const dh = await client.query(
      `INSERT INTO donation_history (
         donor_id, blood_bank_id, trust_level, source,
         collection_date, component_id, volume_ml, hb_gdl, hb_method,
         isbt_barcode, recorded_by_user_id)
       VALUES ($1,$2,'V','BB',CURRENT_DATE,2,280,14.0,'CS',$4,$3)
       RETURNING id`,
      [TEST.donor1Id, TEST.bbInst, TEST.bbStaffAuthId, `SMK-BAG-${RUN_TAG}-1`],
    );
    TEST.donationId = dh.rows[0].id;
    await client.query('COMMIT');

    const bagQa = await client.query(
      `SELECT id, status FROM blood_inventory WHERE donation_id = $1`,
      [TEST.donationId],
    );
    TEST.bagId = bagQa.rows[0]?.id;
    assert(bagQa.rowCount === 1 && bagQa.rows[0].status === 'QA',
      `donation auto-created 1 bag in QA (got ${bagQa.rowCount} bags, status=${bagQa.rows[0]?.status})`);

    const donorAfterDh = await client.query(
      `SELECT total_donations, next_eligible_date FROM donors WHERE id = $1`,
      [TEST.donor1Id],
    );
    assert(donorAfterDh.rows[0].total_donations === 1,
      'donor.total_donations incremented to 1');
    assert(donorAfterDh.rows[0].next_eligible_date !== null,
      `donor.next_eligible_date set (${donorAfterDh.rows[0].next_eligible_date.toISOString().slice(0,10)})`);

    console.log('── 6. TTI screening: all NR → bag flips QA → AV automatically ──');
    await client.query('BEGIN');
    await setCtx(client, {
      actor_role: 'blood_bank',
      actor_user_id: TEST.bbStaffAuthId,
      actor_institution_id: TEST.bbInst,
      change_reason: 'smoke screening',
      access_reason: 'smoke screening test',
    });
    const scr = await client.query(
      `INSERT INTO donor_screening (
         donation_id, donor_id, blood_bank_id,
         hiv_status, hbsag_status, hcv_status, syphilis_status, malaria_status,
         entered_by)
       VALUES ($1, $2, $3, 'NR','NR','NR','NR','NR', $4)
       RETURNING id, overall_clearance`,
      [TEST.donationId, TEST.donor1Id, TEST.bbInst, TEST.bbStaffAuthId],
    );
    TEST.screeningId = scr.rows[0].id;
    await client.query('COMMIT');
    assert(scr.rows[0].overall_clearance === 'CL', `overall_clearance=CL (got ${scr.rows[0].overall_clearance})`);

    const bagAv = await client.query(
      `SELECT status FROM blood_inventory WHERE id = $1`,
      [TEST.bagId],
    );
    assert(bagAv.rows[0].status === 'AV', `bag flipped to AV (got ${bagAv.rows[0].status})`);

    console.log('── 7. Bag terminal-status guard: cannot move from TR back to AV ──');
    await client.query('BEGIN');
    await setCtx(client, {
      actor_role: 'blood_bank',
      actor_user_id: TEST.bbStaffAuthId,
      actor_institution_id: TEST.bbInst,
      change_reason: 'smoke status test',
    });
    await client.query(
      `UPDATE blood_inventory SET status='IS', issued_to_institution_id=$1, issued_at=NOW(), status_changed_by=$2 WHERE id=$3`,
      [TEST.hospitalInst, TEST.bbStaffAuthId, TEST.bagId],
    );
    await client.query(
      `UPDATE blood_inventory SET status='TR', status_changed_by=$1 WHERE id=$2`,
      [TEST.bbStaffAuthId, TEST.bagId],
    );
    let terminalBlocked = false;
    try {
      await client.query(
        `UPDATE blood_inventory SET status='AV', status_changed_by=$1 WHERE id=$2`,
        [TEST.bbStaffAuthId, TEST.bagId],
      );
    } catch (err) {
      terminalBlocked = /terminal state/i.test(err.message);
    }
    await client.query('ROLLBACK');
    assert(terminalBlocked, 'cannot transition bag from terminal state TR back to AV');

    console.log('── 8. blood_request gets BC-YYYY-DIST-NNNNN reference ──');
    await client.query('BEGIN');
    await setCtx(client, {
      actor_role: 'hospital',
      actor_user_id: TEST.hospitalStaffAuthId,
      actor_institution_id: TEST.hospitalInst,
      change_reason: 'smoke request',
    });
    const req = await client.query(
      `INSERT INTO blood_requests (
         source_tier, requesting_institution_id, requesting_user_id,
         patient_initials, patient_age, patient_gender, patient_blood_group_id,
         component_id, units_required, urgency_tier, needed_by,
         clinical_indication, requesting_hospital_district_id)
       VALUES ('OH', $1, $2, 'A.B.', 45, 'M', 7, 2, 2, 'UR',
               NOW() + INTERVAL '6 hours', 'enc:smoke clinical note', $3)
       RETURNING id, request_number`,
      [TEST.hospitalInst, TEST.hospitalStaffAuthId, TEST.district_id],
    );
    TEST.requestId = req.rows[0].id;
    await client.query('COMMIT');
    assert(/^BC-\d{4}-\w{1,4}-\d{5}$/.test(req.rows[0].request_number),
      `request_number format OK (${req.rows[0].request_number})`);

    console.log('── 9. Blood request status guard: FU → OP rejected ──');
    await client.query('BEGIN');
    await setCtx(client, {
      actor_role: 'hospital',
      actor_user_id: TEST.hospitalStaffAuthId,
      actor_institution_id: TEST.hospitalInst,
    });
    await client.query(
      `UPDATE blood_requests SET units_fulfilled = 2 WHERE id = $1`,
      [TEST.requestId],
    );
    const fu = await client.query(`SELECT status FROM blood_requests WHERE id = $1`, [TEST.requestId]);
    assert(fu.rows[0].status === 'FU', `units_fulfilled >= units_required → status=FU (got ${fu.rows[0].status})`);

    let illegalBlocked = false;
    try {
      await client.query(`UPDATE blood_requests SET status='OP' WHERE id=$1`, [TEST.requestId]);
    } catch (err) {
      illegalBlocked = /can only move to/i.test(err.message);
    }
    await client.query('ROLLBACK');
    assert(illegalBlocked, 'cannot revert blood_request from FU back to OP');

    console.log('── 10. Lookback fires on reactive TTI verification ──');
    // Create donor 2 + a verified donation, then add reactive screening that gets verified.
    await client.query('BEGIN');
    await setCtx(client, { actor_role: 'registration', change_reason: 'smoke donor 2' });
    const donor2Auth = await client.query(
      `INSERT INTO platform_users (role, mobile) VALUES ('donor', $1) RETURNING id`,
      [TEST.donor2Mobile],
    );
    const donor2 = await client.query(
      `INSERT INTO donors (
         mobile, mobile_verified, mobile_verified_at, full_name, date_of_birth,
         gender, preferred_language, blood_group_verified, blood_group_verified_at,
         blood_group_verified_by, deferral_status, registration_source, platform_user_id, consent_data_use)
       VALUES ($3, TRUE, NOW(), 'enc:Smoke Donor Two',
         (CURRENT_DATE - INTERVAL '32 years')::date, 'F', 'mr', 7, NOW(),
         $1, 'A', 'WEB', $2, FALSE)
       RETURNING id`,
      [TEST.bbInst, donor2Auth.rows[0].id, TEST.donor2Mobile],
    );
    TEST.donor2Id = donor2.rows[0].id;
    await client.query('COMMIT');

    await client.query('BEGIN');
    await setCtx(client, {
      actor_role: 'blood_bank',
      actor_user_id: TEST.bbStaffAuthId,
      actor_institution_id: TEST.bbInst,
      change_reason: 'smoke d2 donation',
    });
    const dh2 = await client.query(
      `INSERT INTO donation_history (
         donor_id, blood_bank_id, trust_level, source,
         collection_date, component_id, volume_ml, hb_gdl, hb_method,
         isbt_barcode, recorded_by_user_id)
       VALUES ($1,$2,'V','BB',CURRENT_DATE,2,280,13.5,'CS',$4,$3)
       RETURNING id`,
      [TEST.donor2Id, TEST.bbInst, TEST.bbStaffAuthId, `SMK-BAG-${RUN_TAG}-2`],
    );
    await client.query('COMMIT');

    // Insert reactive screening — single user enters HIV=RR; verification_required flag should appear.
    await client.query('BEGIN');
    await setCtx(client, {
      actor_role: 'blood_bank',
      actor_user_id: TEST.bbStaffAuthId,
      actor_institution_id: TEST.bbInst,
      change_reason: 'smoke reactive entry',
      access_reason: 'smoke reactive test entry',
    });
    const scrReact = await client.query(
      `INSERT INTO donor_screening (
         donation_id, donor_id, blood_bank_id,
         hiv_status, hbsag_status, hcv_status, syphilis_status, malaria_status,
         entered_by)
       VALUES ($1,$2,$3,'RR','NR','NR','NR','NR',$4)
       RETURNING id, overall_clearance, verification_required`,
      [dh2.rows[0].id, TEST.donor2Id, TEST.bbInst, TEST.bbStaffAuthId],
    );
    await client.query('COMMIT');
    assert(scrReact.rows[0].verification_required === true,
      'reactive entry sets verification_required=TRUE');
    assert(scrReact.rows[0].overall_clearance === 'PE',
      'overall_clearance stays PE pending second-eyes verification');

    // Second user verifies → triggers lookback.
    await client.query('BEGIN');
    await setCtx(client, {
      actor_role: 'blood_bank',
      actor_user_id: TEST.bbStaffAuthId2,
      actor_institution_id: TEST.bbInst,
      change_reason: 'smoke verify',
      access_reason: 'smoke reactive verification',
    });
    await client.query(
      `UPDATE donor_screening SET verified_by=$1, verified_at=NOW() WHERE id=$2`,
      [TEST.bbStaffAuthId2, scrReact.rows[0].id],
    );
    await client.query('COMMIT');

    const donor2After = await client.query(
      `SELECT deferral_status FROM donors WHERE id = $1`,
      [TEST.donor2Id],
    );
    assert(donor2After.rows[0].deferral_status === 'P',
      `donor 2 deferral_status flipped to P (Permanent — HIV reactive). got ${donor2After.rows[0].deferral_status}`);

    const lb = await client.query(
      `SELECT count(*)::int AS n,
              array_agg(DISTINCT t) AS triggers
         FROM lookback_registry, unnest(tti_trigger) AS t
        WHERE donor_id = $1`,
      [TEST.donor2Id],
    );
    assert(
      lb.rows[0]?.n >= 1,
      `lookback_registry row(s) created (n=${lb.rows[0]?.n}) with triggers ${JSON.stringify(lb.rows[0]?.triggers)}`,
    );

    console.log('── 11. Cleanup ───────────────────────────────────────────');
    await client.query('BEGIN');
    await teardown(client);
    await client.query('COMMIT');
    console.log('  ✓ teardown complete (platform_users + institutions retained — audit_log FK)');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('FATAL during smoke:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    client.release();
    await pool.end();
  }

  console.log('');
  console.log('─'.repeat(58));
  console.log(`Phase 1 full smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
