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
const { triggerNow, holdAlert } = require('../services/donor-alert-gate');

const router = express.Router();

// ── GET /coordinator/dashboard ───────────────────────────────────────────
// Aggregate landing for the coordinator portal: queue KPIs (open / critical
// / accepted-by-me), personal impact metrics from `coordinators`, district
// donor pool, and a snapshot of blood availability in the district.
router.get(
  '/dashboard',
  verifyJWT,
  requireRole('coordinator', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const isCoord = req.user.role === 'coordinator';

    const data = await withRlsContext(req, async (c) => {
      let districtId = null;
      let coord = null;
      if (isCoord) {
        const cr = await c.query(
          `SELECT id, district_id, on_duty, on_duty_until,
                  donations_facilitated, requests_fulfilled,
                  community_donor_count, lives_saved_estimate,
                  median_response_time_min, reliability_score, is_district_lead
             FROM coordinators
            WHERE platform_user_id = $1`,
          [req.user.userId],
        );
        if (cr.rowCount === 0) {
          throw Object.assign(new Error('coordinator_profile_not_found'), { status: 404 });
        }
        coord = cr.rows[0];
        districtId = coord.district_id;
      }

      // Queue KPIs (district-scoped for coord, global for ngo_admin/super_admin)
      const queueRow = (
        await c.query(
          `SELECT
             COUNT(*) FILTER (WHERE br.status IN ('OP','MT','AS','PF'))::int               AS open_count,
             COUNT(*) FILTER (WHERE br.status IN ('OP','MT','AS','PF')
                              AND br.urgency_tier = 'CR')::int                              AS critical_now,
             COUNT(*) FILTER (WHERE br.status IN ('OP','MT','AS','PF')
                              AND ra.coordinator_accepted_at IS NOT NULL
                              AND ra.coordinator_id = $2)::int                              AS accepted_by_me,
             COUNT(*) FILTER (WHERE br.status IN ('OP','MT','AS','PF')
                              AND ra.coordinator_accepted_at IS NULL)::int                  AS awaiting_accept,
             COUNT(*) FILTER (WHERE br.status = 'CL'
                              AND br.closed_at >= date_trunc('month', NOW()))::int          AS closed_this_month
           FROM blood_requests br
      LEFT JOIN request_assignments ra
             ON ra.request_id = br.id AND ra.is_current = TRUE
          WHERE ($1::int IS NULL OR br.requesting_hospital_district_id = $1)`,
          [districtId, coord?.id || null],
        )
      ).rows[0];

      const districtDonors = districtId
        ? (
            await c.query(
              `SELECT COUNT(*)::int AS verified,
                      COUNT(*) FILTER (WHERE d.deferral_status = 'OK')::int AS available
                 FROM donors d
                 JOIN villages v ON v.id = d.village_id
                WHERE v.district_id = $1
                  AND d.is_active = TRUE
                  AND d.blood_group_verified IS NOT NULL`,
              [districtId],
            )
          ).rows[0]
        : { verified: 0, available: 0 };

      const availability = districtId
        ? (
            await c.query(
              `SELECT bg.code AS blood_group, bc.code AS component,
                      COUNT(*)::int AS available_units
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
              [districtId],
            )
          ).rows
        : [];

      // Most-critical 5 open in district (already covered in /requests, but
      // a short preview here saves a click for the common case).
      const topOpen = (
        await c.query(
          `SELECT br.id, br.request_number, br.urgency_tier, br.status,
                  bg.code AS blood_group, bc.code AS component,
                  br.units_required, br.units_fulfilled,
                  br.needed_by, br.raised_at,
                  EXTRACT(EPOCH FROM (NOW() - br.raised_at))::int AS seconds_since_raised
             FROM blood_requests br
             JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
             JOIN blood_components bc ON bc.id = br.component_id
            WHERE br.status IN ('OP','MT','AS','PF')
              AND ($1::int IS NULL OR br.requesting_hospital_district_id = $1)
         ORDER BY CASE br.urgency_tier WHEN 'CR' THEN 0 WHEN 'UR' THEN 1 ELSE 2 END,
                  br.raised_at ASC
            LIMIT 5`,
          [districtId],
        )
      ).rows;

      return {
        scope_district_id: districtId,
        is_district_lead: coord?.is_district_lead || false,
        on_duty: coord?.on_duty || false,
        on_duty_until: coord?.on_duty_until || null,
        kpis: {
          ...queueRow,
          donations_facilitated: coord?.donations_facilitated ?? null,
          requests_fulfilled: coord?.requests_fulfilled ?? null,
          community_donor_count: coord?.community_donor_count ?? null,
          lives_saved_estimate: coord?.lives_saved_estimate ?? null,
          median_response_time_min: coord?.median_response_time_min ?? null,
          reliability_score: coord?.reliability_score ?? null,
        },
        district_donors: districtDonors,
        district_availability: availability,
        top_open_requests: topOpen,
      };
    });

    res.json(data);
  },
);

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

// ── GET /coordinator/requests/:id/gate-status ────────────────────────────
// Live snapshot of the donor-alert-gate + BB decision matrix for a request.
// Fuels the coordinator queue panel:
//   - Which BBs offered / declined / are still silent (in-district scope)
//   - The pending donor-alert row: scheduled_fire_at, hold state, source
//   - Donor alerts already fired (count + last-fired timestamp)
// Powers the "Alert donors NOW" / "Hold donor alerts" override buttons.
router.get(
  '/requests/:id/gate-status',
  verifyJWT,
  requireRole('coordinator', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const requestId = req.params.id;

    const result = await withRlsContext(req, async (c) => {
      const request = (
        await c.query(
          `SELECT id, urgency_tier, status,
                  requesting_hospital_district_id,
                  component_id, patient_blood_group_id,
                  units_required
             FROM blood_requests WHERE id = $1`,
          [requestId],
        )
      ).rows[0];
      if (!request) {
        throw Object.assign(new Error('request_not_found'), { status: 404 });
      }

      // Eligible BBs = in-district + have compatible AV stock. Each row
      // shows their offer (bags reserved for this request), decline (open
      // decline row), or silence.
      const bbs = (
        await c.query(
          `WITH eligible AS (
             SELECT DISTINCT i.id AS bb_id, i.display_name
               FROM blood_inventory bi
               JOIN institutions i ON i.id = bi.blood_bank_id
               JOIN compatibility_matrix cm
                 ON cm.component_id = bi.component_id
                AND cm.donor_group_id = bi.blood_group_id
                AND cm.recipient_group_id = $2
                AND cm.is_compatible = TRUE
              WHERE i.district_id = $1
                AND bi.component_id = $3
           ),
           offers AS (
             SELECT blood_bank_id, COUNT(*)::int AS units_offered
               FROM blood_inventory
              WHERE reserved_for_request_id = $4
                AND status IN ('RE','IS','TR')
              GROUP BY blood_bank_id
           ),
           declines AS (
             SELECT blood_bank_id, reason, expires_at
               FROM open_request_bb_declines
              WHERE request_id = $4 AND expires_at > NOW()
           )
           SELECT e.bb_id,
                  e.display_name,
                  COALESCE(o.units_offered, 0) AS units_offered,
                  d.reason AS decline_reason,
                  d.expires_at AS decline_expires_at,
                  CASE
                    WHEN o.units_offered > 0 THEN 'offered'
                    WHEN d.reason IS NOT NULL THEN 'declined'
                    ELSE 'silent'
                  END AS state
             FROM eligible e
        LEFT JOIN offers o ON o.blood_bank_id = e.bb_id
        LEFT JOIN declines d ON d.blood_bank_id = e.bb_id
         ORDER BY CASE WHEN o.units_offered > 0 THEN 0
                       WHEN d.reason IS NOT NULL THEN 1
                       ELSE 2 END,
                  e.display_name`,
          [
            request.requesting_hospital_district_id,
            request.patient_blood_group_id,
            request.component_id,
            requestId,
          ],
        )
      ).rows;

      const gate =
        (
          await c.query(
            `SELECT scheduled_fire_at, trigger_source, urgency_snapshot,
                  shortfall_snapshot, held_at, held_by, held_reason,
                  fired_at, fired_alert_count, fire_skip_reason
             FROM pending_donor_alerts
            WHERE request_id = $1`,
            [requestId],
          )
        ).rows[0] || null;

      const alertsCount = (
        await c.query(
          `SELECT COUNT(*)::int AS n,
                  COUNT(*) FILTER (WHERE donor_response = 'YE')::int AS accepted,
                  COUNT(*) FILTER (WHERE donor_response = 'NO')::int AS declined,
                  MAX(created_at) AS last_created_at
             FROM donor_alerts WHERE request_id = $1`,
          [requestId],
        )
      ).rows[0];

      const committed = (
        await c.query(
          `SELECT COUNT(*)::int AS n
             FROM blood_inventory
            WHERE reserved_for_request_id = $1
              AND status IN ('RE','IS','TR')`,
          [requestId],
        )
      ).rows[0].n;

      return {
        request_id: requestId,
        units_required: request.units_required,
        units_committed: committed,
        units_still_needed: Math.max(0, request.units_required - committed),
        bb_decisions: bbs,
        eligible_bb_count: bbs.length,
        ns_decline_count: bbs.filter((b) => b.decline_reason === 'NS').length,
        gate,
        donor_alerts: {
          total: alertsCount.n,
          accepted: alertsCount.accepted,
          declined: alertsCount.declined,
          last_created_at: alertsCount.last_created_at,
        },
      };
    });
    res.json(result);
  },
);

// ── POST /coordinator/requests/:id/alert-donors-now ──────────────────────
// Coordinator manually bypasses the timer window and fires donor alerts on
// next scheduler tick. Used when coord judges BB path won't fulfil in time
// (BB slow / holiday / patient deteriorating). Trigger source recorded as
// 'CT' in pending_donor_alerts audit.
router.post(
  '/requests/:id/alert-donors-now',
  verifyJWT,
  requireRole('coordinator', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const requestId = req.params.id;
    const result = await withRlsContext(
      req,
      async (c) => {
        const request = (
          await c.query(
            `SELECT id, urgency_tier, units_required, units_fulfilled,
                    donor_activation_required, requesting_hospital_district_id,
                    component_id, patient_blood_group_id, status
               FROM blood_requests WHERE id = $1`,
            [requestId],
          )
        ).rows[0];
        if (!request) {
          throw Object.assign(new Error('request_not_found'), { status: 404 });
        }
        if (!['OP', 'MT', 'AS', 'PF'].includes(request.status)) {
          throw Object.assign(new Error('request_not_open'), { status: 409 });
        }

        const prior = (await c.query(`SELECT current_setting('raktify.actor_role', TRUE) AS r`))
          .rows[0].r;
        await c.query(`SELECT set_config('raktify.actor_role', 'system', TRUE)`);
        try {
          return await triggerNow(c, {
            actorUserId: req.user.userId,
            request,
          });
        } finally {
          await c.query(`SELECT set_config('raktify.actor_role', $1, TRUE)`, [prior || '']);
        }
      },
      { change_reason: 'coordinator triggers donor alerts now' },
    );
    res.json(result);
  },
);

// ── POST /coordinator/requests/:id/hold-donor-alerts ─────────────────────
// Coordinator suppresses donor alerts even if timer fires. Used when BB has
// confirmed offline they'll handle it or when the case needs human triage
// before donors are pinged.
const holdSchema = z.object({ reason: z.string().min(3).max(500).optional() });

router.post(
  '/requests/:id/hold-donor-alerts',
  verifyJWT,
  requireRole('coordinator', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const requestId = req.params.id;
    const parsed = holdSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    await withRlsContext(
      req,
      async (c) => {
        const request = (
          await c.query(`SELECT id, status FROM blood_requests WHERE id = $1`, [requestId])
        ).rows[0];
        if (!request) {
          throw Object.assign(new Error('request_not_found'), { status: 404 });
        }

        const prior = (await c.query(`SELECT current_setting('raktify.actor_role', TRUE) AS r`))
          .rows[0].r;
        await c.query(`SELECT set_config('raktify.actor_role', 'system', TRUE)`);
        try {
          await holdAlert(c, {
            requestId,
            actorUserId: req.user.userId,
            reason: parsed.data.reason,
          });
        } finally {
          await c.query(`SELECT set_config('raktify.actor_role', $1, TRUE)`, [prior || '']);
        }
      },
      { change_reason: 'coordinator holds donor alerts' },
    );
    res.json({ held: true, request_id: requestId });
  },
);

module.exports = router;
