/**
 * Institution management.
 *
 *   GET  /institutions             ngo_admin/super_admin → list
 *   GET  /institutions/:id         ngo_admin or self     → details
 *   PUT  /institutions/:id         ngo_admin             → update whitelist
 *   POST /institutions/:id/suspend ngo_admin             → suspend
 */
const express = require('express');
const { z } = require('zod');

const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', verifyJWT, requireRole('ngo_admin', 'super_admin'), async (req, res) => {
  const status = req.query.status;
  const r = await withRlsContext(req, (c) =>
    c.query(
      `SELECT id, kind, shortname, legal_name, district_id, onboarding_status,
                onboarded_at, mou_expires_at, is_active
           FROM institutions
          WHERE ($1::text IS NULL OR onboarding_status = $1)
          ORDER BY onboarded_at DESC NULLS LAST, onboarding_started_at DESC
          LIMIT 500`,
      [status || null],
    ),
  );
  res.json({ institutions: r.rows, count: r.rowCount });
});

router.get('/:id', verifyJWT, async (req, res) => {
  const isAdmin = ['ngo_admin', 'super_admin'].includes(req.user.role);
  const isSelf = req.user.institutionId === req.params.id;
  if (!isAdmin && !isSelf) return res.status(403).json({ error: 'forbidden' });

  const r = await withRlsContext(req, (c) =>
    c.query(
      `SELECT id, kind, shortname, legal_name, display_name,
              state_id, district_id, taluka_id, village_id,
              address_line, pincode, latitude, longitude,
              cdsco_licence_number, cdsco_licence_expires, hospital_registration_no,
              license_verified_at, primary_contact_name, primary_contact_designation,
              primary_contact_mobile, primary_contact_email,
              onboarding_status, onboarding_started_at, onboarded_at,
              suspended_at, suspension_reason,
              mou_signed_at, mou_expires_at, mou_signatory_name,
              has_inhouse_blood_bank, is_blood_bank_software_user, software_vendor,
              is_active, created_at, updated_at
         FROM institutions WHERE id = $1`,
      [req.params.id],
    ),
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json(r.rows[0]);
});

const updateSchema = z
  .object({
    display_name: z.string().min(2).optional(),
    address_line: z.string().min(5).optional(),
    pincode: z
      .string()
      .regex(/^[1-9]\d{5}$/)
      .optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    primary_contact_name: z.string().min(2).optional(),
    primary_contact_designation: z.string().optional(),
    primary_contact_mobile: z.string().optional(),
    primary_contact_email: z.string().email().optional(),
    has_inhouse_blood_bank: z.boolean().optional(),
    is_blood_bank_software_user: z.boolean().optional(),
    software_vendor: z.string().optional(),
  })
  .strict();

router.put('/:id', verifyJWT, requireRole('ngo_admin', 'super_admin'), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  const fields = Object.entries(parsed.data);
  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  const setSql = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values = [req.params.id, ...fields.map(([, v]) => v)];

  const r = await withRlsContext(
    req,
    (c) => c.query(`UPDATE institutions SET ${setSql} WHERE id = $1 RETURNING id`, values),
    { change_reason: 'admin update institution' },
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ status: 'updated', institution_id: r.rows[0].id });
});

router.post(
  '/:id/suspend',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const schema = z.object({ reason: z.string().min(5) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE institutions
              SET onboarding_status = 'SU',
                  suspended_at = clock_timestamp(),
                  suspension_reason = $2
            WHERE id = $1 AND onboarding_status NOT IN ('SU','AR')
        RETURNING id`,
          [req.params.id, parsed.data.reason],
        ),
      { change_reason: `admin suspend: ${parsed.data.reason}` },
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found_or_already_suspended' });
    res.json({ status: 'suspended', institution_id: r.rows[0].id });
  },
);

module.exports = router;
