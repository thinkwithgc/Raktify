/**
 * Donor routes (Phase 3).
 *
 *   POST /donors/register                    public; pairs to platform_users via mobile/JWT
 *   GET  /donors/me                          authenticated donor; own profile
 *   GET  /donors/:id/passport                authenticated; donor self / coordinator / admin
 *   POST /donors/:id/blood-group/verify      bb_writer (blood_bank role); writes blood_group_verified
 *   POST /donors/:id/availability            authenticated donor; toggles is_available
 *   POST /donors/:id/consent                 authenticated donor; grants/revokes consent (gated by trg_donors_consent_protect)
 *   POST /donors/merge                       ngo_admin; STUB — see services/donors/merge.js
 *
 * Eligibility screening: spec §5 4-step web form is partially implemented:
 *   - Step 2 (personal details) → POST /donors/register
 *   - Step 4 (consent) → POST /donors/:id/consent
 *   - Step 1 (pre-screening permanent) and Step 3 (temporary deferrals)
 *     are pending medical advisor sign-off — see services/donors/eligibility.js
 *     The questions can be served via GET /donors/eligibility/questions which
 *     returns the DRAFT bank for the frontend to render.
 */
const express = require('express');
const { z } = require('zod');

const { withRlsContext, withRlsContextRaw } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { normaliseIndianMobile } = require('../utils/phone');
const { checkDuplicates } = require('../services/donors/duplicates');
const { buildPassport } = require('../services/donors/passport');
const eligibility = require('../services/donors/eligibility');

const router = express.Router();

// ── GET /donors/eligibility/questions (public) ───────────────────────────
router.get('/eligibility/questions', (_req, res) => {
  res.json({
    permanent: eligibility.PERMANENT_QUESTIONS,
    temporary: eligibility.TEMPORARY_QUESTIONS,
    draft: eligibility.DRAFT_PENDING_REVIEW,
    note: eligibility.DRAFT_PENDING_REVIEW
      ? 'Question bank is provisional — pending medical advisor sign-off.'
      : null,
  });
});

const registerSchema = z.object({
  mobile: z.string(),
  full_name: z.string().min(2).max(120),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(['M', 'F', 'O']),
  abha_id: z
    .string()
    .regex(/^\d{17}$/)
    .optional(),
  aadhaar_last4: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  preferred_language: z.enum(['mr', 'hi', 'en']).default('mr'),
  village_id: z.number().int().positive().optional(),
  pincode: z
    .string()
    .regex(/^[1-9]\d{5}$/)
    .optional(),
  address_line: z.string().optional(),
  max_travel_km: z.number().int().min(1).max(999).default(10),
  blood_group_self_reported: z.number().int().min(1).max(8).optional(),
  preferred_contact_channel: z.enum(['WA', 'SM', 'CA']).default('WA'),
  whatsapp_opted_in: z.boolean().default(false),
  sms_opted_in: z.boolean().default(true),
  community_id: z.string().uuid().optional(),
  registration_source: z.enum(['QRC', 'WAB', 'WEB', 'APP', 'BBK', 'CAM']).default('WEB'),
  registration_camp_id: z.string().uuid().optional(),
  // Pre-screening answers (Step 1) — accepted but NOT yet evaluated against
  // the DRAFT eligibility bank. See services/donors/eligibility.js.
  prescreening_answers: z.record(z.string(), z.enum(['YES', 'NO'])).optional(),
});

// ── POST /donors/register (public) ───────────────────────────────────────
router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  const data = parsed.data;
  const mobile = normaliseIndianMobile(data.mobile);
  if (!mobile) return res.status(400).json({ error: 'invalid_mobile_format' });

  // QR camp validation: if registration_source='QRC', registration_camp_id is
  // required and must point to a planned/live camp.
  if (data.registration_source === 'QRC') {
    if (!data.registration_camp_id) {
      return res.status(400).json({ error: 'qr_registration_requires_camp_id' });
    }
    const { pool } = require('../config/db');
    const campR = await pool.query(`SELECT id, status FROM donation_camps WHERE id = $1`, [
      data.registration_camp_id,
    ]);
    if (campR.rowCount === 0) {
      return res.status(400).json({ error: 'camp_not_found' });
    }
    if (!['PL', 'LV'].includes(campR.rows[0].status)) {
      return res.status(409).json({ error: 'camp_not_active', status: campR.rows[0].status });
    }
  }

  // Quick eligibility soft-check using the DRAFT bank — informational only.
  const screening = data.prescreening_answers
    ? eligibility.evaluate(data.prescreening_answers)
    : null;
  if (screening && !screening.eligible) {
    return res.status(200).json({
      status: 'soft_decline',
      reason: 'permanent_exclusion',
      blocks: screening.permanent_blocks,
      message:
        'Based on your answers we are unable to register you as a donor at this time. Please consult a doctor for guidance.',
      draft: screening.draft,
    });
  }

  try {
    const result = await withRlsContextRaw(
      { actor_role: 'registration', change_reason: 'donor self-registration' },
      async (c) => {
        // Resolve / create the platform_users auth row
        const userR = await c.query(
          `INSERT INTO platform_users (role, mobile)
           VALUES ('donor', $1)
           ON CONFLICT (mobile) DO UPDATE SET role = EXCLUDED.role
           RETURNING id`,
          [mobile],
        );
        const platformUserId = userR.rows[0].id;

        // Duplicate detection (BLOCK on ABHA, FLAG on name+DOB / aadhaar+DOB)
        const dup = await checkDuplicates(c, {
          abha_id: data.abha_id || null,
          full_name: data.full_name,
          date_of_birth: data.date_of_birth,
          aadhaar_last4: data.aadhaar_last4 || null,
        });
        if (dup.action === 'BLOCK') {
          throw Object.assign(new Error(dup.message), {
            status: 409,
            code: dup.code,
            match_id: dup.match_id,
          });
        }

        const insR = await c.query(
          `INSERT INTO donors (
              mobile, mobile_verified, full_name, date_of_birth, gender,
              abha_id, aadhaar_last4, preferred_language,
              village_id, pincode, address_line, max_travel_km,
              blood_group_self_reported,
              preferred_contact_channel, whatsapp_opted_in, sms_opted_in,
              community_id, platform_user_id,
              registration_source, registration_camp_id,
              suspected_duplicate_of)
           VALUES (
              $1, FALSE, $2, $3, $4,
              $5, $6, $7,
              $8, $9, $10, $11,
              $12,
              $13, $14, $15,
              $16, $17,
              $18, $19,
              $20)
           RETURNING id`,
          [
            mobile,
            data.full_name, // TODO: encryption.encrypt() once column-encrypted
            data.date_of_birth,
            data.gender,
            data.abha_id || null,
            data.aadhaar_last4 || null,
            data.preferred_language,
            data.village_id || null,
            data.pincode || null,
            data.address_line || null,
            data.max_travel_km,
            data.blood_group_self_reported || null,
            data.preferred_contact_channel,
            data.whatsapp_opted_in,
            data.sms_opted_in,
            data.community_id || null,
            platformUserId,
            data.registration_source,
            data.registration_camp_id || null,
            dup.action === 'FLAG' ? dup.match_id : null,
          ],
        );

        return {
          donor_id: insR.rows[0].id,
          platform_user_id: platformUserId,
          duplicate_flag: dup.action === 'FLAG' ? dup.code : null,
        };
      },
    );

    res.status(201).json({
      status: 'registered',
      ...result,
      mobile_verification_required: true,
      next_step:
        'POST /auth/otp/send to verify the mobile, then POST /donors/me/consent to grant data-use consent.',
    });
  } catch (err) {
    if (err.status === 409) {
      return res
        .status(409)
        .json({ error: err.code, message: err.message, match_id: err.match_id });
    }
    throw err;
  }
});

// ── GET /donors/me ───────────────────────────────────────────────────────
router.get('/me', verifyJWT, requireRole('donor'), async (req, res) => {
  const r = await withRlsContext(req, (c) =>
    c.query(`SELECT id FROM donors WHERE platform_user_id = $1 LIMIT 1`, [req.user.userId]),
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'donor_profile_not_found' });
  const passport = await withRlsContext(req, (c) => buildPassport(c, r.rows[0].id));
  res.json(passport);
});

// ── GET /donors/:id/passport ─────────────────────────────────────────────
router.get('/:id/passport', verifyJWT, async (req, res) => {
  // Self / coordinator / admin / blood_bank can read; RLS gates the underlying
  // donors row read in buildPassport().
  const passport = await withRlsContext(req, (c) => buildPassport(c, req.params.id));
  if (!passport) return res.status(404).json({ error: 'donor_not_found_or_no_access' });
  res.json(passport);
});

// ── POST /donors/:id/availability ────────────────────────────────────────
router.post('/:id/availability', verifyJWT, requireRole('donor'), async (req, res) => {
  const schema = z.object({
    is_available: z.boolean(),
    available_hours_start: z.number().int().min(0).max(23).optional(),
    available_hours_end: z.number().int().min(0).max(23).optional(),
    emergency_override: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const fields = Object.entries(parsed.data);
  const setSql = fields.map(([k], i) => `${k} = $${i + 3}`).join(', ');
  const values = [req.params.id, req.user.userId, ...fields.map(([, v]) => v)];

  const r = await withRlsContext(
    req,
    (c) =>
      c.query(
        `UPDATE donors SET ${setSql}
          WHERE id = $1 AND platform_user_id = $2
       RETURNING id, is_available, available_hours_start, available_hours_end, emergency_override`,
        values,
      ),
    { change_reason: 'donor toggled availability' },
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found_or_not_owner' });
  res.json(r.rows[0]);
});

// ── POST /donors/:id/consent ─────────────────────────────────────────────
// Spec §3 trg_donors_consent_protect rejects this from non-donor actors.
router.post('/:id/consent', verifyJWT, requireRole('donor'), async (req, res) => {
  const schema = z.object({ consent_data_use: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  try {
    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE donors
              SET consent_data_use = $3,
                  consent_given_at = CASE WHEN $3 = TRUE THEN clock_timestamp() ELSE consent_given_at END
            WHERE id = $1 AND platform_user_id = $2
        RETURNING id, consent_data_use, consent_given_at`,
          [req.params.id, req.user.userId, parsed.data.consent_data_use],
        ),
      { change_reason: 'donor consent change' },
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found_or_not_owner' });
    res.json(r.rows[0]);
  } catch (err) {
    if (/consent.*donor themselves/i.test(err.message)) {
      return res.status(403).json({ error: 'consent_self_only' });
    }
    throw err;
  }
});

// ── POST /donors/:id/blood-group/verify (blood_bank only) ────────────────
// Spec §5.4: blood_group_verified is the ONLY field used in matching, and
// can ONLY be written by the bb_writer Postgres role used by the blood-bank
// API connection. RLS enforces; the route additionally checks role.
router.post('/:id/blood-group/verify', verifyJWT, requireRole('blood_bank'), async (req, res) => {
  const schema = z.object({
    blood_group_id: z.number().int().min(1).max(8),
    verification_method: z.string().min(2).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  // bb_writer-roled connection is acquired here. Note: in the
  // current pool config, all backend connections run as the migration user
  // which is a member of bb_writer. The role gating is enforced by the RLS
  // policy on donors UPDATE which inspects bloodconnect.actor_role.
  const r = await withRlsContext(
    req,
    (c) =>
      c.query(
        `UPDATE donors
              SET blood_group_verified = $1,
                  blood_group_verified_at = clock_timestamp(),
                  blood_group_verified_by = $2
            WHERE id = $3
        RETURNING id, blood_group_verified, blood_group_verified_at`,
        [parsed.data.blood_group_id, req.user.institutionId, req.params.id],
      ),
    { change_reason: 'lab blood-group verification' },
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json(r.rows[0]);
});

// ── POST /donors/merge (ngo_admin) ───────────────────────────────────────
router.post('/merge', verifyJWT, requireRole('ngo_admin', 'super_admin'), async (_req, res) => {
  // STUB. See services/donors/merge.js for the design and the reason this
  // is gated until the medical advisor confirms deferral merge semantics.
  res
    .status(501)
    .json({ error: 'not_implemented', message: 'donor merge pending medical-advisor review' });
});

module.exports = router;
