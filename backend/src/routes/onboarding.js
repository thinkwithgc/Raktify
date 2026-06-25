/**
 * Institution onboarding flow.
 *
 *   POST /onboarding/apply              — public; creates institution row in PE
 *   GET  /onboarding/applications       — ngo_admin; pending queue
 *   POST /onboarding/verify/:id         — ngo_admin; record license verification → VE
 *   POST /onboarding/generate-mou/:id   — ngo_admin; trigger eSign request
 *   POST /onboarding/mou-signed         — eSign webhook; provision credentials → AC
 */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const env = require('../config/env');
const logger = require('../config/logger');
const { pool } = require('../config/db');
const { withRlsContext, withRlsContextRaw } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { normaliseIndianMobile } = require('../utils/phone');
const eSign = require('../services/esign');
const storage = require('../services/storage');
const { sendNotification } = require('../services/notifications');
const setupSvc = require('../services/users/setup');

const router = express.Router();

const applySchema = z.object({
  kind: z.enum(['HO', 'BB']),
  shortname: z.string().regex(/^[a-z][a-z0-9_-]{2,31}$/),
  legal_name: z.string().min(2),
  display_name: z.string().min(2),
  state_id: z.number().int().positive(),
  district_id: z.number().int().positive(),
  taluka_id: z.number().int().positive().optional(),
  village_id: z.number().int().positive().optional(),
  address_line: z.string().min(5),
  pincode: z.string().regex(/^[1-9]\d{5}$/),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  cdsco_licence_number: z.string().optional(),
  cdsco_licence_expires: z.string().optional(), // YYYY-MM-DD
  hospital_registration_no: z.string().optional(),
  primary_contact_name: z.string().min(2),
  primary_contact_designation: z.string().optional(),
  primary_contact_mobile: z.string(),
  primary_contact_email: z.string().email().optional(),
  has_inhouse_blood_bank: z.boolean().optional(),
  is_blood_bank_software_user: z.boolean().optional(),
  software_vendor: z.string().optional(),
});

// ── POST /onboarding/apply (public) ──────────────────────────────────────
router.post('/apply', async (req, res) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  const data = parsed.data;
  if (data.kind === 'BB' && !data.cdsco_licence_number) {
    return res.status(400).json({ error: 'cdsco_licence_required_for_blood_bank' });
  }

  const mobile = normaliseIndianMobile(data.primary_contact_mobile);
  if (!mobile) return res.status(400).json({ error: 'invalid_mobile_format' });

  try {
    const id = await withRlsContextRaw(
      { actor_role: 'onboarding', change_reason: 'public onboarding apply' },
      async (c) => {
        const r = await c.query(
          `INSERT INTO institutions (
             kind, shortname, legal_name, display_name,
             state_id, district_id, taluka_id, village_id,
             address_line, pincode, latitude, longitude,
             cdsco_licence_number, cdsco_licence_expires, hospital_registration_no,
             primary_contact_name, primary_contact_designation,
             primary_contact_mobile, primary_contact_email,
             has_inhouse_blood_bank, is_blood_bank_software_user, software_vendor,
             onboarding_status)
           VALUES (
             $1,$2,$3,$4, $5,$6,$7,$8, $9,$10,$11,$12,
             $13,$14,$15, $16,$17, $18,$19, $20,$21,$22, 'PE')
           RETURNING id, shortname`,
          [
            data.kind,
            data.shortname,
            data.legal_name,
            data.display_name,
            data.state_id,
            data.district_id,
            data.taluka_id || null,
            data.village_id || null,
            data.address_line,
            data.pincode,
            data.latitude || null,
            data.longitude || null,
            data.cdsco_licence_number || null,
            data.cdsco_licence_expires || null,
            data.hospital_registration_no || null,
            data.primary_contact_name,
            data.primary_contact_designation || null,
            mobile,
            data.primary_contact_email || null,
            data.has_inhouse_blood_bank ?? false,
            data.is_blood_bank_software_user ?? false,
            data.software_vendor || null,
          ],
        );
        return r.rows[0];
      },
    );

    // Notify ngo_admin (for now — once admin user accounts exist, look up by role).
    logger.info(
      { institution_id: id.id, shortname: id.shortname },
      'Onboarding application received',
    );

    res.status(201).json({
      institution_id: id.id,
      shortname: id.shortname,
      onboarding_status: 'PE',
      next_step: 'License verification by NGO admin.',
    });
  } catch (err) {
    if (/unique constraint/i.test(err.message) && /shortname/i.test(err.message)) {
      return res.status(409).json({ error: 'shortname_taken' });
    }
    throw err;
  }
});

// ── GET /onboarding/applications (ngo_admin) ─────────────────────────────
router.get(
  '/applications',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const status = req.query.status || 'PE';
    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT id, kind, shortname, legal_name, district_id,
                primary_contact_name, primary_contact_mobile,
                onboarding_status, onboarding_started_at, license_verified_at
           FROM institutions
          WHERE onboarding_status = $1
          ORDER BY onboarding_started_at DESC
          LIMIT 200`,
        [status],
      ),
    );
    res.json({ applications: r.rows, count: r.rowCount });
  },
);

// ── POST /onboarding/verify/:id (ngo_admin) ──────────────────────────────
router.post('/verify/:id', verifyJWT, requireRole('ngo_admin', 'super_admin'), async (req, res) => {
  const r = await withRlsContext(
    req,
    (c) =>
      c.query(
        `UPDATE institutions
              SET license_verified_at = clock_timestamp(),
                  license_verified_by = $1,
                  onboarding_status = 'VE'
            WHERE id = $2 AND onboarding_status = 'PE'
        RETURNING id, onboarding_status`,
        [req.user.userId, req.params.id],
      ),
    { change_reason: 'admin license verify' },
  );
  if (r.rowCount === 0) {
    return res.status(404).json({ error: 'not_found_or_wrong_state' });
  }
  res.json({ institution_id: r.rows[0].id, onboarding_status: r.rows[0].onboarding_status });
});

// ── POST /onboarding/generate-mou/:id (ngo_admin) ────────────────────────
router.post(
  '/generate-mou/:id',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const inst = await pool.query(
      `SELECT id, kind, shortname, legal_name, display_name, address_line, pincode,
              primary_contact_name, primary_contact_mobile, onboarding_status
         FROM institutions WHERE id = $1`,
      [req.params.id],
    );
    if (inst.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    if (!['VE', 'AC'].includes(inst.rows[0].onboarding_status)) {
      return res.status(409).json({ error: 'must_verify_license_first' });
    }

    const i = inst.rows[0];
    const templateData = {
      legal_name: i.legal_name,
      display_name: i.display_name,
      kind: i.kind === 'BB' ? 'Blood Bank' : 'Hospital',
      address: i.address_line,
      pincode: i.pincode,
      signatory_name: i.primary_contact_name,
      effective_from: new Date().toISOString().slice(0, 10),
      effective_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    };

    const eSignResult = await eSign.sendForSign({
      institutionId: i.id,
      signatoryMobile: i.primary_contact_mobile,
      signatoryName: i.primary_contact_name,
      templateData,
    });

    res.json({
      institution_id: i.id,
      doc_id: eSignResult.docId,
      sign_url: eSignResult.signUrl,
      expires_at: eSignResult.expiresAt,
      provider: eSign.providerName,
    });
  },
);

// ── POST /onboarding/mou-signed (eSign webhook) ──────────────────────────
router.post('/mou-signed', async (req, res) => {
  let webhook;
  try {
    webhook = eSign.verifyWebhook(req.headers, req.body);
  } catch (err) {
    logger.warn({ err: err.message }, 'eSign webhook verification failed');
    return res.status(401).json({ error: 'invalid_webhook' });
  }

  // Find the institution by doc_id stored on the latest mou_versions row,
  // OR (since we don't write a placeholder row at send-time yet) fall back
  // to reading it from /generate-mou's eSign external_ref. For the smoke
  // test, we use external_ref = institution_id.
  // The local provider stores the institutionId in its doc payload; pull
  // institution_id from the local outbox file when in dev.
  let institutionId = req.body.institution_id;
  if (!institutionId) {
    try {
      const fs = require('fs');
      const path = require('path');
      const fp = path.resolve(env.local.outboxDir, 'esign', `${webhook.docId}.json`);
      if (fs.existsSync(fp)) {
        institutionId = JSON.parse(fs.readFileSync(fp, 'utf8')).institutionId;
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to resolve institution from doc_id');
    }
  }
  if (!institutionId) return res.status(400).json({ error: 'institution_id_missing' });

  const inst = await pool.query(
    `SELECT id, shortname, display_name, primary_contact_name,
            primary_contact_mobile, kind, onboarding_status
       FROM institutions WHERE id = $1`,
    [institutionId],
  );
  if (inst.rowCount === 0) return res.status(404).json({ error: 'institution_not_found' });
  const i = inst.rows[0];

  // Compute next mou version_number for this institution.
  const versionR = await pool.query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM mou_versions WHERE institution_id = $1`,
    [institutionId],
  );
  const versionNumber = versionR.rows[0].next;

  // For now we don't have a real PDF — use a placeholder storage key so the row
  // satisfies NOT NULL. At go-live, the PDF generator runs in /generate-mou
  // and stores the key on a placeholder row that we update here.
  const placeholderKey = `mou/${i.shortname}/v${versionNumber}.pdf`;
  await storage.put(placeholderKey, Buffer.from('LOCAL_DEV_MOU_PLACEHOLDER'));
  const sha256 = crypto.createHash('sha256').update('LOCAL_DEV_MOU_PLACEHOLDER').digest('hex');

  // Provision: create the institutional admin platform_users row, mark
  // institution AC, archive the MoU version. All in one transaction so a
  // failure leaves no half-state.
  //
  // Password setup: we generate an UNUSABLE placeholder password_hash so the
  // platform_users auth_path_required CHECK constraint passes; the institution
  // then receives a magic-link via WhatsApp (institutional_setup_link template)
  // to set their real password. Single-use token, 7-day TTL. See
  // services/users/setup.js. This replaces the previous "temp password over
  // WhatsApp" pattern (rejected by Meta + insecure on principle).
  const placeholderHash = await setupSvc.unusablePasswordHash();
  const adminEmail = `${i.shortname}@${env.providers.mail === 'workspace' ? 'choudhari.ngo' : 'dev.choudhari.local'}`;
  const role = i.kind === 'BB' ? 'blood_bank' : 'hospital';

  const result = await withRlsContextRaw(
    { actor_role: 'onboarding', change_reason: 'eSign webhook → activate' },
    async (c) => {
      // 1. mou_versions
      await c.query(
        `INSERT INTO mou_versions (
            institution_id, version_number, effective_from, effective_until,
            leegally_doc_id, leegally_template_id,
            signed_at, signatory_name, signatory_aadhaar_last4,
            pdf_storage_key, pdf_sha256, template_snapshot)
         VALUES ($1,$2, CURRENT_DATE, (CURRENT_DATE + INTERVAL '1 year')::date,
            $3,$4, $5,$6,$7, $8,$9, $10::jsonb)`,
        [
          institutionId,
          versionNumber,
          webhook.docId,
          env.leegally.templateId || 'local-template',
          webhook.signedAt,
          webhook.signatoryName || 'Unknown',
          webhook.signatoryAadhaarLast4 || null,
          placeholderKey,
          sha256,
          JSON.stringify({ doc_id: webhook.docId, version: versionNumber }),
        ],
      );

      // 2. institutions: mark AC + mirror latest MoU pointer
      await c.query(
        `UPDATE institutions
            SET mou_signed_at = $1, mou_leegally_doc_id = $2,
                mou_signatory_name = $3,
                mou_expires_at = (CURRENT_DATE + INTERVAL '1 year')::date,
                onboarding_status = 'AC'
          WHERE id = $4`,
        [webhook.signedAt, webhook.docId, webhook.signatoryName || null, institutionId],
      );

      // 3. platform_users: provision the admin login (idempotent on email).
      //    Placeholder password_hash satisfies auth_path_required CHECK;
      //    user can't log in until they consume the setup token below.
      const existing = await c.query(`SELECT id FROM platform_users WHERE email = $1`, [
        adminEmail,
      ]);
      let userId;
      if (existing.rowCount === 0) {
        const created = await c.query(
          `INSERT INTO platform_users
             (role, email, password_hash, password_set_at,
              force_password_change, institution_id)
           VALUES ($1, $2, $3, NOW(), TRUE, $4)
           RETURNING id`,
          [role, adminEmail, placeholderHash, institutionId],
        );
        userId = created.rows[0].id;
      } else {
        userId = existing.rows[0].id;
        // Re-signing scenario: wipe password, issue a fresh setup token.
        await c.query(
          `UPDATE platform_users
              SET password_hash = $1, password_set_at = NOW(),
                  force_password_change = TRUE
            WHERE id = $2`,
          [placeholderHash, userId],
        );
      }

      // 4. Generate fresh setup token (single-use, 7-day TTL by default).
      //    Returns plaintext for the URL; only the SHA-256 hash is stored.
      const { token: setupToken, expiresAt } = await setupSvc.generateSetupToken(c, userId);
      return { userId, adminEmail, setupToken, expiresAt };
    },
  );

  // Send the magic-link via WhatsApp. The template renders the link as
  // https://raktify.choudhari.ngo/setup/<token> via its URL button param.
  // SETUP_LINK template handler in whatsappCloudProvider takes signatory_name,
  // institution_name, expires_in (body) + setup_token (button URL var).
  await sendNotification({
    recipientId: i.primary_contact_mobile,
    templateType: 'SETUP_LINK',
    variables: {
      signatory_name: webhook.signatoryName || i.primary_contact_name || 'Admin',
      institution_name: i.display_name || i.shortname,
      expires_in: `${setupSvc.DEFAULT_TTL_DAYS} days`,
      setup_token: result.setupToken,
    },
    channel: 'WA',
    language: 'en',
  });

  const devEcho =
    env.nodeEnv === 'development'
      ? {
          dev_admin_email: result.adminEmail,
          dev_setup_url: `${env.frontendUrl}/setup/${result.setupToken}`,
          dev_setup_expires_at: result.expiresAt,
        }
      : {};
  res.json({
    status: 'activated',
    institution_id: institutionId,
    version: versionNumber,
    ...devEcho,
  });
});

module.exports = router;
