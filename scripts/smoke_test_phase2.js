#!/usr/bin/env node
/**
 * Phase 2 smoke test — auth + institution onboarding.
 *
 * Boots the Express app in-process and exercises the complete flow:
 *   1.  Public POST /onboarding/apply creates an institution in PE
 *   2.  ngo_admin POST /onboarding/verify/:id moves it to VE
 *   3.  ngo_admin POST /onboarding/generate-mou/:id triggers eSign
 *   4.  Simulated eSign webhook POST /onboarding/mou-signed activates the
 *       institution, archives mou_versions, and provisions an admin login
 *   5.  Hospital staff logs in via /auth/institutional/login (no TOTP yet)
 *   6.  Hospital staff sets up TOTP via setup-totp + confirm-totp
 *   7.  Re-login now requires TOTP
 *   8.  Donor OTP flow: send → verify → JWT
 *   9.  Donor JWT cannot reach an ngo_admin-only endpoint
 *  10.  Bogus OTP → invalid; 5 in a row → account locked
 *
 * Note: this test uses unique-per-run identifiers so it is idempotent
 * across runs (audit_log permanence guarantee — see CLAUDE.md).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// otplib + bcryptjs may be hoisted to root or live in backend/node_modules.
// Use createRequire scoped to backend so it follows backend's resolution tree.
const { createRequire } = require('module');
const backendRequire = createRequire(path.resolve(__dirname, '../backend/package.json'));

const bcrypt = backendRequire('bcryptjs');
const totp = require('../backend/src/utils/totp');
const createApp = require('../backend/src/app');
const db = require('../backend/src/config/db');

const RUN_TAG = Date.now().toString().slice(-6);
const TEST = {
  shortname: `p2bb${RUN_TAG}`.slice(0, 31),
  // mobile must match +91[6-9]\d{9} (Indian operator range). Force a 9 prefix.
  contactMobile: `+919${RUN_TAG}001`,            // 13 chars
  donorMobile:   `+919${RUN_TAG}002`,
  ngoAdminEmail: `ngo-admin-${RUN_TAG}@example.com`,
  ngoAdminPwd: 'AdminPass!2026',
  state_id: 27,
  district_id: 491,
  institutionId: null,
  ngoAdminToken: null,
  bbAdminEmail: null,
  bbAdminTempPassword: null,
  bbAdminToken: null,
  bbTotpSecret: null,
};

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); pass++; }
  else { console.error(`  ✗ ${msg}`); fail++; }
}

const app = createApp();
const PORT = 3010 + ((parseInt(RUN_TAG, 10) || 0) % 1000);

let server;
function fetchJson(method, urlPath, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  return fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

async function ensureGeo() {
  const c = await db.pool.connect();
  try {
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
  } finally {
    c.release();
  }
}

async function seedNgoAdmin() {
  const c = await db.pool.connect();
  try {
    const r = await c.query(
      `INSERT INTO platform_users (role, email, password_hash, password_set_at)
       VALUES ('ngo_admin', $1, $2, NOW())
       RETURNING id`,
      [TEST.ngoAdminEmail, await bcrypt.hash(TEST.ngoAdminPwd, 10)],
    );
    return r.rows[0].id;
  } finally {
    c.release();
  }
}

async function main() {
  await ensureGeo();
  await seedNgoAdmin();

  await new Promise((resolve) => {
    server = app.listen(PORT, '127.0.0.1', () => resolve());
  });
  console.log(`── Phase 2 smoke (port ${PORT}, tag ${RUN_TAG}) ─────────────────`);

  try {
    console.log('── 1. POST /onboarding/apply (public) ──────────────────────');
    let r = await fetchJson('POST', '/onboarding/apply', {
      body: {
        kind: 'BB',
        shortname: TEST.shortname,
        legal_name: 'Phase 2 Smoke Blood Bank',
        display_name: 'P2 Smoke BB',
        state_id: TEST.state_id,
        district_id: TEST.district_id,
        address_line: '12 Phase 2 Smoke Lane, Amravati',
        pincode: '444601',
        cdsco_licence_number: `CDSCO-P2-${RUN_TAG}`,
        cdsco_licence_expires: new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
        primary_contact_name: 'P2 Smoke Contact',
        primary_contact_mobile: TEST.contactMobile,
      },
    });
    assert(r.status === 201, `apply returns 201 (got ${r.status})`);
    assert(r.body.onboarding_status === 'PE', 'institution created in PE state');
    TEST.institutionId = r.body.institution_id;

    console.log('── 2. ngo_admin login + verify license ─────────────────────');
    r = await fetchJson('POST', '/auth/institutional/login', {
      body: { email: TEST.ngoAdminEmail, password: TEST.ngoAdminPwd },
    });
    assert(r.status === 200 && r.body.token, `ngo_admin login returns token (got ${r.status})`);
    TEST.ngoAdminToken = r.body.token;

    r = await fetchJson('POST', `/onboarding/verify/${TEST.institutionId}`, {
      headers: { Authorization: `Bearer ${TEST.ngoAdminToken}` },
    });
    assert(r.status === 200 && r.body.onboarding_status === 'VE', `verify → VE (got ${r.status} ${r.body.onboarding_status})`);

    console.log('── 3. generate MoU ─────────────────────────────────────────');
    r = await fetchJson('POST', `/onboarding/generate-mou/${TEST.institutionId}`, {
      headers: { Authorization: `Bearer ${TEST.ngoAdminToken}` },
    });
    assert(r.status === 200 && r.body.doc_id, `generate-mou returns doc_id (got ${r.status})`);
    const docId = r.body.doc_id;
    assert(r.body.provider === 'local', `using local eSign provider in dev (got ${r.body.provider})`);

    console.log('── 4. eSign webhook → activate institution ─────────────────');
    r = await fetchJson('POST', '/onboarding/mou-signed', {
      body: {
        doc_id: docId,
        signed_at: new Date().toISOString(),
        signatory_name: 'P2 Smoke Contact',
        signatory_aadhaar_last4: '1234',
      },
    });
    assert(r.status === 200 && r.body.status === 'activated', `webhook activates (got ${r.status} ${r.body.status})`);
    TEST.bbAdminEmail = r.body.dev_admin_email;
    TEST.bbAdminTempPassword = r.body.dev_temp_password;
    assert(!!TEST.bbAdminEmail && !!TEST.bbAdminTempPassword, 'dev_admin_email and dev_temp_password returned');

    console.log('── 5. BB admin logs in with temp password (no TOTP yet) ─────');
    r = await fetchJson('POST', '/auth/institutional/login', {
      body: { email: TEST.bbAdminEmail, password: TEST.bbAdminTempPassword },
    });
    assert(r.status === 200 && r.body.token, `BB admin login returns token (got ${r.status})`);
    assert(r.body.totp_required === true, 'BB admin must set up TOTP');
    assert(r.body.force_password_change === true, 'force_password_change flag set');
    TEST.bbAdminToken = r.body.token;

    console.log('── 6. BB admin sets up TOTP ───────────────────────────────');
    r = await fetchJson('POST', '/auth/institutional/setup-totp', {
      headers: { Authorization: `Bearer ${TEST.bbAdminToken}` },
    });
    assert(r.status === 200 && r.body.otpauth_url, 'setup-totp returns otpauth URL');
    const m = r.body.otpauth_url.match(/secret=([^&]+)/);
    TEST.bbTotpSecret = m && m[1];
    assert(!!TEST.bbTotpSecret, 'extracted TOTP secret from otpauth URL');

    const code = await totp.currentCode(TEST.bbTotpSecret);
    r = await fetchJson('POST', '/auth/institutional/confirm-totp', {
      headers: { Authorization: `Bearer ${TEST.bbAdminToken}` },
      body: { totp_code: code },
    });
    assert(r.status === 200 && r.body.status === 'totp_enabled', 'TOTP enabled');

    console.log('── 7. Re-login now requires TOTP ───────────────────────────');
    r = await fetchJson('POST', '/auth/institutional/login', {
      body: { email: TEST.bbAdminEmail, password: TEST.bbAdminTempPassword },
    });
    assert(r.status === 401 && r.body.error === 'totp_required', 'login without TOTP rejected');

    const code2 = await totp.currentCode(TEST.bbTotpSecret);
    r = await fetchJson('POST', '/auth/institutional/login', {
      body: {
        email: TEST.bbAdminEmail,
        password: TEST.bbAdminTempPassword,
        totp_code: code2,
      },
    });
    assert(r.status === 200 && r.body.token, 'login with TOTP succeeds');

    console.log('── 8. Donor OTP send + verify ──────────────────────────────');
    r = await fetchJson('POST', '/auth/otp/send', {
      body: { mobile: TEST.donorMobile },
    });
    assert(r.status === 200 && r.body.dev_otp, `OTP send returns dev_otp (got ${r.status})`);
    const sentOtp = r.body.dev_otp;

    r = await fetchJson('POST', '/auth/otp/verify', {
      body: { mobile: TEST.donorMobile, otp: sentOtp },
    });
    assert(r.status === 200 && r.body.token && r.body.role === 'donor', `OTP verify returns donor JWT (got ${r.status})`);
    const donorToken = r.body.token;

    console.log('── 9. Donor cannot reach ngo_admin endpoint ────────────────');
    r = await fetchJson('GET', '/onboarding/applications', {
      headers: { Authorization: `Bearer ${donorToken}` },
    });
    assert(r.status === 403, `donor → /onboarding/applications returns 403 (got ${r.status})`);

    console.log('── 10. Wrong OTP attempts → eventual lock ──────────────────');
    // Get a fresh OTP issued so the user has otp_hash set, then try wrong codes.
    r = await fetchJson('POST', '/auth/otp/send', { body: { mobile: TEST.donorMobile } });
    assert(r.status === 200, 'fresh OTP sent for lock test');
    let lockedAtAttempt = null;
    for (let i = 1; i <= 5; i++) {
      const wrong = await fetchJson('POST', '/auth/otp/verify', {
        body: { mobile: TEST.donorMobile, otp: '000000' },
      });
      if (wrong.body.error === 'account_locked_too_many_attempts') {
        lockedAtAttempt = i;
        break;
      }
    }
    assert(lockedAtAttempt === 5, `account locks at attempt 5 (got ${lockedAtAttempt})`);

  } catch (err) {
    console.error('FATAL during smoke:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    await new Promise((r) => server.close(r));
    await db.shutdown();
  }

  console.log('');
  console.log('─'.repeat(58));
  console.log(`Phase 2 smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
