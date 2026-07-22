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
const { seal } = require('../services/pii');
const { runMatch } = require('../services/matching');
const { fulfilIfAllTransfused } = require('../services/requests/fulfilment');
const { recordHospitalReferral } = require('../services/requests/referral');

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

// Tier 4 (citizen). A donor raises on a patient's behalf and EITHER picks an
// onboarded hospital (requesting_institution_id) OR names one that isn't on
// Raktify (guest_hospital_name). Exactly one of the two is required.
const tier4Schema = z
  .object({
    ...baseRequestSchema,
    ward_or_bed: z.string().min(1),
    requesting_hospital_district_id: z.number().int().positive(),
    urgency_tier: z.enum(['PL', 'UR']),
    requesting_institution_id: z.string().uuid().optional(),
    guest_hospital_name: z.string().min(2).optional(),
    guest_hospital_address: z.string().optional(),
  })
  .refine((d) => Boolean(d.requesting_institution_id) !== Boolean(d.guest_hospital_name), {
    message: 'Provide exactly one of requesting_institution_id or guest_hospital_name',
    path: ['requesting_institution_id'],
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
        donor_activation_required,
        citizen_raised, hospital_confirmation_status, referral_id)
     VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7, $8,
        $9, $10, $11,
        $12, $13,
        $14, $15, $16, $17,
        $18, $19,
        $20,
        $21,
        $22, $23, $24)
     RETURNING id, request_number, status, urgency_tier, source_tier,
               donor_activation_required, requesting_hospital_district_id,
               component_id, patient_blood_group_id, units_required, units_fulfilled,
               citizen_raised, hospital_confirmation_status`,
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
      seal(opts.clinical_indication || null), // patient health data (main key)
      opts.ward_or_bed || null,
      opts.requesting_hospital_district_id,
      opts.donor_activation_required,
      opts.citizen_raised || false,
      opts.hospital_confirmation_status || null,
      opts.referral_id || null,
    ],
  );
  return r.rows[0];
}

async function autoAssignCoordinator(client, request) {
  // Pick the on-duty district lead for this district, or any on-duty coordinator.
  // Pull mobile so we can WhatsApp them for CRITICAL requests below.
  const r = await client.query(
    `SELECT c.id, u.mobile
       FROM coordinators c
       JOIN platform_users u ON u.id = c.platform_user_id
      WHERE c.district_id = $1 AND c.is_active = TRUE AND c.on_duty = TRUE
   ORDER BY c.is_district_lead DESC, c.reliability_score DESC, c.joined_at ASC
      LIMIT 1`,
    [request.requesting_hospital_district_id],
  );
  if (r.rowCount === 0) return null;
  const coordinatorId = r.rows[0].id;
  const coordinatorMobile = r.rows[0].mobile;

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

  // For CRITICAL-urgency requests, WhatsApp the assigned coordinator so they
  // can hand-place inventory or override the matcher before it fires alerts.
  // Fire-and-forget — a failed WA send doesn't roll back the assignment.
  if (request.urgency_tier === 'CR' && coordinatorMobile) {
    fireCoordCriticalNew({ client, request, coordinatorId, coordinatorMobile }).catch((err) => {
      require('../config/logger').error(
        { err: err.message, request_id: request.id, coordinator_id: coordinatorId },
        'coord_critical_new dispatch failed',
      );
    });
  }
  return ins.rows[0];
}

// WhatsApp the assigned coordinator when a new CRITICAL request lands in their
// district. Runs after the request_assignments INSERT commits. Uses the
// `system` actor for the notification-log insert (already elevated inside the
// chokepoint), and the request context passed in avoids a re-query.
async function fireCoordCriticalNew({
  client,
  request,
  coordinatorId: _coordId,
  coordinatorMobile,
}) {
  // Enrich the request with human-readable context — district name, blood
  // group, component, requesting facility.
  const ctx = (
    await client.query(
      `SELECT br.request_number, br.units_required,
              bg.code AS blood_group, bc.code AS component,
              d.name AS district_name,
              COALESCE(rh.display_name, br.guest_hospital_name) AS facility_name,
              br.needed_by
         FROM blood_requests br
         JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
         JOIN blood_components bc ON bc.id = br.component_id
    LEFT JOIN districts d ON d.id = br.requesting_hospital_district_id
    LEFT JOIN institutions rh ON rh.id = br.requesting_institution_id
        WHERE br.id = $1`,
      [request.id],
    )
  ).rows[0];
  if (!ctx) return;

  const requestSummary = `${ctx.units_required} unit${ctx.units_required === 1 ? '' : 's'} ${ctx.blood_group} ${ctx.component}`;
  const neededBy = ctx.needed_by
    ? new Date(ctx.needed_by).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'as soon as possible';

  const { sendNotification } = require('../services/notifications');
  await sendNotification({
    recipientId: coordinatorMobile,
    templateType: 'COORD_CRITICAL_NEW',
    variables: {
      district: ctx.district_name || '',
      request_summary: requestSummary,
      needed_by: neededBy,
      facility_name: ctx.facility_name || 'requesting facility',
      request_id: request.id,
    },
    channel: 'WA',
    language: 'en',
    relatedRequestId: request.id,
  });
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
// Donor raises a request on a patient's behalf. Two paths:
//   • ONBOARDED hospital picked  → tied to that hospital, hospital_confirmation
//     _status='PE'; the hospital confirms the clinical need (POST
//     /:id/hospital-confirm) which then runs the matcher. The hospital is the
//     clinical authority, so no separate coordinator-verify gate.
//   • NAMED (un-onboarded) hospital → guest_hospital_name + an
//     institution_referrals onboarding lead; keeps the coordinator-verify gate.
// Max urgency UR (a citizen can't declare CRITICAL).
router.post('/citizen', verifyJWT, requireRole('donor'), async (req, res) => {
  const parsed = tier4Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  const data = parsed.data;

  const result = await withRlsContext(
    req,
    async (c) => {
      // A citizen request is raised by a REGISTERED donor — an identifiable,
      // accountable person (also the referrer of any onboarding lead, which is
      // NOT NULL). A thin OTP-only mobile with no donor profile must register
      // first. requesting_user_id (platform_users) still records who raised it.
      const donorRow = await c.query(`SELECT id FROM donors WHERE platform_user_id = $1`, [
        req.user.userId,
      ]);
      const donorId = donorRow.rows[0]?.id;
      if (!donorId) {
        throw Object.assign(new Error('donor_profile_required'), { status: 403 });
      }

      if (data.requesting_institution_id) {
        // Verify the picked hospital is actually an onboarded, active hospital.
        const hosp = (
          await c.query(
            `SELECT id FROM institutions
              WHERE id = $1 AND kind = 'HO' AND onboarding_status = 'AC' AND is_active = TRUE`,
            [data.requesting_institution_id],
          )
        ).rows[0];
        if (!hosp) throw Object.assign(new Error('hospital_not_onboarded'), { status: 400 });

        const created = await insertRequest(c, {
          ...data,
          source_tier: 'CI',
          requesting_institution_id: data.requesting_institution_id,
          guest_hospital_name: null,
          requesting_user_id: req.user.userId,
          donor_activation_required: false, // nothing fires until the hospital confirms
          citizen_raised: true,
          hospital_confirmation_status: 'PE',
        });
        const assignment = await autoAssignCoordinator(c, created);
        return {
          request: created,
          assignment,
          match: null,
          awaiting_hospital_confirmation: true,
        };
      }

      // Named (un-onboarded) hospital → onboarding lead + coordinator-verify gate.
      const referralId = await recordHospitalReferral(c, {
        name: data.guest_hospital_name,
        districtId: data.requesting_hospital_district_id,
        address: data.guest_hospital_address,
        donorId,
      });
      const created = await insertRequest(c, {
        ...data,
        source_tier: 'CI',
        requesting_institution_id: null,
        requesting_user_id: req.user.userId,
        donor_activation_required: false, // gated until coordinator verify
        citizen_raised: true,
        referral_id: referralId,
      });
      const assignment = await autoAssignCoordinator(c, created);
      return {
        request: created,
        assignment,
        match: null,
        awaiting_verification: true,
        referral_id: referralId,
      };
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

// ── GET /requests/dashboard (hospital) ───────────────────────────────────
// Aggregate overview for the hospital portal: KPIs (open / critical / fulfilled
// / avg time-to-fulfilment), district blood availability snapshot, recent
// closed/expired activity. Declared BEFORE GET /:id so Express doesn't bind
// 'dashboard' to the :id param.
router.get('/dashboard', verifyJWT, requireRole('hospital'), async (req, res) => {
  const hospId = req.user.institutionId;
  if (!hospId) return res.status(403).json({ error: 'hospital_user_missing_institution' });

  const data = await withRlsContext(req, async (c) => {
    const kpis = (
      await c.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('OP','MT','AS','PF'))::int       AS open_count,
           COUNT(*) FILTER (WHERE status IN ('OP','MT','AS','PF')
                            AND urgency_tier = 'CR')::int                     AS critical_now,
           COUNT(*) FILTER (WHERE status = 'CL'
                            AND closed_at >= date_trunc('month', NOW()))::int AS fulfilled_this_month,
           COUNT(*) FILTER (WHERE status = 'EX'
                            AND raised_at >= date_trunc('month', NOW()))::int AS expired_this_month,
           AVG(EXTRACT(EPOCH FROM (fulfilled_at - raised_at)))::int           AS avg_fulfilment_seconds
         FROM blood_requests
         WHERE requesting_institution_id = $1
           AND raised_at >= NOW() - INTERVAL '90 days'`,
        [hospId],
      )
    ).rows[0];

    const dist = (await c.query(`SELECT district_id FROM institutions WHERE id = $1`, [hospId]))
      .rows[0]?.district_id;

    const availability = dist
      ? (
          await c.query(
            `SELECT bg.code AS blood_group, bc.code AS component,
                    COUNT(*)::int AS available_units,
                    MIN(bi.expiry_date) AS earliest_expiry
               FROM blood_inventory bi
               JOIN institutions i ON i.id = bi.blood_bank_id
               JOIN blood_groups bg ON bg.id = bi.blood_group_id
               JOIN blood_components bc ON bc.id = bi.component_id
              WHERE i.district_id = $1
                AND bi.status = 'AV'
                AND bi.is_recalled = FALSE
                AND bi.expiry_date > CURRENT_DATE
              GROUP BY bg.code, bc.code
              ORDER BY bg.code, bc.code`,
            [dist],
          )
        ).rows
      : [];

    const recent = (
      await c.query(
        `SELECT br.id, br.request_number, br.status, br.urgency_tier,
                br.units_required, br.units_fulfilled,
                bg.code AS blood_group, bc.code AS component,
                br.raised_at, br.closed_at, br.crossmatch_confirmed
           FROM blood_requests br
           JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
           JOIN blood_components bc ON bc.id = br.component_id
          WHERE br.requesting_institution_id = $1
            AND br.status IN ('CL','FU','EX','CA')
       ORDER BY COALESCE(br.closed_at, br.fulfilled_at, br.raised_at) DESC
          LIMIT 8`,
        [hospId],
      )
    ).rows;

    return {
      district_id: dist || null,
      kpis,
      district_availability: availability,
      recent_activity: recent,
    };
  });

  res.json(data);
});

// ── GET /requests/unread-threads ─────────────────────────────────────────
// Per-request unread counts for the caller (messages they did NOT author,
// posted after their last-read marker), across every case they can see. RLS
// scopes request_threads + request_thread_reads. Declared BEFORE GET /:id so
// Express doesn't bind 'unread-threads' to the :id param.
router.get(
  '/unread-threads',
  verifyJWT,
  requireRole(
    'hospital',
    'blood_bank',
    'coordinator',
    'community_leader',
    'ngo_admin',
    'super_admin',
  ),
  async (req, res) => {
    const isAdmin = ['ngo_admin', 'super_admin'].includes(req.user.role);
    const seesEveryCase = isAdmin || req.user.role === 'coordinator';
    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT t.request_id, COUNT(*)::int AS unread
           FROM request_threads t
           JOIN blood_requests br ON br.id = t.request_id
      LEFT JOIN request_thread_reads rr
             ON rr.request_id = t.request_id AND rr.user_id = $1
          WHERE t.is_deleted = FALSE
            AND t.author_user_id IS DISTINCT FROM $1
            AND (rr.last_read_at IS NULL OR t.posted_at > rr.last_read_at)
            AND ($2 = ANY(t.visible_to_roles) OR $4::boolean)
            AND (
                 $5::boolean
              OR ($2 = 'hospital'         AND br.requesting_institution_id = $3)
              OR ($2 = 'blood_bank'       AND br.matched_blood_bank_id     = $3)
              OR ($2 = 'community_leader' AND fn_actor_leads_community(br.attributed_community_id))
            )
       GROUP BY t.request_id`,
        [req.user.userId, req.user.role, req.user.institutionId || null, isAdmin, seesEveryCase],
      ),
    );
    res.json({ unread: r.rows });
  },
);

// ── GET /requests/hospital-options ───────────────────────────────────────
// Powers the citizen raise-request hospital picker: onboarded, active
// hospitals only, name + district — never any PII. Optional ?q= and
// ?district_id= filters. Declared before /:id so Express doesn't bind the path
// segment to the :id param.
router.get('/hospital-options', verifyJWT, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const districtId = req.query.district_id ? Number(req.query.district_id) : null;
  const rows = await withRlsContext(req, (c) =>
    c.query(
      `SELECT i.id, i.display_name, i.district_id, d.name AS district_name
         FROM institutions i
    LEFT JOIN districts d ON d.id = i.district_id
        WHERE i.kind = 'HO'
          AND i.onboarding_status = 'AC'
          AND i.is_active = TRUE
          AND ($1::int IS NULL OR i.district_id = $1)
          AND ($2 = '' OR i.display_name ILIKE '%' || $2 || '%')
     ORDER BY i.display_name
        LIMIT 25`,
      [districtId, q],
    ),
  );
  res.json({ hospitals: rows.rows });
});

// ── GET /requests/awaiting-confirmation (hospital) ───────────────────────
// Citizen-raised requests that NAMED this hospital and await its confirmation
// of the clinical need. Declared before /:id.
router.get('/awaiting-confirmation', verifyJWT, requireRole('hospital'), async (req, res) => {
  if (!req.user.institutionId) {
    return res.status(403).json({ error: 'hospital_user_missing_institution' });
  }
  const rows = await withRlsContext(req, (c) =>
    c.query(
      `SELECT br.id, br.request_number, br.urgency_tier, br.units_required,
              bg.code AS blood_group, bc.code AS component,
              br.patient_initials, br.patient_age, br.patient_gender,
              br.ward_or_bed, br.needed_by, br.raised_at
         FROM blood_requests br
         JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
         JOIN blood_components bc ON bc.id = br.component_id
        WHERE br.requesting_institution_id = $1
          AND br.hospital_confirmation_status = 'PE'
     ORDER BY br.raised_at DESC
        LIMIT 50`,
      [req.user.institutionId],
    ),
  );
  res.json({ requests: rows.rows, count: rows.rows.length });
});

router.get('/:id', verifyJWT, async (req, res) => {
  // community_leader can now SELECT its attributed requests (migration 300), but
  // must NEVER receive patient PII (patient_initials/age/gender, clinical_indication,
  // ward_or_bed, guest_* fields). Return an explicit non-PII column list for them —
  // the API-layer boundary from migration 281. Two static queries (no interpolation)
  // keep the no-dynamic-SQL lint rule satisfied.
  const isLeader = req.user.role === 'community_leader';
  const r = await withRlsContext(req, (c) =>
    isLeader
      ? c.query(
          `SELECT br.id, br.patient_blood_group_id, br.component_id, br.units_required,
                  br.units_fulfilled, br.urgency_tier, br.status, br.needed_by,
                  br.requesting_hospital_district_id, br.attributed_community_id, br.raised_at
             FROM blood_requests br
            WHERE br.id = $1
            LIMIT 1`,
          [req.params.id],
        )
      : c.query(
          `SELECT br.*, ra.coordinator_id, ra.coordinator_accepted_at,
                  c.display_name AS coordinator_name,
                  cc.units_reserved, cc.units_issued, cc.units_received, cc.units_transfused
             FROM blood_requests br
        LEFT JOIN request_assignments ra ON ra.request_id = br.id AND ra.is_current = TRUE
        LEFT JOIN coordinators c ON c.id = ra.coordinator_id
        LEFT JOIN LATERAL (
                  -- per-bag custody breakdown, drives the issue/receive/transfuse
                  -- actions on the case detail pages (migration 301 chain)
                  SELECT COUNT(*) FILTER (WHERE bi.status = 'RE')::int AS units_reserved,
                         COUNT(*) FILTER (WHERE bi.status = 'IS')::int AS units_issued,
                         COUNT(*) FILTER (WHERE bi.status = 'RV')::int AS units_received,
                         COUNT(*) FILTER (WHERE bi.status = 'TR')::int AS units_transfused
                    FROM blood_inventory bi
                   WHERE COALESCE(bi.reserved_for_request_id, bi.fulfilled_request_id) = br.id
                ) cc ON TRUE
            WHERE br.id = $1
            LIMIT 1`,
          [req.params.id],
        ),
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found_or_no_access' });
  res.json(r.rows[0]);
});

// ── Case-thread party check ──────────────────────────────────────────────
// RLS (migrations 299 + 300) is the DESIGNED backstop for thread scoping, but it
// is currently INERT at runtime: the app connects as a role holding BYPASSRLS,
// and `app_user` — the role every policy targets — cannot log in. Until that is
// fixed at the infrastructure level, thread access MUST be enforced here too, or
// one institution can read/post on another's case.
//
// This mirrors blood_requests' `req_actors` policy plus migration 300's
// community-leader rule, so behaviour is identical once RLS is live again.
async function isRequestParty(c, user, requestId) {
  const r = await c.query(
    `SELECT requesting_institution_id, matched_blood_bank_id, attributed_community_id
       FROM blood_requests
      WHERE id = $1`,
    [requestId],
  );
  if (r.rowCount === 0) return false;
  const row = r.rows[0];

  if (['coordinator', 'ngo_admin', 'super_admin'].includes(user.role)) return true;
  if (user.role === 'hospital') {
    return Boolean(user.institutionId) && row.requesting_institution_id === user.institutionId;
  }
  if (user.role === 'blood_bank') {
    return Boolean(user.institutionId) && row.matched_blood_bank_id === user.institutionId;
  }
  if (user.role === 'community_leader') {
    if (!row.attributed_community_id) return false;
    const q = await c.query(`SELECT fn_actor_leads_community($1) AS ok`, [
      row.attributed_community_id,
    ]);
    return q.rows[0]?.ok === true;
  }
  return false;
}

// ── GET /requests/:id/thread ─────────────────────────────────────────────
// Per-request case chat, shared by every staff party to the request (hospital,
// blood_bank, coordinator, admins). RLS (thr_read, migration 299) scopes rows to
// requests the caller is a party to + visible_to_roles — so no extra ownership
// check is needed here. Donor comms stay on the mediated DH relay; donors are
// not thread participants.
router.get(
  '/:id/thread',
  verifyJWT,
  requireRole(
    'hospital',
    'blood_bank',
    'coordinator',
    'community_leader',
    'ngo_admin',
    'super_admin',
  ),
  async (req, res) => {
    const isAdmin = ['ngo_admin', 'super_admin'].includes(req.user.role);
    const rows = await withRlsContext(req, async (c) => {
      if (!(await isRequestParty(c, req.user, req.params.id))) return null;
      const r = await c.query(
        `SELECT id, message_type, message_text, author_user_id, author_role,
                posted_at, edited_at, visible_to_roles
           FROM request_threads
          WHERE request_id = $1
            AND is_deleted = FALSE
            AND ($2 = ANY(visible_to_roles) OR $3::boolean)
       ORDER BY posted_at ASC
          LIMIT 500`,
        [req.params.id, req.user.role, isAdmin],
      );
      return r.rows;
    });
    if (rows === null) return res.status(404).json({ error: 'not_found_or_no_access' });
    res.json({ messages: rows, count: rows.length });
  },
);

// ── POST /requests/:id/thread ────────────────────────────────────────────
// Append a message to the case chat. message_type is derived from the caller's
// role (author_role also records the sender). RLS (thr_write, migration 299)
// rejects a post to a request the caller is not a party to → 403.
const threadPostSchema = z.object({
  message_text: z.string().min(1).max(4000),
  visible_to_roles: z
    .array(
      z.enum([
        'coordinator',
        'hospital',
        'blood_bank',
        'community_leader',
        'ngo_admin',
        'super_admin',
      ]),
    )
    .optional(),
});
const THREAD_TYPE_BY_ROLE = {
  hospital: 'HO',
  blood_bank: 'BB',
  coordinator: 'CO',
  community_leader: 'CL',
  ngo_admin: 'CO',
  super_admin: 'CO',
};
router.post(
  '/:id/thread',
  verifyJWT,
  requireRole(
    'hospital',
    'blood_bank',
    'coordinator',
    'community_leader',
    'ngo_admin',
    'super_admin',
  ),
  async (req, res) => {
    const parsed = threadPostSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
    try {
      const result = await withRlsContext(
        req,
        async (c) => {
          if (!(await isRequestParty(c, req.user, req.params.id))) return null;
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
              THREAD_TYPE_BY_ROLE[req.user.role] || 'CO',
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
      if (result === null) {
        return res.status(403).json({ error: 'not_a_party_to_request' });
      }
      res.status(201).json(result);
    } catch (e) {
      // RLS WITH CHECK (thr_write) rejects a post to a request the caller isn't
      // a party to; surface a clean 403 instead of a 500.
      if (e && e.code === '42501') {
        return res.status(403).json({ error: 'not_a_party_to_request' });
      }
      throw e;
    }
  },
);

// ── POST /requests/:id/thread/read ───────────────────────────────────────
// Mark the caller's thread as read up to now (upsert their last-read marker).
// Powers the in-app unread badges via GET /requests/unread-threads.
router.post(
  '/:id/thread/read',
  verifyJWT,
  requireRole(
    'hospital',
    'blood_bank',
    'coordinator',
    'community_leader',
    'ngo_admin',
    'super_admin',
  ),
  async (req, res) => {
    const ok = await withRlsContext(req, async (c) => {
      if (!(await isRequestParty(c, req.user, req.params.id))) return false;
      await c.query(
        `INSERT INTO request_thread_reads (user_id, request_id, last_read_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id, request_id) DO UPDATE SET last_read_at = now()`,
        [req.user.userId, req.params.id],
      );
      return true;
    });
    if (!ok) return res.status(403).json({ error: 'not_a_party_to_request' });
    res.status(204).end();
  },
);

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

// ── POST /requests/:id/confirm-transfused (hospital) ─────────────────────
// The hospital transfused the unit(s) into the patient — the terminal clinical
// event. Bags IS or RV → TR (non-blocking: an onboarded hospital does not have
// to wait for the coordinator's receipt confirmation; transfusion implies
// receipt). When every committed bag is transfused and the need is met, the
// request auto-flips to FU. Scoped to bags issued to THIS hospital.
router.post('/:id/confirm-transfused', verifyJWT, requireRole('hospital'), async (req, res) => {
  const schema = z.object({ bag_ids: z.array(z.string().uuid()).min(1).max(50).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const result = await withRlsContext(
    req,
    async (c) => {
      const bagIds = parsed.data.bag_ids ?? null;
      const r = await c.query(
        `UPDATE blood_inventory
            SET status = 'TR',
                status_changed_by = $3
          WHERE fulfilled_request_id = $1
            AND issued_to_institution_id = $2
            AND status IN ('IS','RV')
            AND ($4::uuid[] IS NULL OR id = ANY($4))`,
        [req.params.id, req.user.institutionId, req.user.userId, bagIds],
      );
      if (r.rowCount === 0) {
        throw Object.assign(new Error('no_bags_to_transfuse'), { status: 409 });
      }
      const { fulfilled } = await fulfilIfAllTransfused(c, req.params.id);
      return {
        request_id: req.params.id,
        units_transfused: r.rowCount,
        request_fulfilled: fulfilled,
      };
    },
    { change_reason: 'hospital confirms transfusion' },
  );
  res.json(result);
});

// ── POST /requests/:id/hospital-confirm (hospital) ───────────────────────
// The hospital confirms a citizen-raised request naming it: the clinical need
// is real and it takes ownership. This clears the PE gate and runs the matcher
// exactly like a hospital-raised request (donor activation per urgency).
router.post('/:id/hospital-confirm', verifyJWT, requireRole('hospital'), async (req, res) => {
  const result = await withRlsContext(
    req,
    async (c) => {
      const request = (
        await c.query(
          `SELECT id, status, source_tier, urgency_tier, requesting_hospital_district_id,
                  component_id, patient_blood_group_id, units_required, units_fulfilled,
                  hospital_confirmation_status
             FROM blood_requests
            WHERE id = $1 AND requesting_institution_id = $2`,
          [req.params.id, req.user.institutionId],
        )
      ).rows[0];
      if (!request) throw Object.assign(new Error('not_found_or_no_access'), { status: 404 });
      if (request.hospital_confirmation_status !== 'PE') {
        throw Object.assign(new Error('not_pending_confirmation'), { status: 409 });
      }

      const donorActivation = request.urgency_tier !== 'PL';
      await c.query(
        `UPDATE blood_requests
            SET hospital_confirmation_status = 'OK',
                hospital_confirmed_at = clock_timestamp(),
                hospital_confirmed_by = $2,
                donor_activation_required = $3
          WHERE id = $1`,
        [request.id, req.user.userId, donorActivation],
      );

      // Now a normal hospital request — run the matcher (elevated inside runMatch).
      request.donor_activation_required = donorActivation;
      const match = await runMatch(c, { request, actorUserId: req.user.userId });
      return { request_id: request.id, confirmed: true, match };
    },
    { change_reason: 'hospital confirms citizen-raised request' },
  );
  res.json(result);
});

// ── POST /requests/:id/hospital-reject (hospital) ────────────────────────
// The hospital declines a citizen-raised request naming it (not a real need /
// not our patient). Cancels the request.
router.post('/:id/hospital-reject', verifyJWT, requireRole('hospital'), async (req, res) => {
  const parsed = z
    .object({ reason: z.string().trim().max(500).optional() })
    .safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const result = await withRlsContext(
    req,
    async (c) => {
      const r = await c.query(
        `UPDATE blood_requests
            SET hospital_confirmation_status = 'RJ',
                hospital_confirmed_at = clock_timestamp(),
                hospital_confirmed_by = $2,
                status = 'CA'
          WHERE id = $1 AND requesting_institution_id = $3
            AND hospital_confirmation_status = 'PE'
        RETURNING id`,
        [req.params.id, req.user.userId, req.user.institutionId],
      );
      if (r.rowCount === 0) {
        throw Object.assign(new Error('not_pending_confirmation'), { status: 409 });
      }
      return { request_id: req.params.id, rejected: true };
    },
    { change_reason: 'hospital rejects citizen-raised request' },
  );
  res.json(result);
});

module.exports = router;
