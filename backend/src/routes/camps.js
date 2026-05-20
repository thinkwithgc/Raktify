/**
 * Donation camp routes (spec §11).
 *
 *   GET  /camps                    list — upcoming + (optional) district filter
 *   GET  /camps/:id                detail
 *   GET  /camps/:id/registrations  roster — coordinator/admin/BB
 *   POST /camps                    create — coordinator/admin
 *   POST /camps/:id/register       donor self-RSVP
 *   DELETE /camps/:id/register     donor cancels RSVP
 *
 * The denormalised donation_camps.registered_donor_count is kept in sync by
 * triggers on camp_registrations (migration 260).
 */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /camps ───────────────────────────────────────────────────────────
// Default: status IN ('PL','LV') and scheduled_date >= today.
// Optional ?district_id=... and ?status=...
router.get('/', verifyJWT, async (req, res) => {
  const districtId = req.query.district_id ? Number(req.query.district_id) : null;
  const status = req.query.status || null;

  const r = await withRlsContext(req, (c) =>
    c.query(
      `SELECT c.id, c.name, c.slug, c.qr_code_token,
              c.district_id, d.name AS district_name,
              c.venue, c.address_line, c.pincode,
              c.scheduled_date, c.start_time, c.end_time,
              c.organiser_name, c.organiser_type,
              c.target_donor_count, c.registered_donor_count,
              c.attended_donor_count, c.units_collected,
              c.status, c.partnered_blood_bank_id,
              i.display_name AS partnered_blood_bank_name
         FROM donation_camps c
         JOIN districts d ON d.id = c.district_id
    LEFT JOIN institutions i ON i.id = c.partnered_blood_bank_id
        WHERE ($1::int  IS NULL OR c.district_id = $1)
          AND ($2::text IS NULL OR c.status = $2)
          AND ($2::text IS NOT NULL OR (c.status IN ('PL','LV') AND c.scheduled_date >= CURRENT_DATE))
     ORDER BY c.scheduled_date ASC, c.start_time ASC
        LIMIT 100`,
      [districtId, status],
    ),
  );
  res.json({ camps: r.rows, count: r.rowCount });
});

// ── GET /camps/:id ───────────────────────────────────────────────────────
router.get('/:id', verifyJWT, async (req, res) => {
  const r = await withRlsContext(req, (c) =>
    c.query(
      `SELECT c.*, d.name AS district_name,
              i.display_name AS partnered_blood_bank_name
         FROM donation_camps c
         JOIN districts d ON d.id = c.district_id
    LEFT JOIN institutions i ON i.id = c.partnered_blood_bank_id
        WHERE c.id = $1`,
      [req.params.id],
    ),
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json(r.rows[0]);
});

// ── GET /camps/:id/registrations ─────────────────────────────────────────
router.get(
  '/:id/registrations',
  verifyJWT,
  requireRole('coordinator', 'ngo_admin', 'super_admin', 'blood_bank'),
  async (req, res) => {
    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT cr.id, cr.status, cr.registered_at, cr.source,
                d.id AS donor_id, d.full_name,
                bg.code AS blood_group_code
           FROM camp_registrations cr
           JOIN donors d        ON d.id = cr.donor_id
      LEFT JOIN blood_groups bg ON bg.id = d.blood_group_verified
          WHERE cr.camp_id = $1
       ORDER BY cr.registered_at DESC`,
        [req.params.id],
      ),
    );
    res.json({ registrations: r.rows, count: r.rowCount });
  },
);

// ── POST /camps (create) ─────────────────────────────────────────────────
const createSchema = z.object({
  name: z.string().min(2),
  district_id: z.number().int().positive(),
  state_id: z.number().int().positive(),
  taluka_id: z.number().int().positive().optional(),
  venue: z.string().min(2),
  address_line: z.string().min(5),
  pincode: z
    .string()
    .regex(/^[1-9]\d{5}$/)
    .optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  organiser_type: z.enum(['CC', 'CO', 'EI', 'EO', 'MC', 'OT']),
  organiser_name: z.string().min(2),
  organiser_contact_name: z.string().optional(),
  partnered_blood_bank_id: z.string().uuid().optional(),
  target_donor_count: z.number().int().positive().max(2000).optional(),
});

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

router.post(
  '/',
  verifyJWT,
  requireRole('coordinator', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
    }
    const d = parsed.data;
    const slug = `${slugify(d.name)}-${Date.now().toString(36).slice(-5)}`;
    const qrToken = crypto.randomBytes(18).toString('base64url');

    const result = await withRlsContext(
      req,
      async (c) => {
        // Look up coordinator id if the actor is a coordinator.
        let organisingCoordId = null;
        if (req.user.role === 'coordinator') {
          const cr = await c.query(`SELECT id FROM coordinators WHERE platform_user_id = $1`, [
            req.user.userId,
          ]);
          if (cr.rowCount > 0) organisingCoordId = cr.rows[0].id;
        }

        const r = await c.query(
          `INSERT INTO donation_camps (
             name, slug, qr_code_token,
             state_id, district_id, taluka_id,
             venue, address_line, pincode,
             scheduled_date, start_time, end_time,
             organiser_type, organiser_name, organiser_contact_name,
             partnered_blood_bank_id, organising_coordinator_id,
             target_donor_count, status, created_by_user_id)
           VALUES (
             $1, $2, $3,
             $4, $5, $6,
             $7, $8, $9,
             $10, $11, $12,
             $13, $14, $15,
             $16, $17,
             $18, 'PL', $19)
           RETURNING id, name, slug, qr_code_token, scheduled_date, status`,
          [
            d.name,
            slug,
            qrToken,
            d.state_id,
            d.district_id,
            d.taluka_id || null,
            d.venue,
            d.address_line,
            d.pincode || null,
            d.scheduled_date,
            d.start_time,
            d.end_time,
            d.organiser_type,
            d.organiser_name,
            d.organiser_contact_name || null,
            d.partnered_blood_bank_id || null,
            organisingCoordId,
            d.target_donor_count || null,
            req.user.userId,
          ],
        );
        return r.rows[0];
      },
      { change_reason: 'create donation camp' },
    );

    res.status(201).json(result);
  },
);

// ── POST /camps/:id/register (donor RSVP) ────────────────────────────────
router.post('/:id/register', verifyJWT, requireRole('donor'), async (req, res) => {
  const result = await withRlsContext(
    req,
    async (c) => {
      const donorR = await c.query(`SELECT id FROM donors WHERE platform_user_id = $1`, [
        req.user.userId,
      ]);
      if (donorR.rowCount === 0) {
        throw Object.assign(new Error('donor_profile_not_found'), { status: 404 });
      }
      const donorId = donorR.rows[0].id;
      const r = await c.query(
        `INSERT INTO camp_registrations (camp_id, donor_id, source)
         VALUES ($1, $2, 'WB')
         ON CONFLICT (camp_id, donor_id) DO UPDATE
            SET status = 'RG', status_changed_at = clock_timestamp()
         RETURNING id, status, registered_at`,
        [req.params.id, donorId],
      );
      return r.rows[0];
    },
    { change_reason: 'donor RSVP to camp' },
  );
  res.status(201).json(result);
});

// ── DELETE /camps/:id/register (donor cancels) ───────────────────────────
router.delete('/:id/register', verifyJWT, requireRole('donor'), async (req, res) => {
  await withRlsContext(
    req,
    async (c) => {
      const donorR = await c.query(`SELECT id FROM donors WHERE platform_user_id = $1`, [
        req.user.userId,
      ]);
      if (donorR.rowCount === 0) {
        throw Object.assign(new Error('donor_profile_not_found'), { status: 404 });
      }
      await c.query(`DELETE FROM camp_registrations WHERE camp_id = $1 AND donor_id = $2`, [
        req.params.id,
        donorR.rows[0].id,
      ]);
    },
    { change_reason: 'donor cancels camp RSVP' },
  );
  res.json({ cancelled: true });
});

module.exports = router;
