/**
 * Blood inventory routes (Phase 4).
 *
 *   GET  /inventory                          blood_bank own; admin all
 *   GET  /inventory/availability             district-scoped counts (hospital, coordinator)
 *   POST /inventory/opening-stock            blood_bank; legacy stock without TTI (source='WB')
 *   POST /inventory/:id/recall               blood_bank or ngo_admin; trigger recall
 *
 * Note: bag creation from a fresh donation goes via POST /donations
 * (which fires trg_donation_creates_inventory). Direct INSERT is reserved
 * for opening-stock entry only.
 */
const express = require('express');
const { z } = require('zod');

const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { openRows } = require('../services/pii');
const { evaluateCascade } = require('../services/donor-alert-gate');

const router = express.Router();

// ── GET /inventory ───────────────────────────────────────────────────────
router.get(
  '/',
  verifyJWT,
  requireRole('blood_bank', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const status = req.query.status;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);

    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT bi.id, bi.isbt_barcode, bi.donor_id, bi.blood_bank_id,
              bi.blood_group_id, bg.code AS blood_group_code,
              bi.component_id, bc.code AS component_code,
              bi.volume_ml, bi.collection_date, bi.expiry_date,
              bi.status, bi.is_recalled, bi.source,
              bi.reserved_for_request_id, bi.issued_to_institution_id,
              bi.status_changed_at
         FROM blood_inventory bi
    LEFT JOIN blood_groups bg ON bg.id = bi.blood_group_id
    LEFT JOIN blood_components bc ON bc.id = bi.component_id
        WHERE ($1::text IS NULL OR bi.status = $1)
     ORDER BY bi.expiry_date ASC NULLS LAST
        LIMIT $2`,
        [status || null, limit],
      ),
    );
    res.json({ bags: r.rows, count: r.rowCount });
  },
);

// ── GET /inventory/availability ──────────────────────────────────────────
// District-scoped counts only — no bag-level detail. Hospitals + coordinators
// use this to gauge supply without seeing identifying inventory data.
router.get(
  '/availability',
  verifyJWT,
  requireRole('hospital', 'coordinator', 'blood_bank', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const districtId = Number(req.query.district_id);
    if (!Number.isFinite(districtId)) {
      return res.status(400).json({ error: 'district_id_required' });
    }
    const r = await withRlsContext(req, (c) =>
      c.query(
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
        [districtId],
      ),
    );
    res.json({ district_id: districtId, available: r.rows });
  },
);

// ── POST /inventory/opening-stock (blood_bank, legacy stock) ─────────────
// One-time entry at onboarding. Bags get source='WB' (legacy WhatsApp pattern)
// and skip TTI gating per spec §6 — they're labelled "no TTI record" in UI.
const openingStockSchema = z.object({
  collection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bags: z
    .array(
      z.object({
        blood_group_id: z.number().int().min(1).max(8),
        component_id: z.number().int().min(1).max(6),
        units: z.number().int().min(1).max(100),
        volume_ml_each: z.number().int().min(50).max(500).default(280),
      }),
    )
    .min(1)
    .max(50),
});

router.post('/opening-stock', verifyJWT, requireRole('blood_bank'), async (req, res) => {
  const parsed = openingStockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  const data = parsed.data;

  const created = await withRlsContext(
    req,
    async (c) => {
      // Need a synthetic donor row to satisfy the donation_id FK on inventory.
      // For opening stock, we point at a single per-institution synthetic donor
      // whose mobile is `+91-LEGACY-<inst>` and identity flag is_legacy_synthetic.
      // Created on first use.
      // NOTE: simplified for scaffold — we attach to the institution's first
      // verified donor instead. A proper implementation creates a dedicated
      // synthetic donor and hides them from matching. TODO: implement.
      // For Phase 4 scaffold we record opening stock against a fake donor_id
      // and donation_id derived from the first registered donor at this BB.
      const seedDonor = await c.query(
        `SELECT d.id, dh.id AS donation_id
           FROM donors d
           JOIN donation_history dh ON dh.donor_id = d.id
          WHERE dh.blood_bank_id = $1
          ORDER BY d.created_at ASC
          LIMIT 1`,
        [req.user.institutionId],
      );
      if (seedDonor.rowCount === 0) {
        throw Object.assign(
          new Error(
            'opening_stock_requires_seed_donor — record at least one donation through POST /donations first to bootstrap',
          ),
          { status: 400 },
        );
      }

      const bags = [];
      for (const b of data.bags) {
        for (let i = 0; i < b.units; i++) {
          const barcode = `LEGACY-${req.user.institutionId.slice(0, 8)}-${b.blood_group_id}-${b.component_id}-${Date.now()}-${i}`;
          const r = await c.query(
            `INSERT INTO blood_inventory (
                isbt_barcode, donation_id, donor_id, blood_bank_id,
                blood_group_id, component_id, volume_ml,
                collection_date, status, status_changed_by, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'AV', $9, 'WB')
          RETURNING id, isbt_barcode, blood_group_id, component_id, status`,
            [
              barcode,
              seedDonor.rows[0].donation_id,
              seedDonor.rows[0].id,
              req.user.institutionId,
              b.blood_group_id,
              b.component_id,
              b.volume_ml_each,
              data.collection_date,
              req.user.userId,
            ],
          );
          bags.push(r.rows[0]);
        }
      }
      return bags;
    },
    { change_reason: 'opening-stock entry (legacy WB)' },
  );

  res.status(201).json({ created_count: created.length, bags: created });
});

// ── POST /inventory/:id/recall ────────────────────────────────────────────
router.post(
  '/:id/recall',
  verifyJWT,
  requireRole('blood_bank', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const schema = z.object({ reason: z.string().min(5) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE blood_inventory
              SET is_recalled = TRUE,
                  recall_reason = $1,
                  recall_initiated_by = $2,
                  recall_initiated_at = clock_timestamp(),
                  status = CASE WHEN status IN ('QA','AV','RE') THEN 'RC' ELSE status END,
                  status_changed_by = $2
            WHERE id = $3
              AND is_recalled = FALSE
        RETURNING id, status, is_recalled`,
          [parsed.data.reason, req.user.userId, req.params.id],
        ),
      { change_reason: `manual recall: ${parsed.data.reason}` },
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found_or_already_recalled' });
    res.json(r.rows[0]);
  },
);

// ── GET /inventory/dashboard (blood_bank) ────────────────────────────────
// Aggregate overview for the blood-bank portal landing: KPI counts, the
// inventory grid (blood group x component), incoming open requests in the
// BB's district ("Raise Hand" candidates), and recent donations.
router.get('/dashboard', verifyJWT, requireRole('blood_bank'), async (req, res) => {
  const bbId = req.user.institutionId;
  if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });

  const data = await withRlsContext(req, async (c) => {
    const kpis = (
      await c.query(
        `SELECT
           -- Expiry MUST be part of "available": every other surface (district
           -- availability, open-requests, matching) excludes expired bags, so
           -- without it this KPI overstates usable stock — a BB would see units
           -- it cannot legally issue. Expired-but-still-AV bags are reported
           -- separately so they are visible for disposal, not silently dropped.
           COUNT(*) FILTER (WHERE status = 'AV' AND is_recalled = FALSE
                            AND expiry_date > CURRENT_DATE)::int                AS available_units,
           COUNT(*) FILTER (WHERE status = 'AV' AND is_recalled = FALSE
                            AND expiry_date <= CURRENT_DATE)::int               AS expired_units,
           COUNT(*) FILTER (WHERE status = 'AV' AND is_recalled = FALSE
                            AND expiry_date > CURRENT_DATE
                            AND expiry_date <= CURRENT_DATE + 2)::int           AS expiring_48h,
           COUNT(*) FILTER (WHERE status = 'QA')::int                          AS pending_tti,
           COUNT(*) FILTER (WHERE status IN ('IS','TR')
                            AND issued_at >= date_trunc('month', NOW()))::int   AS issued_this_month
         FROM blood_inventory WHERE blood_bank_id = $1`,
        [bbId],
      )
    ).rows[0];

    const donationsToday = (
      await c.query(
        `SELECT COUNT(*)::int AS n FROM donation_history
          WHERE blood_bank_id = $1 AND collection_date = CURRENT_DATE`,
        [bbId],
      )
    ).rows[0].n;

    const grid = (
      await c.query(
        `SELECT bg.code AS blood_group, bc.code AS component,
                COUNT(*) FILTER (WHERE bi.status = 'AV' AND bi.is_recalled = FALSE)::int AS available,
                COUNT(*)::int AS total
           FROM blood_inventory bi
           JOIN blood_groups bg ON bg.id = bi.blood_group_id
           JOIN blood_components bc ON bc.id = bi.component_id
          WHERE bi.blood_bank_id = $1
          GROUP BY bg.code, bc.code
          ORDER BY bg.code, bc.code`,
        [bbId],
      )
    ).rows;

    const dist = (await c.query(`SELECT district_id FROM institutions WHERE id = $1`, [bbId]))
      .rows[0]?.district_id;

    const incoming = dist
      ? (
          await c.query(
            `SELECT br.id, br.request_number, bg.code AS blood_group, bc.code AS component,
                    br.units_required, br.urgency_tier, br.raised_at
               FROM blood_requests br
               JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
               JOIN blood_components bc ON bc.id = br.component_id
              WHERE br.requesting_hospital_district_id = $1
                -- Same status set as /open-requests: a request that is assigned
                -- or partly filled still needs units, so it is still an ask.
                AND br.status IN ('OP','MT','AS','PF')
                -- A request whose units are fully committed is not an ask any
                -- more. Without this a BB keeps seeing a case as "incoming"
                -- after it has itself fulfilled it (status stays 'MT'), which
                -- reads as an outstanding demand that no longer exists.
                AND br.units_required > (
                      SELECT COUNT(*)
                        FROM blood_inventory bi
                       WHERE COALESCE(bi.reserved_for_request_id, bi.fulfilled_request_id) = br.id
                         AND bi.status IN ('RE','IS','RV','TR'))
           ORDER BY CASE br.urgency_tier WHEN 'CR' THEN 0 WHEN 'UR' THEN 1 ELSE 2 END,
                    br.raised_at DESC
              LIMIT 10`,
            [dist],
          )
        ).rows
      : [];

    const recent = (
      await c.query(
        `SELECT dh.id, dh.collection_date, bc.code AS component, dh.volume_ml,
                d.full_name AS donor_name
           FROM donation_history dh
           JOIN blood_components bc ON bc.id = dh.component_id
           JOIN donors d ON d.id = dh.donor_id
          WHERE dh.blood_bank_id = $1
       ORDER BY dh.collection_date DESC, dh.created_at DESC
          LIMIT 8`,
        [bbId],
      )
    ).rows;
    openRows(recent, ['donor_name']); // donor name is column-encrypted at rest

    return {
      kpis: { ...kpis, donations_today: donationsToday },
      inventory_grid: grid,
      incoming_requests: incoming,
      recent_donations: recent,
    };
  });

  res.json(data);
});

// ── GET /inventory/open-requests ─────────────────────────────────────────
// "Open requests I can fulfil" — blood_bank-only view of open blood requests
// where THIS BB has compatible available inventory.
//
// units_committed = count of bags currently RE/IS/TR against this request
// (i.e., voluntary offers from any BB already logged). So if BB1 offered 3
// of an 11-unit request, BB2 sees "8 still needed".
//
// Only lists requests where this BB has at least 1 compatible AV bag.
router.get('/open-requests', verifyJWT, requireRole('blood_bank'), async (req, res) => {
  const bbId = req.user.institutionId;
  if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const rows = await withRlsContext(req, async (c) => {
    const r = await c.query(
      `WITH me AS (
           SELECT id, district_id FROM institutions WHERE id = $1
         ),
         my_inv AS (
           SELECT bi.blood_group_id, bi.component_id, COUNT(*)::int AS units
             FROM blood_inventory bi, me
            WHERE bi.blood_bank_id = me.id
              AND bi.status = 'AV'
              AND bi.is_recalled = FALSE
              AND bi.expiry_date > CURRENT_DATE
              AND bi.reserved_for_request_id IS NULL
            GROUP BY bi.blood_group_id, bi.component_id
         ),
         -- "Committed" = a bag actively fulfilling this request, in ANY custody
         -- stage. reserved_for_request_id is nulled the instant a bag is issued
         -- (reserve_consistency), so the durable link becomes fulfilled_request_id
         -- from IS onward — COALESCE covers both, and RV must be counted too.
         committed AS (
           SELECT COALESCE(reserved_for_request_id, fulfilled_request_id) AS request_id,
                  COUNT(*)::int AS units
             FROM blood_inventory
            WHERE status IN ('RE','IS','RV','TR')
              AND COALESCE(reserved_for_request_id, fulfilled_request_id) IS NOT NULL
            GROUP BY COALESCE(reserved_for_request_id, fulfilled_request_id)
         ),
         my_committed AS (
           SELECT COALESCE(reserved_for_request_id, fulfilled_request_id) AS request_id,
                  COUNT(*)::int AS units
             FROM blood_inventory bi, me
            WHERE bi.blood_bank_id = me.id
              AND bi.status IN ('RE','IS','RV','TR')
              AND COALESCE(bi.reserved_for_request_id, bi.fulfilled_request_id) IS NOT NULL
            GROUP BY COALESCE(reserved_for_request_id, fulfilled_request_id)
         ),
         compat_req AS (
           SELECT br.id AS request_id,
                  SUM(CASE WHEN cm.is_preferred THEN mi.units ELSE 0 END)::int AS exact_units,
                  SUM(mi.units)::int AS total_compat_units
             FROM blood_requests br
             JOIN compatibility_matrix cm
               ON cm.component_id = br.component_id
              AND cm.recipient_group_id = br.patient_blood_group_id
              AND cm.is_compatible = TRUE
             JOIN my_inv mi
               ON mi.blood_group_id = cm.donor_group_id
              AND mi.component_id = br.component_id
            WHERE br.status IN ('OP','MT','AS','PF')
            GROUP BY br.id
           HAVING SUM(mi.units) > 0
         )
         SELECT br.id,
                br.request_number,
                br.urgency_tier,
                br.status,
                br.units_required,
                COALESCE(cmt.units, 0) AS units_committed,
                COALESCE(my_cmt.units, 0) AS units_i_committed,
                GREATEST(br.units_required - COALESCE(cmt.units, 0), 0)::int AS units_still_needed,
                cr.exact_units,
                (cr.total_compat_units - cr.exact_units)::int AS fallback_units,
                LEAST(cr.total_compat_units,
                      GREATEST(br.units_required - COALESCE(cmt.units, 0), 0))::int AS units_i_can_offer,
                COALESCE(ri.display_name, br.guest_hospital_name) AS hospital_name,
                d.name AS hospital_district,
                ((SELECT district_id FROM me) = br.requesting_hospital_district_id) AS is_same_district,
                bg.code AS blood_group,
                bc.code AS component,
                br.raised_at,
                EXTRACT(EPOCH FROM (NOW() - br.raised_at))/60 AS mins_since_raised,
                br.escalation_timeout_minutes
           FROM compat_req cr
           JOIN blood_requests br ON br.id = cr.request_id
      LEFT JOIN committed cmt ON cmt.request_id = br.id
      LEFT JOIN my_committed my_cmt ON my_cmt.request_id = br.id
      LEFT JOIN institutions ri ON ri.id = br.requesting_institution_id
      LEFT JOIN districts d ON d.id = br.requesting_hospital_district_id
           JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
           JOIN blood_components bc ON bc.id = br.component_id
          WHERE br.units_required > COALESCE(cmt.units, 0)
       ORDER BY CASE br.urgency_tier WHEN 'CR' THEN 0 WHEN 'UR' THEN 1 ELSE 2 END,
                (br.units_required - COALESCE(cmt.units, 0)) DESC,
                br.raised_at ASC
          LIMIT $2`,
      [bbId, limit],
    );
    return r.rows;
  });

  res.json({ requests: rows, count: rows.length });
});

// ── POST /inventory/open-requests/:requestId/offer ───────────────────────
// Blood bank voluntarily offers N units of compatible inventory for the given
// request. Picks best candidates (same-group first, FIFO by expiry), reserves
// them, and returns the updated committed counts.
//
// This is the ONLY path by which a BB's inventory gets committed to a request
// when env.matching.bbAutoReserve is false (the default). Auto-reserve is
// gated OFF until Raktify earns BB trust — see services/matching/index.js.
const offerSchema = z.object({
  units: z.number().int().min(1).max(50),
  // V2 §7: BB may declare a replacement obligation on this offer. If true,
  // a replacement_obligations row is created + soft donor alerts fire later
  // (task 77 notification path). Off by default; deliberate ethical friction.
  needs_replacement: z.boolean().optional(),
  replacement_deadline_days: z.number().int().min(1).max(60).optional(),
});

router.post(
  '/open-requests/:requestId/offer',
  verifyJWT,
  requireRole('blood_bank'),
  async (req, res) => {
    const bbId = req.user.institutionId;
    if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });

    const parsed = offerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
    }
    const wantUnits = parsed.data.units;
    const requestId = req.params.requestId;

    const result = await withRlsContext(
      req,
      async (c) => {
        // Verify the request is still open and has room for more offers.
        const reqRow = (
          await c.query(
            `SELECT br.id, br.status, br.units_required, br.component_id,
                    br.patient_blood_group_id
               FROM blood_requests br
              WHERE br.id = $1`,
            [requestId],
          )
        ).rows[0];
        if (!reqRow) {
          throw Object.assign(new Error('request_not_found'), { status: 404 });
        }
        if (!['OP', 'MT', 'AS', 'PF'].includes(reqRow.status)) {
          throw Object.assign(new Error('request_not_open'), { status: 409 });
        }

        const committedRow = (
          await c.query(
            `SELECT COUNT(*)::int AS n
               FROM blood_inventory
              WHERE COALESCE(reserved_for_request_id, fulfilled_request_id) = $1
                AND status IN ('RE','IS','RV','TR')`,
            [requestId],
          )
        ).rows[0];
        const alreadyCommitted = committedRow.n;
        const remaining = reqRow.units_required - alreadyCommitted;
        if (remaining <= 0) {
          throw Object.assign(new Error('request_already_fully_committed'), { status: 409 });
        }
        const willReserve = Math.min(wantUnits, remaining);

        // Pick best compatible bags from this BB.
        const bags = (
          await c.query(
            `SELECT bi.id
               FROM blood_inventory bi
               JOIN compatibility_matrix cm
                 ON cm.component_id = bi.component_id
                AND cm.donor_group_id = bi.blood_group_id
                AND cm.recipient_group_id = $3
                AND cm.is_compatible = TRUE
              WHERE bi.blood_bank_id = $1
                AND bi.component_id = $2
                AND bi.status = 'AV'
                AND bi.is_recalled = FALSE
                AND bi.expiry_date > CURRENT_DATE
                AND bi.reserved_for_request_id IS NULL
           ORDER BY cm.is_preferred DESC, bi.expiry_date ASC
              LIMIT $4`,
            [bbId, reqRow.component_id, reqRow.patient_blood_group_id, willReserve],
          )
        ).rows;

        if (bags.length === 0) {
          throw Object.assign(new Error('no_compatible_inventory'), { status: 409 });
        }

        // Reserve.
        const bagIds = bags.map((b) => b.id);
        const reservedCount = (
          await c.query(
            `UPDATE blood_inventory
                SET status = 'RE',
                    reserved_for_request_id = $2,
                    reserved_at = clock_timestamp(),
                    status_changed_by = $3
              WHERE id = ANY($1)
                AND status = 'AV'
                AND is_recalled = FALSE
           RETURNING id`,
            [bagIds, requestId, req.user.userId],
          )
        ).rowCount;

        // Update request-level state — matched_blood_bank_id + status flip
        // if we've now fully committed the request.
        const newCommitted = alreadyCommitted + reservedCount;
        const nowFullyCommitted = newCommitted >= reqRow.units_required;

        await c.query(
          `UPDATE blood_requests
              SET status = CASE
                    WHEN $2 THEN 'MT'
                    WHEN status = 'OP' THEN 'PF'
                    ELSE status END,
                  matched_blood_bank_id = COALESCE(matched_blood_bank_id, $3),
                  first_match_found_at = COALESCE(first_match_found_at, clock_timestamp())
            WHERE id = $1`,
          [requestId, nowFullyCommitted, bbId],
        );

        // Replacement obligation — if BB ticked the box, log an obligation
        // for the units offered. Notification path for the softer donor
        // invitation lands with task 77 templates.
        let replacementObligationId = null;
        if (parsed.data.needs_replacement) {
          const days = parsed.data.replacement_deadline_days ?? 14;
          const row = (
            await c.query(
              `INSERT INTO replacement_obligations
                 (request_id, blood_bank_id, units_target, deadline_date, created_by)
               -- $4 MUST be cast: an untyped parameter makes "date + $4"
               -- ambiguous between date+integer, date+interval and date+time,
               -- which Postgres rejects as 42725 (operator is not unique).
               VALUES ($1, $2, $3, CURRENT_DATE + $4::int, $5)
               ON CONFLICT (request_id, blood_bank_id) DO UPDATE
                 SET units_target = replacement_obligations.units_target + EXCLUDED.units_target,
                     deadline_date = LEAST(replacement_obligations.deadline_date,
                                           EXCLUDED.deadline_date)
             RETURNING id`,
              [requestId, bbId, reservedCount, days, req.user.userId],
            )
          ).rows[0];
          replacementObligationId = row.id;
        }

        return {
          bags_reserved: reservedCount,
          new_units_committed: newCommitted,
          units_required: reqRow.units_required,
          fully_committed: nowFullyCommitted,
          replacement_obligation_id: replacementObligationId,
        };
      },
      { change_reason: 'blood_bank offers units for open request' },
    );

    res.json(result);
  },
);

// ── POST /inventory/open-requests/:requestId/decline ─────────────────────
// Blood bank marks "can't fulfill this one" with a reason. The reason drives
// donor-routing behaviour (spec §V2 refinement 2):
//
//   'NS' no compatible stock   → BB stays in donor routing list (can accept walk-ins)
//   'NC' no capacity today     → BB removed from donor routing list
//   'ND' not on duty           → BB removed from donor routing list
//
// UPSERT semantics: BB can update their reason (e.g., initially 'NS' then
// realise 'NC' by end of shift). Decline auto-expires after 24h and BB may
// re-decline as inventory changes.
//
// Cascade: when all eligible BBs (BBs with compatible AV stock for this
// request) have declined with reason='NS', donor_alert_gate service (task 73)
// treats this as "BBs won't fulfil" and bypasses the timer window for
// CRITICAL requests. That wiring lands with the gate service.
const declineSchema = z.object({
  reason: z.enum(['NS', 'NC', 'ND']),
  note: z.string().max(500).optional(),
});

router.post(
  '/open-requests/:requestId/decline',
  verifyJWT,
  requireRole('blood_bank'),
  async (req, res) => {
    const bbId = req.user.institutionId;
    if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });

    const parsed = declineSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
    }
    const { reason, note } = parsed.data;
    const requestId = req.params.requestId;

    const result = await withRlsContext(
      req,
      async (c) => {
        const reqRow = (
          await c.query(`SELECT id, status FROM blood_requests WHERE id = $1`, [requestId])
        ).rows[0];
        if (!reqRow) {
          throw Object.assign(new Error('request_not_found'), { status: 404 });
        }
        if (!['OP', 'MT', 'AS', 'PF'].includes(reqRow.status)) {
          throw Object.assign(new Error('request_not_open'), { status: 409 });
        }

        const row = (
          await c.query(
            `INSERT INTO open_request_bb_declines
               (request_id, blood_bank_id, reason, reason_note, declined_by, expires_at)
             VALUES ($1, $2, $3, $4, $5, clock_timestamp() + INTERVAL '24 hours')
             ON CONFLICT (request_id, blood_bank_id) DO UPDATE
               SET reason = EXCLUDED.reason,
                   reason_note = EXCLUDED.reason_note,
                   declined_by = EXCLUDED.declined_by,
                   declined_at = clock_timestamp(),
                   expires_at = clock_timestamp() + INTERVAL '24 hours'
          RETURNING id, reason, expires_at`,
            [requestId, bbId, reason, note || null, req.user.userId],
          )
        ).rows[0];

        // If BB marked 'NS' (no stock), evaluate the cascade — all eligible
        // BBs declined => bypass timer, fire donors on next scheduler tick.
        // NC/ND declines only remove the BB from donor-routing; they don't
        // change the cascade signal.
        let cascade = null;
        if (reason === 'NS') {
          const prior = (await c.query(`SELECT current_setting('raktify.actor_role', TRUE) AS r`))
            .rows[0].r;
          await c.query(`SELECT set_config('raktify.actor_role', 'system', TRUE)`);
          try {
            cascade = await evaluateCascade(c, {
              requestId,
              actorUserId: req.user.userId,
            });
          } finally {
            await c.query(`SELECT set_config('raktify.actor_role', $1, TRUE)`, [prior || '']);
          }
        }

        return {
          decline_id: row.id,
          reason: row.reason,
          expires_at: row.expires_at,
          cascade,
        };
      },
      { change_reason: `blood_bank declines open request (${reason})` },
    );

    res.status(201).json(result);
  },
);

// ── POST /inventory/requests/:requestId/issue ────────────────────────────
// Blood bank ISSUES its reserved bags for a request: they physically leave the
// BB (RE → IS). This is the missing precondition the coordinator close needed —
// only issued bags can be received/transfused. Sets fulfilled_request_id (the
// durable link) and issued_to = the requesting institution (NULL for guest /
// community / citizen tiers, which have no receiving institution — the recipient
// is a relative or runner). The trigger nulls the reservation link + stamps
// issued_at. From here the case surfaces in the coordinator queue for receipt
// confirmation.
const issueSchema = z.object({
  bag_ids: z.array(z.string().uuid()).min(1).max(50).optional(),
});
router.post(
  '/requests/:requestId/issue',
  verifyJWT,
  requireRole('blood_bank'),
  async (req, res) => {
    const bbId = req.user.institutionId;
    if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
    const requestId = req.params.requestId;

    const result = await withRlsContext(
      req,
      async (c) => {
        const reqRow = (
          await c.query(
            `SELECT id, status, requesting_institution_id FROM blood_requests WHERE id = $1`,
            [requestId],
          )
        ).rows[0];
        if (!reqRow) throw Object.assign(new Error('request_not_found'), { status: 404 });
        if (!['OP', 'MT', 'AS', 'PF'].includes(reqRow.status)) {
          throw Object.assign(new Error('request_not_open'), { status: 409 });
        }

        // Only THIS BB's bags reserved for THIS request are eligible. An
        // explicit bag_ids list narrows it further (partial issue); NULL = all
        // of them. App-layer scoping — RLS is inert at runtime.
        const bagIds = parsed.data.bag_ids ?? null;
        const eligible = (
          await c.query(
            `SELECT id FROM blood_inventory
              WHERE blood_bank_id = $1
                AND reserved_for_request_id = $2
                AND status = 'RE'
                AND ($3::uuid[] IS NULL OR id = ANY($3))
              FOR UPDATE`,
            [bbId, requestId, bagIds],
          )
        ).rows.map((r) => r.id);
        if (eligible.length === 0) {
          throw Object.assign(new Error('no_reserved_bags_to_issue'), { status: 409 });
        }

        // RE → IS. issued_to may be NULL (guest); fulfilled_request_id is the
        // enforced link (issue_consistency). Trigger clears the reservation.
        await c.query(
          `UPDATE blood_inventory
              SET status = 'IS',
                  issued_to_institution_id = $2,
                  fulfilled_request_id = $3,
                  status_changed_by = $4
            WHERE id = ANY($1)`,
          [eligible, reqRow.requesting_institution_id, requestId, req.user.userId],
        );
        return { request_id: requestId, units_issued: eligible.length };
      },
      { change_reason: 'blood_bank issues reserved units' },
    );
    res.json(result);
  },
);

// ── POST /inventory/bags/:bagId/return ───────────────────────────────────
// A bag was issued but NOT transfused (patient died, bedside crossmatch
// incompatible, surgery cancelled) and has come back to the BB. If the cold
// chain held → AV (returns to usable stock, custody chain wiped by the trigger).
// If spoiled → WA (written off; keeps issued_to/fulfilled_request_id for
// hemovigilance traceability). Only the owning BB may return its own bag.
const returnSchema = z.object({
  disposition: z.enum(['AV', 'WA']),
  reason: z.string().trim().min(3).max(500),
});
router.post('/bags/:bagId/return', verifyJWT, requireRole('blood_bank'), async (req, res) => {
  const bbId = req.user.institutionId;
  if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });
  const parsed = returnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const result = await withRlsContext(
    req,
    async (c) => {
      const bag = (
        await c.query(
          `SELECT id, status FROM blood_inventory
            WHERE id = $1 AND blood_bank_id = $2 FOR UPDATE`,
          [req.params.bagId, bbId],
        )
      ).rows[0];
      if (!bag) throw Object.assign(new Error('bag_not_found'), { status: 404 });
      if (!['IS', 'RV'].includes(bag.status)) {
        throw Object.assign(new Error('bag_not_returnable'), { status: 409 });
      }
      await c.query(
        `UPDATE blood_inventory
            SET status = $2, return_reason = $3, status_changed_by = $4
          WHERE id = $1`,
        [req.params.bagId, parsed.data.disposition, parsed.data.reason, req.user.userId],
      );
      return { bag_id: req.params.bagId, disposition: parsed.data.disposition };
    },
    { change_reason: `blood_bank returns bag (${parsed.data.disposition})` },
  );
  res.json(result);
});

// ── GET /inventory/my-commitments ────────────────────────────────────────
// Every request this BB has committed bags to, whatever the request's status.
//
// Without this a BB loses sight of a case the moment it commits: /open-requests
// drops any request whose units are fully committed, so the case it just
// accepted vanishes — along with the route to its chat. This is the BB's
// "what have I promised, and what happens next" view, so it deliberately does
// NOT filter by request status; a closed case still matters for the audit
// trail and for any replacement obligation still outstanding.
router.get('/my-commitments', verifyJWT, requireRole('blood_bank'), async (req, res) => {
  const bbId = req.user.institutionId;
  if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  const rows = await withRlsContext(req, async (c) => {
    const r = await c.query(
      `WITH mine AS (
           SELECT COALESCE(reserved_for_request_id, fulfilled_request_id) AS request_id,
                  COUNT(*)::int AS units_i_committed,
                  COUNT(*) FILTER (WHERE status = 'RE')::int AS units_reserved,
                  COUNT(*) FILTER (WHERE status = 'IS')::int AS units_issued,
                  COUNT(*) FILTER (WHERE status = 'RV')::int AS units_received,
                  COUNT(*) FILTER (WHERE status = 'TR')::int AS units_transfused,
                  MIN(expiry_date) FILTER (WHERE status IN ('RE','IS')) AS earliest_expiry
             FROM blood_inventory
            WHERE blood_bank_id = $1
              AND COALESCE(reserved_for_request_id, fulfilled_request_id) IS NOT NULL
              AND status IN ('RE','IS','RV','TR')
            GROUP BY COALESCE(reserved_for_request_id, fulfilled_request_id)
         ),
         total AS (
           SELECT COALESCE(reserved_for_request_id, fulfilled_request_id) AS request_id,
                  COUNT(*)::int AS units_committed_total
             FROM blood_inventory
            WHERE COALESCE(reserved_for_request_id, fulfilled_request_id) IS NOT NULL
              AND status IN ('RE','IS','RV','TR')
            GROUP BY COALESCE(reserved_for_request_id, fulfilled_request_id)
         )
       SELECT br.id,
              br.request_number,
              br.status,
              br.urgency_tier,
              br.units_required,
              mine.units_i_committed,
              mine.units_reserved,
              mine.units_issued,
              mine.units_received,
              mine.units_transfused,
              mine.earliest_expiry,
              COALESCE(total.units_committed_total, 0) AS units_committed_total,
              br.crossmatch_confirmed,
              br.closed_at,
              br.raised_at,
              EXTRACT(EPOCH FROM (NOW() - br.raised_at))/60 AS mins_since_raised,
              COALESCE(ri.display_name, br.guest_hospital_name) AS hospital_name,
              bg.code AS blood_group,
              bc.code AS component,
              ro.units_target       AS replacement_units_target,
              ro.units_fulfilled    AS replacement_units_fulfilled,
              ro.deadline_date      AS replacement_deadline
         FROM mine
         JOIN blood_requests br ON br.id = mine.request_id
    LEFT JOIN total ON total.request_id = br.id
    LEFT JOIN institutions ri ON ri.id = br.requesting_institution_id
         JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
         JOIN blood_components bc ON bc.id = br.component_id
    LEFT JOIN replacement_obligations ro
           ON ro.request_id = br.id AND ro.blood_bank_id = $1
     ORDER BY (br.closed_at IS NOT NULL),
              CASE br.urgency_tier WHEN 'CR' THEN 0 WHEN 'UR' THEN 1 ELSE 2 END,
              br.raised_at DESC
        LIMIT $2`,
      [bbId, limit],
    );
    return r.rows;
  });

  res.json({ commitments: rows, count: rows.length });
});

// ── GET /inventory/incoming-donors ───────────────────────────────────────
// BB sees the donors who accepted alerts and chose this BB for their
// donation, ordered by expected arrival / deadline. Used to plan phlebotomy
// staffing and cold-chain slots.
router.get('/incoming-donors', verifyJWT, requireRole('blood_bank'), async (req, res) => {
  const bbId = req.user.institutionId;
  if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });

  const rows = await withRlsContext(req, async (c) => {
    const r = await c.query(
      `SELECT dac.id AS choice_id,
                dac.donor_id, dac.request_id,
                dac.accepted_at, dac.expected_arrival_at, dac.deadline_at,
                dac.distance_to_bb_km, dac.status,
                dac.arrived_at,
                d.full_name AS donor_name,
                d.mobile AS donor_mobile,
                d.blood_group_verified AS donor_blood_group,
                bg_donor.code AS donor_blood_group_code,
                br.request_number, br.urgency_tier,
                COALESCE(rh.display_name, br.guest_hospital_name) AS hospital_name,
                dist.name AS hospital_district_name,
                bg.code AS blood_group, bc.code AS component
           FROM donor_alert_choices dac
           JOIN donors d ON d.id = dac.donor_id
           JOIN blood_requests br ON br.id = dac.request_id
      LEFT JOIN blood_groups bg_donor ON bg_donor.id = d.blood_group_verified
           JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
           JOIN blood_components bc ON bc.id = br.component_id
      LEFT JOIN institutions rh ON rh.id = br.requesting_institution_id
      LEFT JOIN districts dist ON dist.id = br.requesting_hospital_district_id
          WHERE dac.chosen_blood_bank_id = $1
            AND dac.status IN ('PE', 'AR')
            AND dac.deadline_at > NOW()
       ORDER BY CASE br.urgency_tier WHEN 'CR' THEN 0 WHEN 'UR' THEN 1 ELSE 2 END,
                dac.expected_arrival_at NULLS LAST,
                dac.accepted_at ASC
          LIMIT 100`,
      [bbId],
    );
    return r.rows;
  });
  openRows(rows, ['donor_name']); // donor name is column-encrypted at rest
  res.json({ incoming: rows, count: rows.length });
});

// ── POST /inventory/incoming-donors/:choiceId/arrived ────────────────────
// BB marks donor as physically present. Doesn't create a bag yet — that
// happens via POST /donations which then auto-attributes to this choice.
router.post(
  '/incoming-donors/:choiceId/arrived',
  verifyJWT,
  requireRole('blood_bank'),
  async (req, res) => {
    const bbId = req.user.institutionId;
    if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });

    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE donor_alert_choices
              SET status = 'AR',
                  arrived_at = COALESCE(arrived_at, clock_timestamp())
            WHERE id = $1
              AND chosen_blood_bank_id = $2
              AND status = 'PE'
        RETURNING id, status, arrived_at`,
          [req.params.choiceId, bbId],
        ),
      { change_reason: 'BB marks donor arrived' },
    );
    if (r.rowCount === 0) return res.status(409).json({ error: 'choice_not_in_pending_state' });
    res.json(r.rows[0]);
  },
);

// ── POST /inventory/incoming-donors/:choiceId/no-show ────────────────────
router.post(
  '/incoming-donors/:choiceId/no-show',
  verifyJWT,
  requireRole('blood_bank'),
  async (req, res) => {
    const bbId = req.user.institutionId;
    if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });

    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE donor_alert_choices
              SET status = 'NS',
                  no_show_at = clock_timestamp()
            WHERE id = $1
              AND chosen_blood_bank_id = $2
              AND status IN ('PE', 'AR')
        RETURNING id, status`,
          [req.params.choiceId, bbId],
        ),
      { change_reason: 'BB marks donor no-show' },
    );
    if (r.rowCount === 0) return res.status(409).json({ error: 'choice_not_active' });
    res.json(r.rows[0]);
  },
);

// ── POST /inventory/incoming-donors/:choiceId/deferred ───────────────────
const deferredSchema = z.object({ reason: z.string().min(3).max(500) });
router.post(
  '/incoming-donors/:choiceId/deferred',
  verifyJWT,
  requireRole('blood_bank'),
  async (req, res) => {
    const bbId = req.user.institutionId;
    if (!bbId) return res.status(403).json({ error: 'blood_bank_user_missing_institution' });
    const parsed = deferredSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE donor_alert_choices
              SET status = 'DE',
                  deferred_reason = $3
            WHERE id = $1
              AND chosen_blood_bank_id = $2
              AND status IN ('PE', 'AR')
        RETURNING id, status`,
          [req.params.choiceId, bbId, parsed.data.reason],
        ),
      { change_reason: 'BB defers donor at intake' },
    );
    if (r.rowCount === 0) return res.status(409).json({ error: 'choice_not_active' });
    res.json(r.rows[0]);
  },
);

module.exports = router;
