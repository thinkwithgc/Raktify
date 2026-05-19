#!/usr/bin/env node
/**
 * Demo data seeder — populates a staging database with realistic accounts
 * and content so every portal (hospital / blood bank / coordinator / NGO
 * admin) can be logged into and demoed.
 *
 * NOT for production. Run once against a staging DB:
 *   node scripts/seed_demo.js
 *
 * Re-running is a no-op (it checks for the demo ngo_admin and exits early).
 *
 * Connects as the DATABASE_URL user (the Azure server admin), which owns the
 * tables and therefore bypasses RLS — so inserts are unobstructed.
 */
const path = require('path');
const { Pool } = require('pg');
// bcryptjs is a backend workspace dependency — resolve it from there.
const bcrypt = require(path.join(__dirname, '../backend/node_modules/bcryptjs'));

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Check .env');
  process.exit(1);
}

const useSsl = process.env.DATABASE_URL.includes('sslmode=');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  application_name: 'raktify-seed-demo',
});

const DEMO_PASSWORD = 'RaktifyDemo@2026';
const RESET = process.argv.includes('--reset');

// Remove any previously-seeded demo rows (FK-safe order) so the seed can be
// rebuilt cleanly. Only touches rows with the demo's identifying markers.
async function resetDemo(c) {
  console.log('▸ reset: removing existing demo data');
  await c.query(`DELETE FROM blood_requests WHERE clinical_indication = 'Demo seeded request'`);
  await c.query(
    `DELETE FROM blood_inventory WHERE donation_id IN
       (SELECT id FROM donation_history WHERE isbt_barcode LIKE 'DEMOISBT%')`,
  );
  await c.query(`DELETE FROM donation_history WHERE isbt_barcode LIKE 'DEMOISBT%'`);
  await c.query(`DELETE FROM donors WHERE mobile LIKE '+9190000000%'`);
  await c.query(
    `DELETE FROM coordinators WHERE platform_user_id IN
       (SELECT id FROM platform_users WHERE mobile LIKE '+9190000000%')`,
  );
  await c.query(
    `DELETE FROM platform_users WHERE email LIKE '%@raktify.ngo' OR mobile LIKE '+9190000000%'`,
  );
  await c.query(
    `DELETE FROM institutions WHERE shortname IN ('irwin-hospital', 'amravati-bloodbank')`,
  );
}

async function main() {
  const c = await pool.connect();
  try {
    if (RESET) {
      await resetDemo(c);
    } else {
      const existing = await c.query(
        `SELECT 1 FROM platform_users WHERE email = 'admin@raktify.ngo'`,
      );
      if (existing.rowCount > 0) {
        console.log('Demo data already seeded. Run with --reset to rebuild.');
        return;
      }
    }

    const pwHash = bcrypt.hashSync(DEMO_PASSWORD, 12);

    // ── 1. Geography skeleton ────────────────────────────────────────────
    console.log('▸ geography');
    await c.query(
      `INSERT INTO states (id, name, iso_code, is_active)
       VALUES (27, 'Maharashtra', 'IN-MH', TRUE)
       ON CONFLICT (id) DO NOTHING`,
    );
    await c.query(
      `INSERT INTO districts (id, state_id, name, district_code_short, is_active)
       VALUES (501, 27, 'Amravati', 'AMRA', TRUE),
              (502, 27, 'Pune',     'PUNE', TRUE)
       ON CONFLICT (id) DO NOTHING`,
    );
    await c.query(
      `INSERT INTO talukas (id, district_id, name)
       VALUES (5001, 501, 'Amravati'), (5002, 502, 'Pune City')
       ON CONFLICT (id) DO NOTHING`,
    );
    await c.query(
      `INSERT INTO villages (id, taluka_id, district_id, state_id, name, pincode, is_urban)
       VALUES (50001, 5001, 501, 27, 'Rathi Nagar', '444601', TRUE),
              (50002, 5002, 502, 27, 'Shivajinagar', '411005', TRUE)
       ON CONFLICT (id) DO NOTHING`,
    );

    // ── 2. Institutions ──────────────────────────────────────────────────
    console.log('▸ institutions');
    const hospital = (
      await c.query(
        `INSERT INTO institutions (
           kind, shortname, legal_name, display_name,
           state_id, district_id, taluka_id, address_line, pincode,
           primary_contact_name, primary_contact_mobile, primary_contact_email,
           hospital_registration_no,
           onboarding_status, onboarded_at, is_active)
         VALUES ('HO', 'irwin-hospital',
                 'Irwin Government Hospital', 'Irwin Hospital, Amravati',
                 27, 501, 5001, 'Irwin Square, Amravati', '444601',
                 'Dr. S. Deshmukh', '+919000000101', 'contact@irwin.demo',
                 'MH-CEA-AMRA-0042',
                 'AC', NOW(), TRUE)
         RETURNING id`,
      )
    ).rows[0].id;

    const bloodBank = (
      await c.query(
        `INSERT INTO institutions (
           kind, shortname, legal_name, display_name,
           state_id, district_id, taluka_id, address_line, pincode,
           cdsco_licence_number, cdsco_licence_expires,
           primary_contact_name, primary_contact_mobile, primary_contact_email,
           has_inhouse_blood_bank,
           onboarding_status, onboarded_at, is_active)
         VALUES ('BB', 'amravati-bloodbank',
                 'Amravati District Blood Centre', 'Amravati District Blood Centre',
                 27, 501, 5001, 'Civil Lines, Amravati', '444601',
                 'CDSCO-MH-BB-2210', '2027-12-31',
                 'Dr. A. Kale', '+919000000102', 'contact@adbc.demo',
                 TRUE,
                 'AC', NOW(), TRUE)
         RETURNING id`,
      )
    ).rows[0].id;

    // ── 3. Platform users + coordinator profile ──────────────────────────
    console.log('▸ users');
    async function staff(role, email, institutionId) {
      const r = await c.query(
        `INSERT INTO platform_users (role, email, password_hash, password_set_at, institution_id)
         VALUES ($1, $2, $3, NOW(), $4) RETURNING id`,
        [role, email, pwHash, institutionId],
      );
      return r.rows[0].id;
    }
    await staff('super_admin', 'super@raktify.ngo', null);
    await staff('ngo_admin', 'admin@raktify.ngo', null);
    await staff('hospital', 'hospital@raktify.ngo', hospital);
    await staff('blood_bank', 'bloodbank@raktify.ngo', bloodBank);

    const coordUser = (
      await c.query(
        `INSERT INTO platform_users (role, mobile) VALUES ('coordinator', '+919000000007')
         RETURNING id`,
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO coordinators (
         platform_user_id, full_name, display_name, gender, preferred_language,
         state_id, district_id, taluka_id,
         id_proof_type, id_proof_last4, id_verified_at,
         on_duty, is_district_lead, reliability_score, is_active)
       VALUES ($1, 'Priya Wankhede', 'Priya W.', 'F', 'mr',
               27, 501, 5001,
               'AAD', '4242', NOW(),
               TRUE, TRUE, 96, TRUE)`,
      [coordUser],
    );

    // ── 4. Donors ────────────────────────────────────────────────────────
    console.log('▸ donors');
    // [mobile, name, dob, gender, verified_blood_group_id|null]
    const donorRows = [
      ['+919000000001', 'Ramesh Patil', '1990-04-12', 'M', 7], // O+
      ['+919000000002', 'Sunita Joshi', '1995-08-30', 'F', 1], // A+
      ['+919000000003', 'Imran Shaikh', '1988-01-22', 'M', 3], // B+
      ['+919000000004', 'Anjali More', '1998-11-05', 'F', 7], // O+
      ['+919000000005', 'Vikas Thakre', '1992-06-18', 'M', 5], // AB+
      ['+919000000006', 'Deepa Nair', '1993-03-09', 'F', null], // unverified
    ];
    const donorIds = [];
    for (const [mobile, name, dob, gender, bg] of donorRows) {
      const pu = (
        await c.query(
          `INSERT INTO platform_users (role, mobile) VALUES ('donor', $1) RETURNING id`,
          [mobile],
        )
      ).rows[0].id;
      const d = await c.query(
        `INSERT INTO donors (
           mobile, mobile_verified, mobile_verified_at, full_name, date_of_birth, gender,
           preferred_language, village_id, pincode, max_travel_km,
           blood_group_verified, blood_group_verified_at, blood_group_verified_by,
           is_available, whatsapp_opted_in, sms_opted_in,
           consent_data_use, consent_given_at,
           platform_user_id, registration_source)
         VALUES ($1, TRUE, NOW(), $2, $3, $4,
                 'mr', 50001, '444601', 15,
                 $5::smallint,
                 CASE WHEN $5::smallint IS NOT NULL THEN NOW() ELSE NULL END,
                 CASE WHEN $5::smallint IS NOT NULL THEN $7::uuid ELSE NULL END,
                 TRUE, TRUE, TRUE,
                 TRUE, NOW(),
                 $6, 'WEB')
         RETURNING id`,
        [mobile, name, dob, gender, bg, pu, bloodBank],
      );
      donorIds.push(d.rows[0].id);
    }

    // ── 5. Donations at the blood bank (verified -> trigger creates bags) ─
    console.log('▸ donations + inventory');
    const bbStaffId = (
      await c.query(`SELECT id FROM platform_users WHERE email = 'bloodbank@raktify.ngo'`)
    ).rows[0].id;
    const donationDonors = [donorIds[0], donorIds[1], donorIds[2]]; // the verified ones
    let barcodeN = 1;
    for (const donorId of donationDonors) {
      await c.query(
        `INSERT INTO donation_history (
           donor_id, blood_bank_id, trust_level, source,
           collection_date, component_id, volume_ml,
           hb_gdl, hb_method, isbt_barcode, recorded_by_user_id)
         VALUES ($1, $2, 'V', 'BB',
                 CURRENT_DATE - 7, 2, 350,
                 13.5, 'HC', $3, $4)`,
        [donorId, bloodBank, `DEMOISBT${String(barcodeN++).padStart(6, '0')}`, bbStaffId],
      );
    }

    // ── 6. Blood requests from the hospital ──────────────────────────────
    console.log('▸ blood requests');
    const hospStaffId = (
      await c.query(`SELECT id FROM platform_users WHERE email = 'hospital@raktify.ngo'`)
    ).rows[0].id;
    // [patient_initials, age, gender, blood_group_id, component_id, units, urgency]
    const requestRows = [
      ['R.M.', 34, 'M', 7, 2, 2, 'CR'],
      ['S.K.', 28, 'F', 1, 1, 1, 'UR'],
      ['A.P.', 51, 'M', 3, 2, 3, 'PL'],
    ];
    for (const [initials, age, gender, bg, comp, units, urgency] of requestRows) {
      await c.query(
        `INSERT INTO blood_requests (
           source_tier, requesting_institution_id, requesting_user_id,
           patient_initials, patient_age, patient_gender, patient_blood_group_id,
           component_id, units_required, urgency_tier, needed_by,
           clinical_indication, requesting_hospital_district_id)
         VALUES ('OH', $1, $2,
                 $3, $4, $5, $6,
                 $7, $8, $9, NOW() + INTERVAL '12 hours',
                 'Demo seeded request', 501)`,
        [hospital, hospStaffId, initials, age, gender, bg, comp, units, urgency],
      );
    }

    console.log('\n✅ Demo data seeded.\n');
    console.log('Logins (staff/admin — email + password):');
    console.log(`  super_admin   super@raktify.ngo      ${DEMO_PASSWORD}`);
    console.log(`  ngo_admin     admin@raktify.ngo      ${DEMO_PASSWORD}`);
    console.log(`  hospital      hospital@raktify.ngo   ${DEMO_PASSWORD}`);
    console.log(`  blood_bank    bloodbank@raktify.ngo  ${DEMO_PASSWORD}`);
    console.log('Coordinator (mobile OTP login):  +91 90000 00007');
    console.log('Demo donors (mobile OTP):        +91 90000 00001 … 00006');
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
