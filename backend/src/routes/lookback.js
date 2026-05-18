/**
 * Lookback admin routes (spec §8 — lookback protocol).
 *
 * The lookback chain is created automatically by the DB trigger
 * fn_lookback_fire_on_clearance when donor_screening.overall_clearance
 * becomes 'IN' (verified reactive TTI). This module only exposes the
 * admin-facing API to follow up on those rows.
 *
 *   GET  /lookback                       open lookback queue
 *   GET  /lookback/donor/:donor_id       all rows for one donor
 *   GET  /lookback/:id                   one row, full detail
 *   POST /lookback/:id/contact-hospital  records hospital contact attempt
 *   POST /lookback/:id/dho-notify        records DHO notification (mandatory for HIV/HBsAg)
 *   POST /lookback/:id/close             close case with outcome notes
 *
 * RLS: lb_admin_only_read + lb_admin_update — ngo_admin/super_admin only.
 */
const express = require('express');
const { z } = require('zod');

const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /lookback (open queue) ───────────────────────────────────────────
router.get('/', verifyJWT, requireRole('ngo_admin', 'super_admin'), async (req, res) => {
  const status = req.query.status || 'OPEN';
  const filter =
    status === 'OPEN' ? `lookback_status IN ('OP','IP','CN','RV')` : `lookback_status = $1`;

  // `filter` is one of two hardcoded SQL fragments selected by `status`.
  // No user input is interpolated into the SQL — the status value, when
  // used, is passed via $1.
  const r = await withRlsContext(req, (c) =>
    c.query(
      // eslint-disable-next-line no-restricted-syntax
      `SELECT id, donor_id, donation_id, tti_trigger, lookback_status,
              bags_recalled_count, bags_already_issued, bags_already_transfused,
              receiving_institution_ids, dho_notified, dho_notified_at,
              hospital_contacted_at, hospital_contacted_by,
              created_at, closed_at,
              EXTRACT(EPOCH FROM (NOW() - created_at))::int AS seconds_open
         FROM lookback_registry
        WHERE ${filter}
     ORDER BY created_at ASC
        LIMIT 500`,
      status === 'OPEN' ? [] : [status],
    ),
  );
  res.json({ lookback_cases: r.rows, count: r.rowCount });
});

// ── GET /lookback/donor/:donor_id ────────────────────────────────────────
router.get(
  '/donor/:donor_id',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT id, donation_id, triggering_screening_id, tti_trigger,
                lookback_status, bags_recalled_count, bags_already_issued,
                bags_already_transfused, receiving_institution_ids,
                dho_notified, dho_notified_at, hospital_contacted_at,
                hospital_response, recipient_verified_at, outcome_notes,
                closed_at, created_at
           FROM lookback_registry
          WHERE donor_id = $1
       ORDER BY created_at DESC`,
        [req.params.donor_id],
      ),
    );
    res.json({ donor_id: req.params.donor_id, lookback_cases: r.rows, count: r.rowCount });
  },
);

// ── GET /lookback/:id ────────────────────────────────────────────────────
router.get('/:id', verifyJWT, requireRole('ngo_admin', 'super_admin'), async (req, res) => {
  const r = await withRlsContext(req, (c) =>
    c.query(`SELECT * FROM lookback_registry WHERE id = $1`, [req.params.id]),
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json(r.rows[0]);
});

// ── POST /lookback/:id/contact-hospital ──────────────────────────────────
router.post(
  '/:id/contact-hospital',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const schema = z.object({
      response_summary: z.string().min(2).optional(),
      recipient_verified: z.boolean().default(false),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE lookback_registry
              SET hospital_contacted_at = clock_timestamp(),
                  hospital_contacted_by = $2,
                  hospital_response = COALESCE($3, hospital_response),
                  recipient_verified_at = CASE WHEN $4 THEN clock_timestamp() ELSE recipient_verified_at END,
                  lookback_status = CASE
                    WHEN $4 THEN 'RV'
                    WHEN lookback_status = 'OP' THEN 'CN'
                    ELSE lookback_status END
            WHERE id = $1
        RETURNING id, lookback_status, hospital_contacted_at`,
          [
            req.params.id,
            req.user.userId,
            parsed.data.response_summary || null,
            parsed.data.recipient_verified,
          ],
        ),
      { change_reason: 'lookback hospital contact' },
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  },
);

// ── POST /lookback/:id/dho-notify ────────────────────────────────────────
router.post(
  '/:id/dho-notify',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const schema = z.object({ notification_ref: z.string().min(2) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE lookback_registry
              SET dho_notified = TRUE,
                  dho_notified_at = clock_timestamp(),
                  dho_notification_ref = $2
            WHERE id = $1
        RETURNING id, dho_notified, dho_notified_at`,
          [req.params.id, parsed.data.notification_ref],
        ),
      { change_reason: 'DHO notification recorded' },
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  },
);

// ── POST /lookback/:id/close ─────────────────────────────────────────────
// HIV/HBsAg close is gated by trg_lookback_touch — requires dho_notified=TRUE.
router.post('/:id/close', verifyJWT, requireRole('ngo_admin', 'super_admin'), async (req, res) => {
  const schema = z.object({
    outcome_notes: z.string().min(10),
    final_status: z.enum(['CL', 'EX']).default('CL'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  try {
    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE lookback_registry
              SET lookback_status = $2,
                  outcome_notes = $3,
                  closed_at = clock_timestamp(),
                  closed_by = $4
            WHERE id = $1
              AND lookback_status NOT IN ('CL','EX')
        RETURNING id, lookback_status, closed_at`,
          [req.params.id, parsed.data.final_status, parsed.data.outcome_notes, req.user.userId],
        ),
      { change_reason: 'lookback closure' },
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found_or_already_closed' });
    res.json(r.rows[0]);
  } catch (err) {
    if (/HIV.*HBsAg.*dho_notified/i.test(err.message)) {
      return res.status(422).json({ error: 'dho_notification_required_before_close' });
    }
    throw err;
  }
});

module.exports = router;
