/**
 * Blood request routes — all 4 source tiers (spec §7).
 *
 *   POST /requests              Tier 1 OH — onboarded hospital
 *   POST /requests/guest        Tier 2 GH — coordinator on behalf of non-onboarded hospital
 *   POST /requests/community    Tier 3 CR — coordinator on behalf of community patient
 *   POST /requests/citizen      Tier 4 CI — donor self-service request
 *   GET  /requests/:id          requesting hospital, coordinator, admin, matched BB
 *   POST /requests/:id/match    re-trigger matching (coordinator/admin)
 *   POST /requests/:id/cancel   requesting hospital, coordinator, admin
 *
 * Tier 3/4 require coordinator verification (POST /coordinator/requests/:id/verify)
 * before donor activation. Tier 1/2 activate immediately.
 *
 * After successful submission of OH/GH, runMatch() runs synchronously inside
 * the same transaction so the caller sees the matched_blood_bank_id and
 * compatibility fallback in the create response.
 */
const express = require('express');
const { z } = require('zod');

const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { runMatch } = require('../services/matching');

const router = express.Router();

const baseRequestSchema = {
  patient_initials: z.string().min(1).max(10),
  patient_age: z.number().int().min(0).max(120),
  patient_gender: z.enum(['M', 'F', 'O']),
  patient_blood_group_id: z.number().int().min(1).max(8),
  patient_phenotype_note: z.string().optional(),
  component_id: z.number().int().min(1).max(6),
  units_required: z.number().int().min(1).max(50),
  urgency_tier: z.enum(['PL', 'UR', 'CR']),
  needed_by: z.string().datetime(),
  clinical_indication: z.string().optional(),
  ward_or_bed: z.string().optional(),
};

const tier1Schema = z.object({
  ...baseRequestSchema,
  // institution_id is taken from req.user.institutionId for OH
});

const tier2Schema = z.object({
  ...baseRequestSchema,
  guest_hospital_name: z.string().min(2),
  guest_hospital_address: z.string().optional(),
  guest_doctor_name: z.string().min(2),
  guest_doctor_reg_number: z.string().optional(),
  requesting_hospital_district_id: z.number().int().positive(),
});

const tier3Schema = z.object({
  ...baseRequestSchema,
  guest_hospital_name: z.string().min(2),
  guest_doctor_name: z.string().min(2),
  requesting_hospital_district_id: z.number().int().positive(),
  // Tier 3 max urgency = UR
  urgency_tier: z.enum(['PL', 'UR']),
});

const tier4Schema = z.object({
  ...baseRequestSchema,
  guest_hospital_name: z.string().min(2),
  ward_or_bed: z.string().min(1),
  guest_doctor_name: z.string().min(2),
  requesting_hospital_district_id: z.number().int().positive(),
  urgency_tier: z.enum(['PL', 'UR']),
});

async function insertRequest(client, opts) {
  const r = await client.query(
    `INSERT INTO blood_requests (
        source_tier, requesting_institution_id, requesting_user_id,
        guest_hospital_name, guest_hospital_address,
        guest_doctor_name, guest_doctor_reg_number, guest_nmc_check_status,
        patient_initials, patient_age, patient_gender,
        patient_blood_group_id, patient_phenotype_note,
        component_id, units_required, urgency_tier, needed_by,
        clinical_indication, ward_or_bed,
        requesting_hospital_district_id,
        donor_activation_required)
     VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7, $8,
        $9, $10, $11,
        $12, $13,
        $14, $15, $16, $17,
        $18, $19,
        $20,
        $21)
     RETURNING id, request_number, status, urgency_tier, source_tier,
               donor_activation_required, requesting_hospital_district_id,
               component_id, patient_blood_group_id, units_required, units_fulfilled`,
    [
      opts.source_tier,
      opts.requesting_institution_id,
      opts.requesting_user_id,
      opts.guest_hospital_name || null,
      opts.guest_hospital_address || null,
      opts.guest_doctor_name || null,
      opts.guest_doctor_reg_number || null,
      opts.guest_nmc_check_status || null,
      opts.patient_initials,
      opts.patient_age,
      opts.patient_gender,
      opts.patient_blood_group_id,
      opts.patient_phenotype_note || null,
      opts.component_id,
      opts.units_required,
      opts.urgency_tier,
      opts.needed_by,
      opts.clinical_indication || null,
      opts.ward_or_bed || null,
      opts.requesting_hospital_district_id,
      opts.donor_activation_required,
    ],
  );
  return r.rows[0];
}

async function autoAssignCoordinator(client, request) {
  // Pick the on-duty district lead for this district, or any on-duty coordinator.
  const r = await client.query(
    `SELECT id FROM coordinators
      WHERE district_id = $1 AND is_active = TRUE AND on_duty = TRUE
   ORDER BY is_district_lead DESC, reliability_score DESC, joined_at ASC
      LIMIT 1`,
    [request.requesting_hospital_district_id],
  );
  if (r.rowCount === 0) return null;
  const coordinatorId = r.rows[0].id;

  // Auto-assignment is a system side effect of request creation, not a
  // hospital/donor action. Elevate to 'system' actor for this INSERT so
  // RLS policy assign_write (which restricts to coordinator/admin) permits
  // it. We capture the prior role and restore it after.
  const prior = await client.query(`SELECT current_setting('raktify.actor_role', TRUE) AS r`);
  await client.query(`SELECT set_config('raktify.actor_role', 'system', TRUE)`);
  let ins;
  try {
    ins = await client.query(
      `INSERT INTO request_assignments (request_id, coordinator_id, assignment_type)
       VALUES ($1, $2, 'AU')
       RETURNING id, coordinator_id`,
      [request.id, coordinatorId],
    );
  } finally {
    await client.query(`SELECT set_config('raktify.actor_role', $1, TRUE)`, [
      prior.rows[0].r || '',
    ]);
  }
  return ins.rows[0];
}

// ── POST /requests (Tier 1 OH) ───────────────────────────────────────────
router.post('/', verifyJWT, requireRole('hospital'), async (req, res) => {
  const parsed = tier1Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  if (!req.user.institutionId) {
    return res.status(403).json({ error: 'hospital_user_missing_institution' });
  }

  const result = await withRlsContext(
    req,
    async (c) => {
      // Look up the hospital's district
      const inst = await c.query(`SELECT district_id FROM institutions WHERE id = $1`, [
        req.user.institutionId,
      ]);
      if (inst.rowCount === 0) throw new Error('institution_not_found');
      const districtId = inst.rows[0].district_id;

      const created = await insertRequest(c, {
        ...parsed.data,
        source_tier: 'OH',
        requesting_institution_id: req.user.institutionId,
        requesting_user_id: req.user.userId,
        requesting_hospital_district_id: districtId,
        donor_activation_required: parsed.data.urgency_tier !== 'PL',
      });

      const assignment = await autoAssignCoordinator(c, created);
      const matchSummary = await runMatch(c, { request: created, actorUserId: req.user.userId });

      return { request: created, assignment, match: matchSummary };
    },
    { change_reason: 'OH request submission' },
  );

  res.status(201).json(result);
});

// ── POST /requests/guest (Tier 2 GH) ─────────────────────────────────────
router.post(
  '/guest',
  verifyJWT,
  requireRole('coordinator', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const parsed = tier2Schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
    }

    const result = await withRlsContext(
      req,
      async (c) => {
        const created = await insertRequest(c, {
          ...parsed.data,
          source_tier: 'GH',
          requesting_institution_id: null,
          requesting_user_id: req.user.userId,
          donor_activation_required: parsed.data.urgency_tier !== 'PL',
          guest_nmc_check_status: 'PE',
        });
        const assignment = await autoAssignCoordinator(c, created);
        const matchSummary = await runMatch(c, { request: created, actorUserId: req.user.userId });
        return { request: created, assignment, match: matchSummary };
      },
      { change_reason: 'GH request submission' },
    );
    res.status(201).json(result);
  },
);

// ── POST /requests/community (Tier 3 CR) ─────────────────────────────────
// No donor activation until coordinator verifies.
router.post('/community', verifyJWT, requireRole('coordinator'), async (req, res) => {
  const parsed = tier3Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }

  const result = await withRlsContext(
    req,
    async (c) => {
      const created = await insertRequest(c, {
        ...parsed.data,
        source_tier: 'CR',
        requesting_institution_id: null,
        requesting_user_id: req.user.userId,
        donor_activation_required: false, // gated until coordinator verify
      });
      const assignment = await autoAssignCoordinator(c, created);
      // No match run yet — verify gate.
      return { request: created, assignment, match: null, awaiting_verification: true };
    },
    { change_reason: 'CR community request' },
  );
  res.status(201).json(result);
});

// ── POST /requests/citizen (Tier 4 CI) ───────────────────────────────────
// Donor self-service. Max URGENT. Coordinator must verify before donor
// alerts can fire.
router.post('/citizen', verifyJWT, requireRole('donor'), async (req, res) => {
  const parsed = tier4Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }

  const result = await withRlsContext(
    req,
    async (c) => {
      const created = await insertRequest(c, {
        ...parsed.data,
        source_tier: 'CI',
        requesting_institution_id: null,
        requesting_user_id: req.user.userId,
        donor_activation_required: false, // gated until coordinator verify
      });
      const assignment = await autoAssignCoordinator(c, created);
      return { request: created, assignment, match: null, awaiting_verification: true };
    },
    { change_reason: 'CI citizen request' },
  );
  res.status(201).json(result);
});

// ── GET /requests/:id ────────────────────────────────────────────────────
// ── GET /requests/mine (hospital) ────────────────────────────────────────
// Returns all requests raised by the authenticated hospital, newest first.
// Declared BEFORE GET /:id so Express doesn't bind 'mine' to the :id param.
// Used by the hospital portal to show active + recent requests with status,
// matched-BB, coordinator name, and a confirm-crossmatch CTA when the request
// reaches FU/PF without crossmatch_confirmed yet.
router.get('/mine', verifyJWT, requireRole('hospital'), async (req, res) => {
  if (!req.user.institutionId) {
    return res.status(403).json({ error: 'hospital_user_missing_institution' });
  }
  const r = await withRlsContext(req, (c) =>
    c.query(
      `SELECT br.id, br.request_number, br.source_tier, br.urgency_tier,
              br.units_required, br.units_fulfilled, br.status,
              br.patient_blood_group_id, bg.code AS blood_group_code,
              br.component_id, bc.code AS component_code,
              br.needed_by, br.raised_at, br.fulfilled_at,
              br.crossmatch_confirmed, br.crossmatch_confirmed_at,
              br.matched_blood_bank_id, mi.display_name AS matched_blood_bank_name,
              ra.coordinator_id, co.display_name AS coordinator_name
         FROM blood_requests br
    LEFT JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
    LEFT JOIN blood_components bc ON bc.id = br.component_id
    LEFT JOIN institutions mi ON mi.id = br.matched_blood_bank_id
    LEFT JOIN request_assignments ra ON ra.request_id = br.id AND ra.is_current = TRUE
    LEFT JOIN coordinators co ON co.id = ra.coordinator_id
        WHERE br.requesting_institution_id = $1
     ORDER BY br.raised_at DESC
        LIMIT 200`,
      [req.user.institutionId],
    ),
  );
  res.json({ requests: r.rows, count: r.rowCount });
});

router.get('/:id', verifyJWT, async (req, res) => {
  const r = await withRlsContext(req, (c) =>
    c.query(
      `SELECT br.*, ra.coordinator_id, ra.coordinator_accepted_at,
              c.display_name AS coordinator_name
         FROM blood_requests br
    LEFT JOIN request_assignments ra ON ra.request_id = br.id AND ra.is_current = TRUE
    LEFT JOIN coordinators c ON c.id = ra.coordinator_id
        WHERE br.id = $1
        LIMIT 1`,
      [req.params.id],
    ),
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found_or_no_access' });
  res.json(r.rows[0]);
});

// ── POST /requests/:id/match ─────────────────────────────────────────────
router.post(
  '/:id/match',
  verifyJWT,
  requireRole('coordinator', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    try {
      const result = await withRlsContext(
        req,
        async (c) => {
          const reqR = await c.query(
            `SELECT id, status, source_tier, urgency_tier, donor_activation_required,
                  requesting_hospital_district_id, component_id, patient_blood_group_id,
                  units_required, units_fulfilled, coordinator_verified_at
             FROM blood_requests WHERE id = $1`,
            [req.params.id],
          );
          if (reqR.rowCount === 0) {
            throw Object.assign(new Error('request_not_found'), { status: 404 });
          }
          const request = reqR.rows[0];
          if (['CR', 'CI'].includes(request.source_tier) && !request.coordinator_verified_at) {
            throw Object.assign(new Error('awaiting_coordinator_verification'), { status: 409 });
          }
          return runMatch(c, { request, actorUserId: req.user.userId });
        },
        { change_reason: 'manual match re-trigger' },
      );
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  },
);

// ── POST /requests/:id/cancel ────────────────────────────────────────────
router.post('/:id/cancel', verifyJWT, async (req, res) => {
  const schema = z.object({ reason: z.string().min(5) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const result = await withRlsContext(
    req,
    async (c) => {
      const r = await c.query(
        `UPDATE blood_requests
            SET status = 'CA', cancelled_at = clock_timestamp(),
                cancellation_reason = $2
          WHERE id = $1 AND status NOT IN ('FU','CL','CA','EX','RE')
       RETURNING id, status`,
        [req.params.id, parsed.data.reason],
      );
      // Also release any reservations.
      await c.query(
        `UPDATE blood_inventory
            SET status = 'AV',
                reserved_for_request_id = NULL,
                reserved_at = NULL,
                status_changed_by = $2
          WHERE reserved_for_request_id = $1 AND status = 'RE'`,
        [req.params.id, req.user.userId],
      );
      return r.rowCount === 0 ? null : r.rows[0];
    },
    { change_reason: `cancel: ${parsed.data.reason}` },
  );
  if (!result) return res.status(404).json({ error: 'not_found_or_terminal' });
  res.json(result);
});

// ── POST /requests/:id/confirm-crossmatch (hospital) ─────────────────────
// Spec §7 hospital-side close: hospital marks transfusion as confirmed.
// Sets crossmatch_confirmed=TRUE; if the request is FU it also flips status
// to CL (closed). Bag-state changes (TR transfused) stay with the BB/coord
// flow — this endpoint is purely the hospital's own confirmation step.
router.post('/:id/confirm-crossmatch', verifyJWT, requireRole('hospital'), async (req, res) => {
  const result = await withRlsContext(
    req,
    async (c) => {
      const r = await c.query(
        `UPDATE blood_requests
              SET crossmatch_confirmed = TRUE,
                  crossmatch_confirmed_at = clock_timestamp(),
                  status = CASE WHEN status = 'FU' THEN 'CL' ELSE status END,
                  closed_at = CASE WHEN status = 'FU' THEN clock_timestamp() ELSE closed_at END
            WHERE id = $1
              AND requesting_institution_id = $2
              AND status IN ('FU','PF','MT','AS')
         RETURNING id, status, crossmatch_confirmed, crossmatch_confirmed_at`,
        [req.params.id, req.user.institutionId],
      );
      if (r.rowCount === 0) {
        throw Object.assign(new Error('not_found_or_wrong_state'), { status: 409 });
      }
      return r.rows[0];
    },
    { change_reason: 'hospital confirms crossmatch' },
  );
  res.json(result);
});

module.exports = router;
