/**
 * Patient + rare-blood registries (spec §13, §14).
 *
 *   GET  /registries/thalassemia            list — admin/coordinator/hospital
 *   POST /registries/thalassemia            enrol
 *   POST /registries/thalassemia/:id/transfusion  bump last_transfusion_date
 *
 *   GET  /registries/rare-blood             list — admin/coordinator/BB
 *   POST /registries/rare-blood             enrol (donor-linked or shadow)
 *
 * RLS already gates these per migration 200; the route layer just adds
 * input validation and the change_reason metadata.
 */
const express = require('express');
const { z } = require('zod');

const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { normaliseIndianMobile } = require('../utils/phone');

const router = express.Router();

// ── GET /registries/thalassemia ──────────────────────────────────────────
router.get(
  '/thalassemia',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin', 'coordinator', 'hospital'),
  async (req, res) => {
    const onlyActive = req.query.active !== 'false';
    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT t.id, t.full_name, t.date_of_birth, t.gender,
                t.diagnosis_subtype, t.transfusion_interval_days,
                t.last_transfusion_date, t.next_transfusion_due,
                t.default_units, t.is_active, t.registered_at,
                bg.code AS blood_group_code,
                bc.code AS component_code,
                i.display_name AS treating_hospital_name,
                d.name AS district_name,
                CARDINALITY(t.paired_donor_ids) AS paired_donor_count,
                CASE WHEN t.next_transfusion_due IS NOT NULL
                  AND t.next_transfusion_due <= CURRENT_DATE + 7
                  THEN TRUE ELSE FALSE END AS is_due_soon
           FROM thalassemia_patients t
           JOIN blood_groups bg     ON bg.id = t.blood_group_id
           JOIN blood_components bc ON bc.id = t.default_component_id
           JOIN institutions i      ON i.id  = t.treating_hospital_id
      LEFT JOIN districts d         ON d.id  = t.district_id
          WHERE ($1::boolean IS FALSE OR t.is_active = TRUE)
       ORDER BY (t.next_transfusion_due IS NULL),
                t.next_transfusion_due ASC
          LIMIT 200`,
        [onlyActive],
      ),
    );
    res.json({ patients: r.rows, count: r.rowCount });
  },
);

// ── POST /registries/thalassemia ─────────────────────────────────────────
const thalSchema = z.object({
  full_name: z.string().min(2),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(['M', 'F', 'O']),
  guardian_name: z.string().optional(),
  guardian_mobile: z.string().optional(),
  blood_group_id: z.number().int().min(1).max(8),
  diagnosis_subtype: z.string().optional(),
  diagnosed_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  treating_hospital_id: z.string().uuid(),
  treating_doctor_name: z.string().optional(),
  transfusion_interval_days: z.number().int().min(7).max(90).optional(),
  last_transfusion_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  default_units: z.number().int().min(1).max(10).optional(),
  default_component_id: z.number().int().min(1).max(6),
  state_id: z.number().int().positive().optional(),
  district_id: z.number().int().positive().optional(),
});

router.post(
  '/thalassemia',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin', 'coordinator', 'hospital'),
  async (req, res) => {
    const parsed = thalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
    }
    const d = parsed.data;
    const guardianMobile = d.guardian_mobile ? normaliseIndianMobile(d.guardian_mobile) : null;

    const result = await withRlsContext(
      req,
      async (c) => {
        // Coordinator id (optional attribution).
        let coordId = null;
        if (req.user.role === 'coordinator') {
          const cr = await c.query(`SELECT id FROM coordinators WHERE platform_user_id = $1`, [
            req.user.userId,
          ]);
          if (cr.rowCount > 0) coordId = cr.rows[0].id;
        }
        const r = await c.query(
          `INSERT INTO thalassemia_patients (
             full_name, date_of_birth, gender,
             guardian_name, guardian_mobile,
             blood_group_id, diagnosis_subtype, diagnosed_at,
             treating_hospital_id, treating_doctor_name,
             transfusion_interval_days, last_transfusion_date,
             default_units, default_component_id,
             state_id, district_id,
             registered_by_coordinator)
           VALUES (
             $1, $2, $3,
             $4, $5,
             $6, $7, $8,
             $9, $10,
             $11, $12,
             $13, $14,
             $15, $16,
             $17)
           RETURNING id, full_name, next_transfusion_due, registered_at`,
          [
            d.full_name,
            d.date_of_birth,
            d.gender,
            d.guardian_name || null,
            guardianMobile,
            d.blood_group_id,
            d.diagnosis_subtype || null,
            d.diagnosed_at || null,
            d.treating_hospital_id,
            d.treating_doctor_name || null,
            d.transfusion_interval_days || 21,
            d.last_transfusion_date || null,
            d.default_units || 1,
            d.default_component_id,
            d.state_id || null,
            d.district_id || null,
            coordId,
          ],
        );
        return r.rows[0];
      },
      { change_reason: 'enrol thalassemia patient' },
    );
    res.status(201).json(result);
  },
);

// ── POST /registries/thalassemia/:id/transfusion ─────────────────────────
// Bump last_transfusion_date; the table trigger auto-computes next_transfusion_due.
router.post(
  '/thalassemia/:id/transfusion',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin', 'coordinator', 'hospital'),
  async (req, res) => {
    const schema = z.object({
      transfusion_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE thalassemia_patients
              SET last_transfusion_date = COALESCE($2::date, CURRENT_DATE)
            WHERE id = $1 AND is_active = TRUE
        RETURNING id, last_transfusion_date, next_transfusion_due`,
          [req.params.id, parsed.data.transfusion_date || null],
        ),
      { change_reason: 'record transfusion for thalassemia patient' },
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found_or_inactive' });
    res.json(r.rows[0]);
  },
);

// ── GET /registries/rare-blood ───────────────────────────────────────────
router.get(
  '/rare-blood',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin', 'coordinator', 'blood_bank'),
  async (req, res) => {
    const onlyActive = req.query.active !== 'false';
    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT r.id, r.donor_id, r.phenotype_code, r.phenotype_description,
                r.abo_type, r.rh_factor, r.is_bombay,
                r.broadcast_consent, r.verified_at, r.verified_method,
                r.contact_state_id, r.contact_district_id,
                d.full_name AS donor_name,
                bg.code AS donor_blood_group_code,
                i.display_name AS verified_by_name,
                dist.name AS contact_district_name,
                r.is_active
           FROM rare_blood_registry r
      LEFT JOIN donors d ON d.id = r.donor_id
      LEFT JOIN blood_groups bg ON bg.id = d.blood_group_verified
           JOIN institutions i ON i.id = r.verified_by_institution_id
      LEFT JOIN districts dist ON dist.id = r.contact_district_id
          WHERE ($1::boolean IS FALSE OR r.is_active = TRUE)
       ORDER BY r.is_bombay DESC, r.verified_at DESC
          LIMIT 200`,
        [onlyActive],
      ),
    );
    res.json({ registry: r.rows, count: r.rowCount });
  },
);

// ── POST /registries/rare-blood ──────────────────────────────────────────
const rareSchema = z
  .object({
    donor_id: z.string().uuid().optional(),
    phenotype_code: z.string().min(2),
    phenotype_description: z.string().min(2),
    abo_type: z.enum(['A', 'B', 'AB', 'O']).optional(),
    rh_factor: z.enum(['+', '-']).optional(),
    is_bombay: z.boolean().optional(),
    verified_by_institution_id: z.string().uuid(),
    verified_method: z.string().optional(),
    contact_name: z.string().optional(),
    contact_mobile: z.string().optional(),
    contact_state_id: z.number().int().positive().optional(),
    contact_district_id: z.number().int().positive().optional(),
    broadcast_consent: z.boolean().optional(),
  })
  .refine((d) => d.donor_id || (d.contact_name && d.contact_mobile), {
    message: 'donor_id_or_shadow_contact_required',
  });

router.post(
  '/rare-blood',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin', 'blood_bank'),
  async (req, res) => {
    const parsed = rareSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
    }
    const d = parsed.data;
    const contactMobile = d.contact_mobile ? normaliseIndianMobile(d.contact_mobile) : null;

    try {
      const r = await withRlsContext(
        req,
        (c) =>
          c.query(
            `INSERT INTO rare_blood_registry (
               donor_id, phenotype_code, phenotype_description,
               abo_type, rh_factor, is_bombay,
               verified_by_institution_id, verified_method,
               contact_name, contact_mobile,
               contact_state_id, contact_district_id,
               broadcast_consent, broadcast_consent_at)
             VALUES (
               $1, $2, $3,
               $4, $5, $6,
               $7, $8,
               $9, $10,
               $11, $12,
               $13, CASE WHEN $13 THEN clock_timestamp() ELSE NULL END)
             RETURNING id, phenotype_code, is_bombay, verified_at`,
            [
              d.donor_id || null,
              d.phenotype_code,
              d.phenotype_description,
              d.abo_type || null,
              d.rh_factor || null,
              d.is_bombay ?? false,
              d.verified_by_institution_id,
              d.verified_method || null,
              d.contact_name || null,
              contactMobile,
              d.contact_state_id || null,
              d.contact_district_id || null,
              d.broadcast_consent ?? false,
            ],
          ),
        { change_reason: 'enrol in rare-blood registry' },
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (/donor_or_shadow/i.test(err.message)) {
        return res.status(400).json({ error: 'donor_id_or_shadow_contact_required' });
      }
      throw err;
    }
  },
);

module.exports = router;
