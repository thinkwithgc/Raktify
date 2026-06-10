#!/usr/bin/env node
/**
 * Rich demo seeder — populates a staging database with ~6 months of realistic
 * activity so every portal (donor / hospital / blood bank / coordinator / NGO
 * admin / DHO) shows a fully-populated dashboard instead of empty cards.
 *
 * NOT for production. Run once against a staging DB:
 *   node scripts/seed_demo.js --reset
 *
 * The --reset flag wipes prior demo rows (by markers) and rebuilds. Without
 * --reset, re-running is a no-op once the demo ngo_admin exists.
 *
 * Connects as the DATABASE_URL user (the Azure server admin), which owns the
 * tables and therefore bypasses RLS — so inserts are unobstructed.
 *
 * Roughly what gets seeded:
 *   • 4 institutions (2 hospitals, 2 blood banks)
 *   • 5 staff platform users (super, admin, hospital, BB, DHO) + 2 coordinators
 *   • 30 donors with realistic blood-group / gender / age distribution
 *   • ~120 donations spread across 6 months (creates inventory bags via trigger)
 *   • TTI screenings for every donation (mostly cleared, occasional reactive)
 *   • Inventory aged into AV / IS / TR / EX / QA / RE / RC states
 *   • ~30 blood requests across 90 days in mixed statuses + urgency tiers
 *   • 5 donation camps (completed, planned, pending review)
 *   • Camp registrations + attendance
 *   • 6 thalassemia patients with varied transfusion schedules
 *   • 4 rare-blood entries (donor-linked + shadow)
 *   • 2 lookback investigations (1 open, 1 closed)
 *   • 2 pending institution onboarding applications
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

// ── Helpers ───────────────────────────────────────────────────────────────
function rand(n) {
  return Math.floor(Math.random() * n);
}
function pick(arr) {
  return arr[rand(arr.length)];
}
function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
function daysAgoDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function daysFromNowIso(days) {
  return daysAgoIso(-days);
}
function daysFromNowDate(days) {
  return daysAgoDate(-days);
}

// 30 realistic Indian donor names — diverse regions
const DONOR_ROSTER = [
  ['Ramesh Patil', 'M', '1990-04-12', 7],         // O+
  ['Sunita Joshi', 'F', '1995-08-30', 1],         // A+
  ['Imran Shaikh', 'M', '1988-01-22', 3],         // B+
  ['Anjali More', 'F', '1998-11-05', 7],          // O+
  ['Vikas Thakre', 'M', '1992-06-18', 5],         // AB+
  ['Deepa Nair', 'F', '1993-03-09', null],        // unverified
  ['Pradeep Kale', 'M', '1985-09-14', 7],         // O+
  ['Meera Iyer', 'F', '1991-02-28', 1],           // A+
  ['Sanjay Khade', 'M', '1989-07-03', 3],         // B+
  ['Pooja Wagh', 'F', '1996-12-21', 7],           // O+
  ['Rajesh Bhat', 'M', '1983-04-19', 8],          // O-  (rare)
  ['Asha Mehta', 'F', '1994-10-08', 2],           // A-  (rare)
  ['Nilesh Choure', 'M', '1990-05-25', 3],        // B+
  ['Kavita Pawar', 'F', '1987-08-11', 7],         // O+
  ['Suresh Deshpande', 'M', '1982-03-30', 5],     // AB+
  ['Reena Khatri', 'F', '1999-01-15', 1],         // A+
  ['Manoj Suryawanshi', 'M', '1986-06-07', 7],    // O+
  ['Snehal Bhosale', 'F', '1992-11-23', 3],       // B+
  ['Anil Mahajan', 'M', '1981-09-02', 4],         // B-  (rare)
  ['Vaishali Rao', 'F', '1997-04-17', 7],         // O+
  ['Ganesh Pingle', 'M', '1984-12-09', 1],        // A+
  ['Sneha Karpe', 'F', '1995-07-26', 7],          // O+
  ['Rohit Patwardhan', 'M', '1991-10-04', 5],     // AB+
  ['Priyanka Salunkhe', 'F', '1988-05-13', 3],    // B+
  ['Akash Wankhede', 'M', '1993-03-20', 7],       // O+
  ['Smita Junghare', 'F', '1990-08-29', 1],       // A+
  ['Bhavesh Patil', 'M', '1996-01-11', 7],        // O+
  ['Madhuri Kulkarni', 'F', '1985-06-06', 3],     // B+
  ['Hrishikesh Lokhande', 'M', '1989-11-30', 6],  // AB-  (very rare)
  ['Trupti Chaudhari', 'F', '1994-09-15', 7],     // O+
];

// Map blood_group_id (1-8) -> code
const BG_CODE = { 1: 'A+', 2: 'A-', 3: 'B+', 4: 'B-', 5: 'AB+', 6: 'AB-', 7: 'O+', 8: 'O-' };

// Component shelf life (days) per spec
const SHELF_LIFE = { 1: 35, 2: 42, 3: 365, 4: 5, 5: 5, 6: 365 };
const COMPONENT_VOLUME = { 1: 450, 2: 280, 3: 220, 4: 50, 5: 220, 6: 30 };

// ── Trigger-bypass helper ────────────────────────────────────────────────
//
// Several seed-time operations (deleting from append-only audit tables;
// inserting back-dated donation_history that would otherwise trigger
// next-eligible recomputes, auto-inventory creation, lookback-on-reactive
// cascades) need triggers OFF for the duration of the operation.
//
// On Azure Postgres / self-hosted superuser connections, this is one line:
//   SET session_replication_role = replica
//
// On Neon (and most managed Postgres without superuser), that SET is
// blocked — but the table owner (`neondb_owner` on Neon) can disable user
// triggers per-table via ALTER TABLE ... DISABLE TRIGGER USER, which has
// the same effect for our seed's purposes.
//
// This helper tries SET first, falls back to per-table DISABLE on
// permission error, and returns a "mode" token the caller restores with
// restoreTriggers().
const BYPASS_TABLES = [
  'donors', 'platform_users', 'coordinators', 'institutions',
  'donation_history', 'blood_inventory', 'donor_screening',
  'screening_audit_log', 'lookback_registry', 'donor_alerts',
  'escalation_log', 'request_assignments', 'request_threads',
  'blood_requests', 'donation_camps', 'camp_registrations',
  'audit_log', 'notification_log',
];

async function disableTriggers(c) {
  try {
    await c.query(`SET session_replication_role = replica`);
    return 'session';
  } catch (e) {
    if (e.code !== '42501') throw e;
    // Managed Postgres without superuser (Neon, etc.) — fall back to
    // per-table disable. Owner privilege is sufficient.
    for (const t of BYPASS_TABLES) {
      // eslint-disable-next-line no-restricted-syntax
      await c.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    }
    return 'per-table';
  }
}

async function restoreTriggers(c, mode) {
  if (mode === 'session') {
    await c.query(`SET session_replication_role = origin`);
  } else if (mode === 'per-table') {
    for (const t of BYPASS_TABLES) {
      // eslint-disable-next-line no-restricted-syntax
      await c.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    }
  }
}

// ── Reset ────────────────────────────────────────────────────────────────
//
// Removes prior demo rows so the seed can rebuild from a known state.
// Triggers are bypassed for the duration so append-only guards on
// audit_log / escalation_log / screening_audit_log don't block the
// deletes. See disableTriggers() above for the Azure-vs-Neon detection.
async function resetDemo(c) {
  console.log('▸ reset: removing existing demo data');
  const mode = await disableTriggers(c);
  try {
    // Lookback (auto-created by the screening trigger — no [Demo] marker)
    await c.query(
      `DELETE FROM lookback_registry
        WHERE donor_id IN (SELECT id FROM donors WHERE mobile LIKE '+9190000%')`,
    );
    await c.query(`DELETE FROM rare_blood_registry WHERE phenotype_description LIKE '[Demo]%'`);
    await c.query(`DELETE FROM thalassemia_patients WHERE full_name LIKE '[Demo]%'`);
    await c.query(`DELETE FROM camp_registrations WHERE donor_id IN (SELECT id FROM donors WHERE mobile LIKE '+9190000%')`);
    await c.query(`DELETE FROM donation_camps WHERE slug LIKE 'demo-camp-%'`);

    // blood_requests + all child tables
    const demoReqFilter = `(clinical_indication LIKE 'Demo:%' OR clinical_indication = 'Demo seeded request')`;
    for (const child of [
      'request_assignments',
      'request_documents',
      'request_threads',
      'donor_alerts',
      'escalation_log',
    ]) {
      // eslint-disable-next-line no-restricted-syntax
      await c.query(`DELETE FROM ${child} WHERE request_id IN (SELECT id FROM blood_requests WHERE ${demoReqFilter})`);
    }
    await c.query(
      `UPDATE notification_log SET related_request_id = NULL
         WHERE related_request_id IN (SELECT id FROM blood_requests WHERE ${demoReqFilter})`,
    );
    await c.query(
      `UPDATE blood_inventory
          SET status = 'AV', reserved_for_request_id = NULL
        WHERE reserved_for_request_id IN (SELECT id FROM blood_requests WHERE ${demoReqFilter})`,
    );
    // eslint-disable-next-line no-restricted-syntax
    await c.query(`DELETE FROM blood_requests WHERE ${demoReqFilter}`);

    // Donor-side child tables (notification + alerts + screening + inventory + donations)
    const donorFilter = `(SELECT id FROM donors WHERE mobile LIKE '+9190000%')`;
    await c.query(`UPDATE notification_log SET recipient_donor_id = NULL WHERE recipient_donor_id IN ${donorFilter}`);
    await c.query(`DELETE FROM donor_alerts WHERE donor_id IN ${donorFilter}`);
    await c.query(`DELETE FROM screening_audit_log WHERE donor_id IN ${donorFilter}`);
    await c.query(`DELETE FROM donor_screening WHERE donor_id IN ${donorFilter}`);
    await c.query(`DELETE FROM blood_inventory WHERE isbt_barcode LIKE 'DEMOISBT%' OR isbt_barcode LIKE 'DEMOLEG%'`);
    await c.query(`DELETE FROM donation_history WHERE isbt_barcode LIKE 'DEMOISBT%'`);
    await c.query(`DELETE FROM institution_referrals WHERE primary_referrer_id IN ${donorFilter}`);
    await c.query(`DELETE FROM donors WHERE mobile LIKE '+9190000%'`);

    // Platform-user side
    await c.query(
      `DELETE FROM coordinators WHERE platform_user_id IN
         (SELECT id FROM platform_users WHERE mobile LIKE '+9190000%')`,
    );
    await c.query(
      `DELETE FROM platform_users
        WHERE email LIKE '%@raktify.ngo'
           OR email LIKE 'dho.%@choudhari.ngo'
           OR email LIKE 'staff.%@choudhari.ngo'
           OR mobile LIKE '+9190000%'`,
    );

    // Audit-log entries that reference the demo institutions about to be dropped
    await c.query(
      `DELETE FROM audit_log
        WHERE actor_institution_id IN (
          SELECT id FROM institutions WHERE shortname IN
            ('irwin-hospital','amravati-bloodbank','civilhospital-amravati',
             'sangamtirth-bb','pending-hosp-1','pending-bb-1'))`,
    );
    await c.query(
      `DELETE FROM institutions WHERE shortname IN
         ('irwin-hospital','amravati-bloodbank','civilhospital-amravati',
          'sangamtirth-bb','pending-hosp-1','pending-bb-1')`,
    );
  } finally {
    await restoreTriggers(c, mode);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
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

    // ── 1. Geography ────────────────────────────────────────────────────
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
       VALUES (5001, 501, 'Amravati'), (5002, 502, 'Pune City'),
              (5003, 501, 'Achalpur'),  (5004, 501, 'Daryapur')
       ON CONFLICT (id) DO NOTHING`,
    );
    await c.query(
      `INSERT INTO villages (id, taluka_id, district_id, state_id, name, pincode, is_urban)
       VALUES (50001, 5001, 501, 27, 'Rathi Nagar',  '444601', TRUE),
              (50002, 5002, 502, 27, 'Shivajinagar', '411005', TRUE),
              (50003, 5003, 501, 27, 'Achalpur',     '444806', FALSE),
              (50004, 5004, 501, 27, 'Daryapur',     '444803', FALSE)
       ON CONFLICT (id) DO NOTHING`,
    );

    // ── 2. Institutions ────────────────────────────────────────────────
    console.log('▸ institutions (4 active + 2 pending)');
    async function newInstitution(opts) {
      const isActive = opts.status === 'AC' || !opts.status;
      // onboarded_at is TIMESTAMPTZ — we can't interpolate NOW() through a
      // parameter, so insert NULL and (when active) set it via a follow-up
      // UPDATE that uses a server-side expression.
      const r = await c.query(
        `INSERT INTO institutions (
           kind, shortname, legal_name, display_name,
           state_id, district_id, taluka_id, address_line, pincode,
           primary_contact_name, primary_contact_mobile, primary_contact_email,
           cdsco_licence_number, cdsco_licence_expires, hospital_registration_no,
           onboarding_status, is_active)
         VALUES ($1, $2, $3, $4, 27, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          opts.kind, opts.shortname, opts.legal_name, opts.display_name,
          opts.district_id || 501, opts.taluka_id || 5001, opts.address, opts.pincode,
          opts.contact_name, opts.contact_mobile, opts.contact_email,
          opts.cdsco || null, opts.cdsco_expires || null, opts.reg_no || null,
          opts.status || 'AC',
          opts.is_active !== false,
        ],
      );
      if (isActive) {
        await c.query(
          `UPDATE institutions SET onboarded_at = NOW() - INTERVAL '6 months' WHERE id = $1`,
          [r.rows[0].id],
        );
      }
      return r.rows[0].id;
    }

    const hospital = await newInstitution({
      kind: 'HO', shortname: 'irwin-hospital',
      legal_name: 'Irwin Government Hospital',
      display_name: 'Irwin Hospital, Amravati',
      address: 'Irwin Square, Amravati', pincode: '444601',
      contact_name: 'Dr. S. Deshmukh', contact_mobile: '+919000000101',
      contact_email: 'contact@irwin.demo',
      reg_no: 'MH-CEA-AMRA-0042',
    });
    const bloodBank = await newInstitution({
      kind: 'BB', shortname: 'amravati-bloodbank',
      legal_name: 'Amravati District Blood Centre',
      display_name: 'Amravati Blood Centre',
      address: 'Civil Hospital Campus, Amravati', pincode: '444602',
      contact_name: 'Dr. A. Kale', contact_mobile: '+919000000102',
      contact_email: 'contact@adbc.demo',
      cdsco: 'MH/BC/12-789/2026', cdsco_expires: '2027-12-31',
    });
    const hospital2 = await newInstitution({
      kind: 'HO', shortname: 'civilhospital-amravati',
      legal_name: 'Civil Hospital Amravati',
      display_name: 'Civil Hospital, Amravati',
      address: 'Civil Lines, Amravati', pincode: '444602',
      contact_name: 'Dr. R. Bhambore', contact_mobile: '+919000000103',
      contact_email: 'contact@civilamravati.demo',
      reg_no: 'MH-CEA-AMRA-0019',
    });
    const bloodBank2 = await newInstitution({
      kind: 'BB', shortname: 'sangamtirth-bb',
      legal_name: 'Sangamtirth Charitable Blood Bank',
      display_name: 'Sangamtirth Blood Bank',
      address: 'Sangam Tirth Road, Daryapur', pincode: '444803',
      district_id: 501, taluka_id: 5004,
      contact_name: 'Dr. V. Karpe', contact_mobile: '+919000000104',
      contact_email: 'contact@sangamtirth.demo',
      cdsco: 'MH/BC/12-450/2026', cdsco_expires: '2026-08-15',
    });
    // Pending applications for the Onboarding tab
    const pendHosp = await newInstitution({
      kind: 'HO', shortname: 'pending-hosp-1',
      legal_name: 'Sant Gadge Baba Memorial Hospital',
      display_name: 'SGB Memorial Hospital',
      address: 'Vidyut Nagar, Amravati', pincode: '444604',
      contact_name: 'Dr. P. Yawalkar', contact_mobile: '+919000000105',
      contact_email: 'contact@sgbmh.demo',
      reg_no: 'MH-CEA-AMRA-0088',
      status: 'PE',
    });
    const pendBB = await newInstitution({
      kind: 'BB', shortname: 'pending-bb-1',
      legal_name: 'Achalpur Public Blood Centre',
      display_name: 'Achalpur Blood Centre',
      address: 'GH Road, Achalpur', pincode: '444806',
      district_id: 501, taluka_id: 5003,
      contact_name: 'Dr. M. Tayde', contact_mobile: '+919000000106',
      contact_email: 'contact@apbc.demo',
      cdsco: 'MH/BC/12-901/2026', cdsco_expires: '2027-06-30',
      status: 'PE',
    });

    // ── 3. Platform users ──────────────────────────────────────────────
    console.log('▸ staff users + coordinators');
    async function staff(role, email, institutionId, districtId = null) {
      const r = await c.query(
        `INSERT INTO platform_users (role, email, password_hash, password_set_at, institution_id, district_id)
         VALUES ($1, $2, $3, NOW(), $4, $5) RETURNING id`,
        [role, email, pwHash, institutionId, districtId],
      );
      return r.rows[0].id;
    }
    const superId = await staff('super_admin', 'super@raktify.ngo', null);
    const adminId = await staff('ngo_admin', 'admin@raktify.ngo', null);
    const hospStaffId = await staff('hospital', 'hospital@raktify.ngo', hospital);
    const bbStaffId = await staff('blood_bank', 'bloodbank@raktify.ngo', bloodBank);
    // Second BB staff at the same bank for 4-eyes verification
    const bbStaffId2 = await staff('blood_bank', 'staff.adbc2@choudhari.ngo', bloodBank);
    await staff('dho', 'dho.amravati@choudhari.ngo', null, 501);

    // Coordinators
    const coord1User = (
      await c.query(`INSERT INTO platform_users (role, mobile) VALUES ('coordinator', '+919000000007') RETURNING id`)
    ).rows[0].id;
    const coord1Id = (
      await c.query(
        `INSERT INTO coordinators (
           platform_user_id, full_name, display_name, gender, preferred_language,
           state_id, district_id, taluka_id, id_proof_type, id_proof_last4, id_verified_at,
           on_duty, is_district_lead, reliability_score, is_active,
           donations_facilitated, requests_fulfilled, community_donor_count,
           lives_saved_estimate, median_response_time_min, joined_at)
         VALUES ($1, 'Priya Wankhede', 'Priya W.', 'F', 'mr',
                 27, 501, 5001, 'AAD', '4242', NOW(),
                 TRUE, TRUE, 96, TRUE,
                 48, 32, 22, 96, 12, CURRENT_DATE - INTERVAL '8 months')
         RETURNING id`,
        [coord1User],
      )
    ).rows[0].id;

    const coord2User = (
      await c.query(`INSERT INTO platform_users (role, mobile) VALUES ('coordinator', '+919000000008') RETURNING id`)
    ).rows[0].id;
    const coord2Id = (
      await c.query(
        `INSERT INTO coordinators (
           platform_user_id, full_name, display_name, gender, preferred_language,
           state_id, district_id, taluka_id, id_proof_type, id_proof_last4, id_verified_at,
           on_duty, is_district_lead, reliability_score, is_active,
           donations_facilitated, requests_fulfilled, community_donor_count,
           lives_saved_estimate, median_response_time_min, joined_at)
         VALUES ($1, 'Anjali More', 'Anjali M.', 'F', 'mr',
                 27, 501, 5003, 'VOT', '1198', NOW(),
                 FALSE, FALSE, 82, TRUE,
                 21, 14, 9, 42, 18, CURRENT_DATE - INTERVAL '4 months')
         RETURNING id`,
        [coord2User],
      )
    ).rows[0].id;
    void coord2Id; // referenced via coordinators table elsewhere

    // ── 4. Donors ──────────────────────────────────────────────────────
    console.log(`▸ donors (${DONOR_ROSTER.length})`);
    const donorIds = [];
    for (let i = 0; i < DONOR_ROSTER.length; i++) {
      const [name, gender, dob, bg] = DONOR_ROSTER[i];
      // Mobiles 010..039 — leaves 001-009 for the 6 original named donors
      // (and the coordinators at 007/008)
      const mobile = i < 6
        ? `+91900000000${i + 1}`               // existing 001-006
        : `+9190000000${String(10 + (i - 6)).padStart(2, '0')}`; // 010-039
      const pu = (
        await c.query(
          `INSERT INTO platform_users (role, mobile) VALUES ('donor', $1) RETURNING id`,
          [mobile],
        )
      ).rows[0].id;
      const villageId = pick([50001, 50003, 50004]); // various villages in Amravati
      const community = pick(['mr', 'mr', 'mr', 'hi']);
      const d = await c.query(
        `INSERT INTO donors (
           mobile, mobile_verified, mobile_verified_at, full_name, date_of_birth, gender,
           preferred_language, village_id, pincode, max_travel_km,
           blood_group_verified, blood_group_verified_at, blood_group_verified_by,
           is_available, whatsapp_opted_in, sms_opted_in,
           consent_data_use, consent_given_at,
           platform_user_id, registration_source,
           total_donations)
         VALUES ($1, TRUE, NOW() - (random() * INTERVAL '180 days'), $2, $3, $4,
                 $7, $8, '444601', 25,
                 $5::smallint,
                 CASE WHEN $5::smallint IS NOT NULL THEN NOW() - (random() * INTERVAL '180 days') ELSE NULL END,
                 CASE WHEN $5::smallint IS NOT NULL THEN $9::uuid ELSE NULL END,
                 TRUE, TRUE, TRUE,
                 TRUE, NOW() - (random() * INTERVAL '180 days'),
                 $6, 'WEB', 0)
         RETURNING id`,
        [mobile, name, dob, gender, bg, pu, community, villageId, bloodBank],
      );
      donorIds.push({ id: d.rows[0].id, bg, name });
    }

    // ── 5. Donations + inventory + TTI (6-month history) ──────────────
    //
    // The donation→inventory trigger refuses to create bags whose expiry is
    // already in the past, and the lookback trigger fires on every reactive
    // verified screening (which would explode in volume for the seed). For
    // the rich-history seed we therefore bypass user triggers and write
    // donation_history, blood_inventory, donor_screening, and (a couple of)
    // lookback rows by hand, with realistic dates + statuses.
    console.log('▸ donations + inventory + screening (6-month history)');
    const histMode = await disableTriggers(c);

    let bcN = 1;
    const allDonations = [];
    let reactiveCount = 0;

    try {
      // Each donor with a verified blood group gets 2-5 donations across 6
      // months. We pick the component based on age so the bag's shelf life
      // still leaves it in a believable state (PRBC for recent, FFP/Cryo
      // for older — FFP/Cryo have 1-year shelf life and naturally explain
      // why we have old bags still in inventory).
      for (const d of donorIds) {
        if (d.bg == null) continue;
        const donationCount = 2 + rand(4); // 2-5
        let dayOffset = 5 + rand(15); // most recent is 5-20 days back
        for (let n = 0; n < donationCount; n++) {
          // Pick a component that "fits" the age. PRBC (42d) for recent,
          // FFP/Cryo (365d) for older slots.
          const compId = dayOffset < 35
            ? pick([2, 2, 2, 1])    // mostly PRBC, some WB
            : pick([3, 3, 6, 2]);   // mostly FFP/Cryo, occasionally PRBC (will become EX)
          const volume = COMPONENT_VOLUME[compId];
          const hb = (12.5 + Math.random() * 3).toFixed(1);
          const bbId = pick([bloodBank, bloodBank, bloodBank, bloodBank2]);
          const recordedBy = bbId === bloodBank ? bbStaffId : bbStaffId2;
          const verifyBy = recordedBy === bbStaffId ? bbStaffId2 : bbStaffId;
          const barcode = `DEMOISBT${String(bcN++).padStart(6, '0')}`;
          const shelf = SHELF_LIFE[compId];
          const expiryDaysFromNow = shelf - dayOffset; // negative = already expired

          // 1) donation_history
          const dh = await c.query(
            `INSERT INTO donation_history (
               donor_id, blood_bank_id, trust_level, source,
               collection_date, component_id, volume_ml,
               hb_gdl, hb_method, isbt_barcode, recorded_by_user_id)
             VALUES ($1, $2, 'V', 'BB',
                     CURRENT_DATE - $3::int, $4, $5,
                     $6, 'HC', $7, $8)
             RETURNING id`,
            [d.id, bbId, dayOffset, compId, volume, parseFloat(hb), barcode, recordedBy],
          );
          const donationId = dh.rows[0].id;

          // 2) donor_screening — mostly cleared, ~2% reactive, a handful
          //    pending verification.
          const isReactive = Math.random() < 0.02;
          const hiv      = isReactive && Math.random() < 0.5 ? 'RR' : 'NR';
          const hbsag    = isReactive && Math.random() < 0.3 ? 'RR' : 'NR';
          const hcv      = isReactive && Math.random() < 0.2 ? 'RR' : 'NR';
          const anyReactive = [hiv, hbsag, hcv].includes('RR');
          if (anyReactive) reactiveCount++;
          const isPending = dayOffset < 5 && Math.random() < 0.3;
          const overall = isPending ? 'PE' : anyReactive ? 'IN' : 'CL';
          await c.query(
            `INSERT INTO donor_screening (
               donation_id, donor_id, blood_bank_id,
               hiv_status, hbsag_status, hcv_status, syphilis_status, malaria_status,
               overall_clearance,
               entered_by, entered_at, verified_by, verified_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'NR', 'NR',
                     $11,
                     $7, NOW() - $8::int * INTERVAL '1 day',
                     $9, $10)`,
            [
              donationId, d.id, bbId,
              hiv, hbsag, hcv,
              recordedBy, dayOffset,
              isPending ? null : verifyBy,
              isPending ? null : new Date(Date.now() - (dayOffset - 1) * 86400 * 1000),
              overall,
            ],
          );

          // 3) blood_inventory. Status is the realistic end-state:
          //    • Reactive → RC (recalled), regardless of expiry
          //    • Past expiry → EX
          //    • Within 25-day "old enough to have been issued" window → TR
          //    • Recent + pending screening → QA
          //    • Otherwise → AV
          let invStatus;
          let issuedAt = null;
          let issuedTo = null;
          let isRecalled = false;
          let recallReason = null;
          let recallBy = null;
          if (anyReactive) {
            invStatus = 'RC';
            isRecalled = true;
            recallReason = 'TTI reactive — lookback';
            recallBy = verifyBy;
          } else if (expiryDaysFromNow <= 0) {
            invStatus = 'EX';
          } else if (isPending) {
            invStatus = 'QA';
          } else if (dayOffset > 25 && Math.random() < 0.75) {
            invStatus = 'TR';
            issuedAt = new Date(Date.now() - Math.floor(Math.random() * 15 + 1) * 86400 * 1000);
            issuedTo = pick([hospital, hospital, hospital2]);
          } else {
            invStatus = 'AV';
          }
          await c.query(
            `INSERT INTO blood_inventory (
               isbt_barcode, donation_id, donor_id, blood_bank_id,
               blood_group_id, component_id, volume_ml,
               collection_date, expiry_date,
               status, status_changed_at, status_changed_by, source,
               issued_at, issued_to_institution_id,
               is_recalled, recall_reason, recall_initiated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7,
                     CURRENT_DATE - $8::int,
                     CURRENT_DATE - $8::int + $9::int * INTERVAL '1 day',
                     $10, NOW() - $11::int * INTERVAL '1 day', $12, 'MA',
                     $13, $14,
                     $15, $16, $17)`,
            [
              barcode, donationId, d.id, bbId,
              d.bg, compId, volume,
              dayOffset, shelf,
              invStatus, Math.max(0, dayOffset - 2), bbStaffId,
              issuedAt, issuedTo,
              isRecalled, recallReason, recallBy,
            ],
          );

          allDonations.push({
            id: donationId, donor_id: d.id, bb_id: bbId,
            component_id: compId, barcode, days_ago: dayOffset, bg: d.bg,
            reactive: anyReactive,
          });

          // Next donation: move ~70-110 days forward in time (so we walk
          // back from "5 days ago" into the past)
          dayOffset += 70 + rand(40);
          if (dayOffset > 175) break;
        }
      }
    } finally {
      await restoreTriggers(c, histMode);
    }

    console.log(`    ${allDonations.length} donations inserted (${reactiveCount} reactive)`);

    // Update donor.total_donations from the actual count
    await c.query(
      `UPDATE donors d SET total_donations = sub.cnt
         FROM (SELECT donor_id, COUNT(*)::int AS cnt
                 FROM donation_history
                WHERE isbt_barcode LIKE 'DEMOISBT%'
             GROUP BY donor_id) sub
        WHERE d.id = sub.donor_id`,
    );

    // ── 6. Lookback investigations from reactive screenings ────────────
    // Triggers were disabled while inserting, so create one lookback row
    // per reactive donation manually (mirrors fn_lookback_fire_on_clearance).
    console.log('▸ lookback rows (one per reactive donation)');
    for (const don of allDonations.filter((d) => d.reactive)) {
      await c.query(
        `INSERT INTO lookback_registry (
           donor_id, donation_id, triggering_screening_id, tti_trigger,
           inventory_bag_ids, bags_recalled_count, bags_already_issued, bags_already_transfused,
           lookback_status)
         SELECT $1, $2, ds.id, ARRAY['HIV']::text[],
                COALESCE(array_agg(bi.id) FILTER (WHERE bi.id IS NOT NULL), ARRAY[]::uuid[]),
                COUNT(*) FILTER (WHERE bi.status = 'RC'),
                COUNT(*) FILTER (WHERE bi.status = 'IS'),
                COUNT(*) FILTER (WHERE bi.status = 'TR'),
                'OP'
           FROM donor_screening ds
           LEFT JOIN blood_inventory bi ON bi.donation_id = ds.donation_id
          WHERE ds.donation_id = $2
       GROUP BY ds.id`,
        [don.donor_id, don.id],
      );
      // Defer the donor as per spec §6
      await c.query(
        `UPDATE donors SET deferral_status='P', deferral_reason='TTI reactive — under lookback'
          WHERE id = $1`,
        [don.donor_id],
      );
    }

    // ── 8. Blood requests across 90 days ───────────────────────────────
    console.log('▸ blood requests (90-day history, mixed statuses + urgency)');
    const reqRecipes = [];
    // 12 closed/fulfilled within target
    for (let i = 0; i < 12; i++) {
      const daysAgo = 5 + rand(85);
      const minutesToFulfil = 30 + rand(180);
      reqRecipes.push({
        initials: ['R.M.', 'S.K.', 'A.P.', 'V.D.', 'P.J.', 'M.B.'][rand(6)] + '.',
        age: 18 + rand(60), gender: pick(['M', 'F']),
        bg: pick([1, 3, 7, 7, 7, 1, 5]), comp: pick([2, 2, 1, 3]),
        units: 1 + rand(3),
        urgency: pick(['CR', 'CR', 'UR', 'UR', 'PL']),
        daysAgo, minutesToFulfil,
        status: 'CL',
        indication: pick([
          'Postpartum haemorrhage', 'Trauma — RTA', 'Surgical reserve',
          'Thalassemia transfusion', 'Anaemia of pregnancy', 'Dengue / thrombocytopenia',
        ]),
      });
    }
    // 4 critical fulfilled within 4h (good metrics)
    for (let i = 0; i < 4; i++) {
      reqRecipes.push({
        initials: 'C.R.', age: 25 + rand(40), gender: pick(['M', 'F']),
        bg: 4, comp: 2, units: 2,
        urgency: 'CR', daysAgo: rand(28), minutesToFulfil: 45 + rand(170),
        status: 'CL', indication: 'Postpartum haemorrhage',
      });
    }
    // 2 expired
    for (let i = 0; i < 2; i++) {
      reqRecipes.push({
        initials: 'E.X.', age: 70, gender: 'F',
        bg: 6, comp: 5, units: 1,
        urgency: 'CR', daysAgo: 30 + rand(30), minutesToFulfil: null,
        status: 'EX', indication: 'Rare component request — no match found',
      });
    }
    // 1 cancelled
    reqRecipes.push({
      initials: 'X.X.', age: 45, gender: 'M',
      bg: 3, comp: 2, units: 2,
      urgency: 'PL', daysAgo: 14, minutesToFulfil: null,
      status: 'CA', indication: 'Patient discharged without transfusion',
    });
    // 3 critical "active right now" — raised in last 24h
    for (let i = 0; i < 3; i++) {
      reqRecipes.push({
        initials: pick(['N.O.', 'L.K.', 'B.D.']) + '.',
        age: 20 + rand(50), gender: pick(['M', 'F']),
        bg: pick([4, 8, 6]),  // rare groups, makes it convincingly critical
        comp: 2, units: 2,
        urgency: 'CR', daysAgo: 0, minutesToFulfil: null,
        status: pick(['OP', 'MT', 'AS']),
        indication: pick(['Acute haemorrhage — surgical', 'Polytrauma — ICU', 'PPH — labour ward']),
      });
    }
    // 2 partly-fulfilled awaiting more units
    for (let i = 0; i < 2; i++) {
      reqRecipes.push({
        initials: 'P.F.', age: 35, gender: 'M',
        bg: 7, comp: 2, units: 4, partial: 2,
        urgency: 'UR', daysAgo: 1, minutesToFulfil: null,
        status: 'PF', indication: 'Major surgery — second-stage transfusion',
      });
    }

    for (const r of reqRecipes) {
      const hospId = pick([hospital, hospital, hospital2]);
      const raisedAt = `(NOW() - INTERVAL '${r.daysAgo} days')`;
      const needBy = `(NOW() - INTERVAL '${r.daysAgo} days' + INTERVAL '12 hours')`;
      const fulfilledAt = r.minutesToFulfil
        ? `(NOW() - INTERVAL '${r.daysAgo} days' + INTERVAL '${r.minutesToFulfil} minutes')`
        : 'NULL';
      const closedAt = r.status === 'CL'
        ? fulfilledAt
        : r.status === 'EX' || r.status === 'CA'
          ? `(NOW() - INTERVAL '${r.daysAgo} days' + INTERVAL '24 hours')`
          : 'NULL';
      const unitsFulfilled = r.status === 'CL' ? r.units : (r.partial || 0);
      // eslint-disable-next-line no-restricted-syntax
      await c.query(
        `INSERT INTO blood_requests (
           source_tier, requesting_institution_id, requesting_user_id,
           patient_initials, patient_age, patient_gender, patient_blood_group_id,
           component_id, units_required, units_fulfilled, urgency_tier,
           needed_by, clinical_indication, requesting_hospital_district_id,
           status, raised_at, fulfilled_at, closed_at,
           crossmatch_confirmed, crossmatch_confirmed_at,
           matched_blood_bank_id)
         VALUES ('OH', $1, $2,
                 $3, $4, $5, $6,
                 $7, $8, $9, $10,
                 ${needBy}, $11, 501,
                 $12, ${raisedAt}, ${fulfilledAt}, ${closedAt},
                 ${r.status === 'CL' ? 'TRUE' : 'FALSE'}, ${r.status === 'CL' ? fulfilledAt : 'NULL'},
                 ${r.status === 'CL' || r.status === 'PF' ? `'${bloodBank}'` : 'NULL'})`,
        [
          hospId, hospStaffId,
          r.initials, r.age, r.gender, r.bg,
          r.comp, r.units, unitsFulfilled, r.urgency,
          `Demo: ${r.indication}`,
          r.status,
        ],
      );
    }
    console.log(`    ${reqRecipes.length} requests inserted`);

    // ── 9. Camps ───────────────────────────────────────────────────────
    console.log('▸ camps (planned, completed, pending review)');
    async function makeCamp({ slug, name, daysFromToday, status, organiser, organiser_type, target, units_collected, attended }) {
      const r = await c.query(
        `INSERT INTO donation_camps (
           name, slug, qr_code_token,
           state_id, district_id, taluka_id, venue, address_line, pincode,
           scheduled_date, start_time, end_time, timezone,
           organiser_type, organiser_name, organiser_contact_name, organiser_contact_mobile,
           partnered_blood_bank_id, organising_coordinator_id,
           target_donor_count, registered_donor_count, attended_donor_count, units_collected,
           status, created_by_user_id)
         VALUES ($1, $2, $3,
                 27, 501, 5001, $4, $5, '444601',
                 CURRENT_DATE + $6::int, '09:00', '15:00', 'Asia/Kolkata',
                 $7, $8, $9, $10,
                 $11, $12,
                 $13, 0, $14, $15,
                 $16, $17)
         RETURNING id`,
        [
          name, slug, `qr-${slug}-${rand(99999)}`,
          'Main Hall, ' + organiser, 'Demo address, Amravati',
          daysFromToday,
          organiser_type, organiser, 'Demo Contact', '+919000000901',
          bloodBank, coord1Id,
          target, attended || 0, units_collected || 0,
          status, adminId,
        ],
      );
      return r.rows[0].id;
    }
    const camp1 = await makeCamp({  // completed 3 months ago
      slug: 'demo-camp-republic-day',
      name: 'Republic Day Blood Donation Drive',
      daysFromToday: -90, status: 'CO',
      organiser: 'Rotary Club of Amravati', organiser_type: 'EO',
      target: 80, attended: 64, units_collected: 64,
    });
    const camp2 = await makeCamp({  // completed last month
      slug: 'demo-camp-vmv-college',
      name: 'VMV College Annual Camp',
      daysFromToday: -30, status: 'CO',
      organiser: 'Vidyabharti Mahavidyalaya', organiser_type: 'EI',
      target: 100, attended: 78, units_collected: 78,
    });
    const camp3 = await makeCamp({  // planned (upcoming)
      slug: 'demo-camp-tcs-amravati',
      name: 'TCS Amravati Wellness Week',
      daysFromToday: 12, status: 'PL',
      organiser: 'Tata Consultancy Services', organiser_type: 'CC',
      target: 50,
    });
    const camp4 = await makeCamp({  // planned in 30 days
      slug: 'demo-camp-sgb-university',
      name: 'SGBAU Foundation Day Drive',
      daysFromToday: 30, status: 'PL',
      organiser: 'Sant Gadge Baba Amravati University', organiser_type: 'EI',
      target: 120,
    });
    // Pending-review camp (with public submitter fields — typical of /camps/apply)
    const camp5 = (
      await c.query(
        `INSERT INTO donation_camps (
           name, slug, qr_code_token,
           state_id, district_id, venue, address_line,
           scheduled_date, start_time, end_time,
           organiser_type, organiser_name,
           submitted_by_name, submitted_by_mobile, submitted_by_email,
           submitted_by_role, volunteer_training_requested, expected_volunteer_count,
           target_donor_count, status, created_by_user_id)
         VALUES ('Lions Club Achalpur Annual Donation Camp', 'demo-camp-lions-achalpur', $1,
                 27, 501, 'Lions Hall, Achalpur', 'Main Road, Achalpur',
                 CURRENT_DATE + 21, '09:00', '17:00',
                 'EO', 'Lions Club of Achalpur',
                 'Dr. Kishore Tayde', '+919000000902', 'lions.achalpur@demo.org',
                 'President', TRUE, 6,
                 75, 'PE', NULL)
         RETURNING id`,
        [`qr-lions-${rand(99999)}`],
      )
    ).rows[0].id;
    void camp5;

    // RSVPs for completed camps + upcoming planned ones
    for (const camp of [camp1, camp2, camp3]) {
      // pick ~12 random donors per camp
      const shuffled = [...donorIds].sort(() => Math.random() - 0.5).slice(0, 12);
      for (const d of shuffled) {
        await c.query(
          `INSERT INTO camp_registrations (camp_id, donor_id, status, source, referral_channel, registered_at)
           VALUES ($1, $2, $3, $4, $5, NOW() - (random() * INTERVAL '30 days'))
           ON CONFLICT (camp_id, donor_id) DO NOTHING`,
          [
            camp, d.id,
            camp === camp3 ? 'RG' : pick(['AT', 'AT', 'AT', 'NS']),
            pick(['WB', 'WB', 'QR', 'WB']),
            pick(['whatsapp', 'qr', 'facebook', 'direct', 'whatsapp']),
          ],
        );
      }
    }

    // ── 10. Thalassemia patients ──────────────────────────────────────
    console.log('▸ thalassemia patients');
    const thalRows = [
      ['Aarav Wankhede',   '2014-03-08', 'M', 3, 21, 10],   // due in 11 days
      ['Diya Salunkhe',    '2016-07-12', 'F', 7, 21, 18],   // due in 3 days
      ['Vihaan Khade',     '2012-11-22', 'M', 1, 14, 20],   // overdue
      ['Saanvi Patil',     '2018-05-30', 'F', 7, 21, 5],    // not yet due
      ['Aryan Bhat',       '2013-01-15', 'M', 8, 28, 22],   // overdue (rare O-)
      ['Ananya Joshi',     '2017-09-04', 'F', 3, 14, 13],   // due tomorrow
    ];
    for (const [name, dob, gender, bg, interval, lastDays] of thalRows) {
      await c.query(
        `INSERT INTO thalassemia_patients (
           full_name, date_of_birth, gender,
           guardian_name, guardian_mobile,
           blood_group_id, diagnosis_subtype, treating_hospital_id,
           transfusion_interval_days, last_transfusion_date, default_units, default_component_id,
           state_id, district_id, registered_by_coordinator, is_active)
         VALUES ($1, $2, $3,
                 'Demo Guardian', '+919000000777',
                 $4, 'Beta major', $5,
                 $6, CURRENT_DATE - $7::int, 1, 2,
                 27, 501, $8, TRUE)`,
        [`[Demo] ${name}`, dob, gender, bg, hospital, interval, lastDays, coord1Id],
      );
    }

    // ── 11. Rare blood registry ───────────────────────────────────────
    console.log('▸ rare blood registry');
    // One donor-linked (Bombay; pick a real donor)
    await c.query(
      `INSERT INTO rare_blood_registry (
         donor_id, phenotype_code, phenotype_description,
         abo_type, rh_factor, is_bombay,
         verified_by_institution_id, verified_method, verified_at,
         broadcast_consent, broadcast_consent_at, is_active)
       VALUES ($1, 'BOMBAY', '[Demo] Bombay phenotype (Oh)',
               'O', '+', TRUE,
               $2, 'IAT', NOW() - INTERVAL '120 days',
               TRUE, NOW() - INTERVAL '120 days', TRUE)`,
      [donorIds[10].id, bloodBank], // Rajesh Bhat (O-)
    );
    // Rh-null shadow entry
    await c.query(
      `INSERT INTO rare_blood_registry (
         phenotype_code, phenotype_description, abo_type, rh_factor, is_bombay,
         verified_by_institution_id, verified_method, verified_at,
         contact_name, contact_mobile, contact_state_id, contact_district_id,
         broadcast_consent, is_active)
       VALUES ('RH_NULL', '[Demo] Rh-null phenotype',
               'A', '+', FALSE,
               $1, 'Genotyping', NOW() - INTERVAL '60 days',
               'Shadow Contact', '+919000000888', 27, 501,
               TRUE, TRUE)`,
      [bloodBank],
    );
    // Weak-D donor-linked
    await c.query(
      `INSERT INTO rare_blood_registry (
         donor_id, phenotype_code, phenotype_description,
         abo_type, rh_factor, is_bombay,
         verified_by_institution_id, verified_method, verified_at,
         broadcast_consent, is_active)
       VALUES ($1, 'WEAK_D', '[Demo] Weak D variant',
               'B', '+', FALSE,
               $2, 'IAT', NOW() - INTERVAL '30 days',
               FALSE, TRUE)`,
      [donorIds[18].id, bloodBank2], // Anil Mahajan
    );

    // ── 12. Lookback investigations ───────────────────────────────────
    console.log('▸ lookback investigations (close one of the auto-created rows)');
    // Reactive verified screenings auto-create lookback_registry rows via the
    // fn_lookback_fire_on_clearance trigger (migration 035). Walk the most
    // recent two and close the older one so the dashboard shows a mix of
    // open + closed investigations.
    const lookbackRows = await c.query(
      `SELECT l.id, l.tti_trigger
         FROM lookback_registry l
         JOIN donors d ON d.id = l.donor_id
        WHERE d.mobile LIKE '+9190000%'
        ORDER BY l.created_at DESC`,
    );
    if (lookbackRows.rowCount > 1) {
      // Close the oldest one. HIV/HBsAg lookbacks require dho_notified=TRUE
      // before they can be closed (trigger enforces this).
      const toClose = lookbackRows.rows[lookbackRows.rowCount - 1];
      await c.query(
        `UPDATE lookback_registry
            SET dho_notified = TRUE,
                dho_notified_at = NOW() - INTERVAL '60 days',
                dho_notification_ref = '[Demo] DHO Amravati ref/2026/047',
                hospital_contacted_at = NOW() - INTERVAL '55 days',
                hospital_contacted_by = $2,
                hospital_response = '[Demo] Recipient untraceable; case file with district office.',
                outcome_notes = '[Demo] All implicated bags recalled; recipient could not be located within 30 days.',
                lookback_status = 'EX',
                closed_by = $2
          WHERE id = $1`,
        [toClose.id, adminId],
      );
    }
    const lookbackOpen = Math.max(0, lookbackRows.rowCount - 1);
    const lookbackClosed = lookbackRows.rowCount > 1 ? 1 : 0;

    // ── Done ───────────────────────────────────────────────────────────
    console.log('\n✅ Rich demo data seeded.\n');
    console.log('Logins (staff/admin — email + password):');
    console.log(`  super_admin   super@raktify.ngo                ${DEMO_PASSWORD}`);
    console.log(`  ngo_admin     admin@raktify.ngo                ${DEMO_PASSWORD}`);
    console.log(`  hospital      hospital@raktify.ngo             ${DEMO_PASSWORD}`);
    console.log(`  blood_bank    bloodbank@raktify.ngo            ${DEMO_PASSWORD}`);
    console.log(`  blood_bank    staff.adbc2@choudhari.ngo        ${DEMO_PASSWORD}   (for 4-eyes)`);
    console.log(`  dho           dho.amravati@choudhari.ngo       ${DEMO_PASSWORD}`);
    console.log('\nCoordinators (mobile OTP):');
    console.log('  Lead          +91 90000 00007 (Priya Wankhede)');
    console.log('  Deputy        +91 90000 00008 (Anjali More)');
    console.log('\nDemo donors (mobile OTP):');
    console.log('  +91 90000 00001 … 00006   (Ramesh / Sunita / Imran / Anjali / Vikas / Deepa)');
    console.log('  +91 9000 00 0010 … 0039   (25 more with full names per the donor roster)');
    console.log('\nSeeded volumes:');
    console.log(`  ${DONOR_ROSTER.length} donors · ${allDonations.length} donations · ${reactiveCount} reactive TTI`);
    console.log(`  ${reqRecipes.length} blood requests across 90 days`);
    console.log('  5 camps (2 completed · 2 planned · 1 pending review)');
    console.log('  6 thalassemia patients · 3 rare-blood entries');
    console.log(`  ${lookbackRows.rowCount} lookback investigations (${lookbackOpen} open · ${lookbackClosed} closed) · 2 pending institutional applications`);
    console.log('\nLogin URLs:');
    console.log('  Donor / Coordinator: https://raktify.choudhari.ngo/login');
    console.log('  Staff (incl. DHO):   https://raktify.choudhari.ngo/staff/login');
  } finally {
    c.release();
    await pool.end();
  }
}

// Export the reset helper so `scripts/wipe_demo.js` can reuse the same
// markers + cleanup logic — the wipe is safety-critical and we don't want
// two copies of "what counts as a demo row" drifting apart.
module.exports = { resetDemo };

// Only run main() when invoked directly (node scripts/seed_demo.js).
// When required as a module (by wipe_demo.js) we skip the auto-run.
if (require.main === module) {
  main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
