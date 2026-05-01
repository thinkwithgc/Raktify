/**
 * Coordinator dashboard + actions (spec §7).
 *
 *   GET  /coordinator/requests                 list open requests for own district
 *   POST /coordinator/requests/:id/accept      coordinator confirms ownership
 *   POST /coordinator/requests/:id/claim       claim from another non-responsive coordinator
 *   POST /coordinator/requests/:id/verify      Tier 3/4 verification → unblocks matching
 *   POST /coordinator/requests/:id/noshow      mark a confirmed donor as no-show
 *   POST /coordinator/requests/:id/close       mark fulfilled with bag IDs
 *   POST /coordinator/requests/:id/thread      append a message to request_threads
 *   GET  /coordinator/requests/:id/thread      read messages visible to this role
 */
const express = require('express');
const { z } = require('zod');

const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { runMatch } = require('../services/matching');

const router = express.Router();

// ── GET /coordinator/requests ────────────────────────────────────────────
router.get(
  '/requests',
  verifyJWT,
  requireRole('coordinator', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    // For ngo_admin, return all open; for coordinator, scope to district.
    let districtId = null;
    if (req.user.role === 'coordinator') {
      const c = await withRlsContext(req, (c) =>
        c.query(`SELECT district_id FROM coordinators WHERE platform_user_id = $1`, [
          req.user.userId,
        ]),
      );
      if (c.rowCount === 0) return res.status(404).json({ error: 'coordinator_profile_not_found' });
      districtId = c.rows[0].district_id;
    }

    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT br.id, br.request_number, br.source_tier, br.urgency_tier,
              br.units_required, br.units_fulfilled, br.status,
              br.patient_blood_group_id, bg.code AS blood_group_code,
              br.component_id, bc.code AS component_code,
              br.needed_by, br.raised_at,
              br.matched_blood_bank_id,
              ra.coordinator_id, ra.coordinator_accepted_at,
              EXTRACT(EPOCH FROM (NOW() - br.raised_at))::int AS seconds_since_raised
         FROM blood_requests br
    LEFT JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
    LEFT JOIN blood_components bc ON bc.id = br.component_id
    LEFT JOIN request_assignments ra ON ra.request_id = br.id AND ra.is_current = TRUE
        WHERE br.status IN ('OP','MT','AS','PF')
          AND ($1::int IS NULL OR br.requesting_hospital_district_id = $1)
     ORDER BY br.urgency_tier ASC, br.raised_at DESC
        LIMIT 200`,
        [districtId],
      ),
    );
    res.json({ requests: r.rows, count: r.rowCount, scope_district_id: districtId });
  },
);

// ── POST /coordinator/requests/:id/accept ────────────────────────────────
router.post('/requests/:id/accept', verifyJWT, requireRole('coordinator'), async (req, res) => {
  const result = await withRlsContext(
    req,
    async (c) => {
      const coordR = await c.query(`SELECT id FROM coordinators WHERE platform_user_id = $1`, [
        req.user.userId,
      ]);
      if (coordR.rowCount === 0) {
        throw Object.assign(new Error('coordinator_profile_not_found'), { status: 404 });
      }
      const r = await c.query(
        `UPDATE request_assignments
            SET coordinator_accepted_at = clock_timestamp()
          WHERE request_id = $1
            AND coordinator_id = $2
            AND is_current = TRUE
            AND coordinator_accepted_at IS NULL
       RETURNING id, coordinator_accepted_at`,
        [req.params.id, coordR.rows[0].id],
      );
      if (r.rowCount === 0) {
        throw Object.assign(new Error('not_assigned_to_you_or_already_accepted'), { status: 409 });
      }
      // Bump request status OP → AS if still in OP.
      await c.query(`UPDATE blood_requests SET status = 'AS' WHERE id = $1 AND status = 'OP'`, [
        req.params.id,
      ]);
      return r.rows[0];
    },
    { change_reason: 'coordinator accepts assignment' },
  );
  res.json(result);
});

// ── POST /coordinator/requests/:id/claim ─────────────────────────────────
router.post('/requests/:id/claim', verifyJWT, requireRole('coordinator'), async (req, res) => {
  const result = await withRlsContext(
    req,
    async (c) => {
      const coordR = await c.query(`SELECT id FROM coordinators WHERE platform_user_id = $1`, [
        req.user.userId,
      ]);
      if (coordR.rowCount === 0) {
        throw Object.assign(new Error('coordinator_profile_not_found'), { status: 404 });
      }
      const ins = await c.query(
        `INSERT INTO request_assignments (
           request_id, coordinator_id, assignment_type, assigned_by_user_id,
           coordinator_accepted_at)
         VALUES ($1, $2, 'CL', $3, clock_timestamp())
         RETURNING id`,
        [req.params.id, coordR.rows[0].id, req.user.userId],
      );
      // The supersede trigger demotes the prior current row.
      return { assignment_id: ins.rows[0].id };
    },
    { change_reason: 'coordinator claims request' },
  );
  res.json(result);
});

// ── POST /coordinator/requests/:id/verify (Tier 3/4) ─────────────────────
router.post('/requests/:id/verify', verifyJWT, requireRole('coordinator'), async (req, res) => {
  const result = await withRlsContext(
    req,
    async (c) => {
      const coordR = await c.query(`SELECT id FROM coordinators WHERE platform_user_id = $1`, [
        req.user.userId,
      ]);
      if (coordR.rowCount === 0) {
        throw Object.assign(new Error('coordinator_profile_not_found'), { status: 404 });
      }

      const reqR = await c.query(
        `SELECT id, source_tier, status, donor_activation_required,
                urgency_tier, requesting_hospital_district_id,
                component_id, patient_blood_group_id, units_required, units_fulfilled,
                coordinator_verified_at
           FROM blood_requests WHERE id = $1`,
        [req.params.id],
      );
      if (reqR.rowCount === 0) {
        throw Object.assign(new Error('not_found'), { status: 404 });
      }
      if (!['CR', 'CI'].includes(reqR.rows[0].source_tier)) {
        throw Object.assign(new Error('verify_only_for_tier_3_or_4'), { status: 400 });
      }
      if (reqR.rows[0].coordinator_verified_at) {
        throw Object.assign(new Error('already_verified'), { status: 409 });
      }

      await c.query(
        `UPDATE blood_requests
            SET coordinator_verified_at = clock_timestamp(),
                coordinator_verified_by = $2,
                donor_activation_required = TRUE
          WHERE id = $1`,
        [req.params.id, coordR.rows[0].id],
      );
      const refreshed = (
        await c.query(
          `SELECT id, status, source_tier, urgency_tier, donor_activation_required,
                  requesting_hospital_district_id, component_id, patient_blood_group_id,
                  units_required, units_fulfilled
             FROM blood_requests WHERE id = $1`,
          [req.params.id],
        )
      ).rows[0];

      const matchSummary = await runMatch(c, { request: refreshed, actorUserId: req.user.userId });
      return { verified: true, match: matchSummary };
    },
    { change_reason: 'coordinator verifies tier 3/4' },
  );
  res.json(result);
});

// ── POST /coordinator/requests/:id/noshow ────────────────────────────────
router.post('/requests/:id/noshow', verifyJWT, requireRole('coordinator'), async (req, res) => {
  const schema = z.object({ donor_id: z.string().uuid() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const r = await withRlsContext(
    req,
    (c) =>
      c.query(
        `UPDATE donor_alerts
            SET donor_response = 'NS',
                responded_at = clock_timestamp(),
                coordinator_notes = COALESCE(coordinator_notes, '') || E'\n[no-show recorded by coord]'
          WHERE request_id = $1 AND donor_id = $2
       RETURNING id, donor_response`,
        [req.params.id, parsed.data.donor_id],
      ),
    { change_reason: 'coordinator marked donor no-show' },
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'no_alert_for_donor' });
  res.json(r.rows[0]);
});

// ── POST /coordinator/requests/:id/close ─────────────────────────────────
router.post('/requests/:id/close', verifyJWT, requireRole('coordinator'), async (req, res) => {
  const schema = z.object({
    bag_ids: z.array(z.string().uuid()).min(1),
    crossmatch_confirmed: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const result = await withRlsContext(
    req,
    async (c) => {
      // Mark bags as TR (transfused) — terminal happy state.
      await c.query(
        `UPDATE blood_inventory
            SET status = 'TR',
                status_changed_by = $2
          WHERE id = ANY($1) AND status IN ('IS','RE')`,
        [parsed.data.bag_ids, req.user.userId],
      );
      const r = await c.query(
        `UPDATE blood_requests
            SET status = 'CL',
                closed_at = clock_timestamp(),
                crossmatch_confirmed = $2,
                crossmatch_confirmed_at = CASE WHEN $2 THEN clock_timestamp() ELSE NULL END,
                fulfilled_at = COALESCE(fulfilled_at, clock_timestamp()),
                units_fulfilled = GREATEST(units_fulfilled, $3)
          WHERE id = $1
            AND status IN ('FU','PF','MT','AS')
       RETURNING id, status`,
        [req.params.id, parsed.data.crossmatch_confirmed, parsed.data.bag_ids.length],
      );
      if (r.rowCount === 0) {
        throw Object.assign(new Error('not_found_or_wrong_state'), { status: 409 });
      }
      return r.rows[0];
    },
    { change_reason: 'coordinator closes request' },
  );
  res.json(result);
});

// ── POST /coordinator/requests/:id/thread ────────────────────────────────
const threadPostSchema = z.object({
  message_text: z.string().min(1).max(4000),
  message_type: z.enum(['CO', 'SY', 'HO', 'BB', 'ND', 'DH']).default('CO'),
  visible_to_roles: z
    .array(z.enum(['donor', 'coordinator', 'hospital', 'blood_bank', 'ngo_admin', 'super_admin']))
    .optional(),
});

router.post('/requests/:id/thread', verifyJWT, async (req, res) => {
  const parsed = threadPostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const result = await withRlsContext(
    req,
    async (c) => {
      const r = await c.query(
        `INSERT INTO request_threads (
           request_id, message_type, message_text,
           author_user_id, author_role, visible_to_roles)
         VALUES ($1, $2, $3, $4, $5,
                 COALESCE($6::text[],
                          ARRAY['coordinator','hospital','blood_bank','ngo_admin','super_admin']::text[]))
         RETURNING id, posted_at`,
        [
          req.params.id,
          parsed.data.message_type,
          parsed.data.message_text,
          req.user.userId,
          req.user.role,
          parsed.data.visible_to_roles || null,
        ],
      );
      return r.rows[0];
    },
    { change_reason: 'thread post' },
  );
  res.status(201).json(result);
});

// ── GET /coordinator/requests/:id/thread ─────────────────────────────────
router.get('/requests/:id/thread', verifyJWT, async (req, res) => {
  // RLS gates visibility (request_threads policy: visible_to_roles contains actor_role).
  const r = await withRlsContext(req, (c) =>
    c.query(
      `SELECT id, message_type, message_text, author_user_id, author_role,
              posted_at, edited_at, edit_original_text, visible_to_roles
         FROM request_threads
        WHERE request_id = $1
          AND is_deleted = FALSE
     ORDER BY posted_at ASC
        LIMIT 500`,
      [req.params.id],
    ),
  );
  res.json({ messages: r.rows, count: r.rowCount });
});

module.exports = router;
