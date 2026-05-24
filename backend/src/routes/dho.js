/**
 * District Health Officer (DHO) dashboard routes.
 *
 *   GET /dho/dashboard          KPI bundle for the DHO's district
 *   GET /dho/compliance         per-institution compliance matrix
 *   GET /dho/shortages          live inventory grid (8 groups × N components)
 *   GET /dho/critical-timeline  recent critical-tier requests
 *   GET /dho/hemovigilance      lookback + reactive TTI summary
 *
 * All endpoints are read-only, district-scoped (from req.user.districtId),
 * and return only aggregates — never donor / patient PII. The runtime
 * elevates RLS to actor_role='system' so the cross-table reads against
 * institutions / donations / inventory / requests / screening succeed even
 * though the DHO isn't a coordinator or institutional user.
 */
const express = require('express');

const { withRlsContextRaw } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');

const router = express.Router();

// Sliding window length, days. Picked to match the DHO's monthly-report cadence.
const DEFAULT_WINDOW_DAYS = 30;

function requireDistrict(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  if (req.user.role !== 'dho') return res.status(403).json({ error: 'forbidden' });
  if (!req.user.districtId) return res.status(403).json({ error: 'dho_district_not_set' });
  next();
}

function windowDays(req) {
  const n = Number(req.query.window_days);
  if (Number.isFinite(n) && n > 0 && n <= 365) return Math.floor(n);
  return DEFAULT_WINDOW_DAYS;
}

// ── GET /dho/dashboard ───────────────────────────────────────────────────
router.get(
  '/dashboard',
  verifyJWT,
  requireRole('dho', 'ngo_admin', 'super_admin'),
  requireDistrict,
  async (req, res) => {
    const days = windowDays(req);
    const districtId = req.user.districtId;

    const data = await withRlsContextRaw(
      { actor_role: 'system', change_reason: 'DHO dashboard read' },
      async (c) => {
        // 1. Donations in the district this window
        const donations = (
          await c.query(
            `SELECT COUNT(*)::int AS count
               FROM donation_history dh
               JOIN institutions i ON i.id = dh.blood_bank_id
              WHERE i.district_id = $1
                AND dh.collection_date >= CURRENT_DATE - $2::int`,
            [districtId, days],
          )
        ).rows[0];

        // 2. Emergency requests in the district this window
        const requests = (
          await c.query(
            `SELECT
               COUNT(*) FILTER (WHERE br.raised_at >= NOW() - ($2 || ' days')::interval)::int AS raised,
               COUNT(*) FILTER (WHERE br.status = 'CL'
                                AND br.closed_at >= NOW() - ($2 || ' days')::interval)::int   AS fulfilled,
               COUNT(*) FILTER (WHERE br.status = 'EX'
                                AND br.raised_at >= NOW() - ($2 || ' days')::interval)::int   AS expired,
               COUNT(*) FILTER (WHERE br.urgency_tier = 'CR'
                                AND br.raised_at >= NOW() - ($2 || ' days')::interval)::int   AS critical_raised,
               COUNT(*) FILTER (WHERE br.urgency_tier = 'CR'
                                AND br.status = 'CL'
                                AND br.closed_at >= NOW() - ($2 || ' days')::interval
                                AND EXTRACT(EPOCH FROM (br.closed_at - br.raised_at)) < 14400)::int AS critical_within_4h,
               COALESCE(
                 AVG(EXTRACT(EPOCH FROM (br.fulfilled_at - br.raised_at)))
                   FILTER (WHERE br.status IN ('CL','FU')
                           AND br.raised_at >= NOW() - ($2 || ' days')::interval),
                 0
               )::int AS avg_fulfilment_seconds
             FROM blood_requests br
            WHERE br.requesting_hospital_district_id = $1`,
            [districtId, String(days)],
          )
        ).rows[0];

        // 3. Lives saved estimate (verified donations × 3 — same heuristic as
        //    the donor badge UI)
        const livesEstimate = donations.count * 3;

        // 4. Wastage prevented: bags issued/transfused this window vs bags
        //    that expired. Crude but tellable.
        const wastage = (
          await c.query(
            `SELECT
               COUNT(*) FILTER (WHERE bi.status IN ('IS','TR')
                                AND bi.status_changed_at >= NOW() - ($2 || ' days')::interval)::int AS bags_used,
               COUNT(*) FILTER (WHERE bi.status = 'EX'
                                AND bi.status_changed_at >= NOW() - ($2 || ' days')::interval)::int AS bags_expired
             FROM blood_inventory bi
             JOIN institutions i ON i.id = bi.blood_bank_id
            WHERE i.district_id = $1`,
            [districtId, String(days)],
          )
        ).rows[0];

        // 5. Active institutions in the district
        const institutions = (
          await c.query(
            `SELECT
               COUNT(*) FILTER (WHERE kind = 'HO' AND onboarding_status = 'AC')::int AS active_hospitals,
               COUNT(*) FILTER (WHERE kind = 'BB' AND onboarding_status = 'AC')::int AS active_blood_banks,
               COUNT(*) FILTER (WHERE onboarding_status = 'PE')::int AS pending_applications
             FROM institutions
            WHERE district_id = $1`,
            [districtId],
          )
        ).rows[0];

        // 6. Camps held this window in the district
        const camps = (
          await c.query(
            `SELECT
               COUNT(*) FILTER (WHERE scheduled_date >= CURRENT_DATE - $2::int
                                AND status IN ('CO','LV'))::int AS held_recent,
               COUNT(*) FILTER (WHERE scheduled_date >= CURRENT_DATE
                                AND status IN ('PL','LV'))::int AS upcoming,
               COALESCE(SUM(units_collected)
                 FILTER (WHERE scheduled_date >= CURRENT_DATE - $2::int
                         AND status = 'CO'), 0)::int AS units_from_camps
             FROM donation_camps
            WHERE district_id = $1`,
            [districtId, days],
          )
        ).rows[0];

        // 7. District metadata
        const district = (
          await c.query(`SELECT id, name FROM districts WHERE id = $1`, [districtId])
        ).rows[0];

        return {
          district,
          window_days: days,
          kpis: {
            donations: donations.count,
            requests_raised: requests.raised,
            requests_fulfilled: requests.fulfilled,
            requests_expired: requests.expired,
            critical_raised: requests.critical_raised,
            critical_within_4h: requests.critical_within_4h,
            critical_within_4h_pct:
              requests.critical_raised > 0
                ? Math.round((100 * requests.critical_within_4h) / requests.critical_raised)
                : null,
            avg_fulfilment_seconds: requests.avg_fulfilment_seconds || 0,
            lives_saved_estimate: livesEstimate,
            bags_used: wastage.bags_used,
            bags_expired: wastage.bags_expired,
            wastage_rate_pct:
              wastage.bags_used + wastage.bags_expired > 0
                ? Math.round(
                    (100 * wastage.bags_expired) / (wastage.bags_used + wastage.bags_expired),
                  )
                : null,
            active_hospitals: institutions.active_hospitals,
            active_blood_banks: institutions.active_blood_banks,
            pending_applications: institutions.pending_applications,
            camps_held: camps.held_recent,
            camps_upcoming: camps.upcoming,
            units_from_camps: camps.units_from_camps,
          },
        };
      },
    );

    res.json(data);
  },
);

// ── GET /dho/compliance ──────────────────────────────────────────────────
// Per-institution compliance grid. Each row is a hospital or blood bank;
// columns describe its operational health on the platform.
router.get(
  '/compliance',
  verifyJWT,
  requireRole('dho', 'ngo_admin', 'super_admin'),
  requireDistrict,
  async (req, res) => {
    const days = windowDays(req);
    const districtId = req.user.districtId;

    const rows = await withRlsContextRaw(
      { actor_role: 'system', change_reason: 'DHO compliance read' },
      (c) =>
        c.query(
          `SELECT
             i.id, i.kind, i.legal_name, i.display_name, i.shortname,
             i.onboarding_status,
             i.cdsco_licence_number, i.cdsco_licence_expires,
             (SELECT MAX(dh.collection_date) FROM donation_history dh
                WHERE dh.blood_bank_id = i.id)                            AS last_donation,
             (SELECT MAX(br.raised_at) FROM blood_requests br
                WHERE br.requesting_institution_id = i.id)                AS last_request,
             (SELECT COUNT(*)::int FROM donation_history dh
                WHERE dh.blood_bank_id = i.id
                  AND dh.collection_date >= CURRENT_DATE - $2::int)       AS donations_recent,
             (SELECT COUNT(*)::int FROM donor_screening ds
                JOIN donation_history dh ON dh.id = ds.donation_id
               WHERE dh.blood_bank_id = i.id
                 AND dh.collection_date >= CURRENT_DATE - $2::int
                 AND ds.overall_clearance IN ('CL','IN'))                 AS screenings_completed,
             (SELECT COUNT(*)::int FROM donor_screening ds
                JOIN donation_history dh ON dh.id = ds.donation_id
               WHERE dh.blood_bank_id = i.id
                 AND dh.collection_date >= CURRENT_DATE - $2::int
                 AND ds.verified_at IS NOT NULL
                 AND ds.entered_by IS DISTINCT FROM ds.verified_by)       AS screenings_4eyes_verified,
             (SELECT COUNT(*)::int FROM blood_requests br
                WHERE br.requesting_institution_id = i.id
                  AND br.raised_at >= NOW() - ($2 || ' days')::interval)  AS requests_recent,
             (SELECT COUNT(*)::int FROM blood_requests br
                WHERE br.requesting_institution_id = i.id
                  AND br.status = 'CL'
                  AND br.closed_at >= NOW() - ($2 || ' days')::interval)  AS requests_fulfilled_recent
           FROM institutions i
          WHERE i.district_id = $1
            AND i.onboarding_status IN ('AC','SU')
       ORDER BY i.kind, i.display_name`,
          [districtId, String(days)],
        ),
    );

    // Compute a simple compliance grade per row.
    const institutions = rows.rows.map((r) => {
      let grade = 'A';
      const reasons = [];

      // Licence expiry warnings (blood banks only)
      if (r.cdsco_licence_expires) {
        const days = Math.floor(
          (new Date(r.cdsco_licence_expires).getTime() - Date.now()) / 86400000,
        );
        if (days < 0) {
          grade = 'F';
          reasons.push(`CDSCO licence expired ${-days} days ago`);
        } else if (days < 60) {
          grade = grade < 'C' ? 'C' : grade;
          reasons.push(`CDSCO licence expires in ${days} days`);
        }
      }

      // 4-eyes verification coverage (blood banks only)
      if (r.kind === 'BB' && r.screenings_completed > 0) {
        const pct = (100 * r.screenings_4eyes_verified) / r.screenings_completed;
        if (pct < 90) {
          grade = grade < 'C' ? 'C' : grade;
          reasons.push(`Only ${Math.round(pct)}% of screenings have 4-eyes verification`);
        }
      }

      // Activity (no donations / no requests this window)
      if (r.kind === 'BB' && r.donations_recent === 0) {
        grade = grade < 'B' ? 'B' : grade;
        reasons.push('No donations recorded this window');
      }
      if (r.kind === 'HO' && r.requests_recent === 0) {
        // Hospitals not raising requests isn't necessarily bad, just notable
        reasons.push('No requests raised this window');
      }

      return { ...r, compliance_grade: grade, compliance_reasons: reasons };
    });

    res.json({ window_days: days, institutions });
  },
);

// ── GET /dho/shortages ───────────────────────────────────────────────────
router.get(
  '/shortages',
  verifyJWT,
  requireRole('dho', 'ngo_admin', 'super_admin'),
  requireDistrict,
  async (req, res) => {
    const districtId = req.user.districtId;

    const grid = await withRlsContextRaw(
      { actor_role: 'system', change_reason: 'DHO shortage map read' },
      (c) =>
        c.query(
          `SELECT bg.code AS blood_group, bc.code AS component,
                  COUNT(*) FILTER (WHERE bi.status = 'AV'
                                   AND bi.is_recalled = FALSE
                                   AND bi.expiry_date > CURRENT_DATE)::int AS available,
                  COUNT(*) FILTER (WHERE bi.status = 'AV'
                                   AND bi.expiry_date <= CURRENT_DATE + 2)::int AS expiring_48h,
                  MIN(bi.expiry_date) FILTER (WHERE bi.status = 'AV') AS earliest_expiry
             FROM blood_inventory bi
             JOIN institutions i ON i.id = bi.blood_bank_id
             JOIN blood_groups bg ON bg.id = bi.blood_group_id
             JOIN blood_components bc ON bc.id = bi.component_id
            WHERE i.district_id = $1
            GROUP BY bg.code, bc.code
            ORDER BY bg.code, bc.code`,
          [districtId],
        ),
    );

    res.json({ shortages: grid.rows });
  },
);

// ── GET /dho/critical-timeline ───────────────────────────────────────────
// Most recent critical-tier requests, with raised → fulfilled timeline.
router.get(
  '/critical-timeline',
  verifyJWT,
  requireRole('dho', 'ngo_admin', 'super_admin'),
  requireDistrict,
  async (req, res) => {
    const days = windowDays(req);
    const districtId = req.user.districtId;

    const rows = await withRlsContextRaw(
      { actor_role: 'system', change_reason: 'DHO critical timeline read' },
      (c) =>
        c.query(
          `SELECT br.id, br.request_number,
                  br.status, br.urgency_tier,
                  bg.code AS blood_group, bc.code AS component,
                  br.units_required, br.units_fulfilled,
                  br.raised_at, br.fulfilled_at, br.closed_at, br.needed_by,
                  i.display_name AS requesting_hospital_name,
                  COALESCE(
                    EXTRACT(EPOCH FROM (br.fulfilled_at - br.raised_at))::int,
                    NULL
                  ) AS fulfilment_seconds
             FROM blood_requests br
             JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
             JOIN blood_components bc ON bc.id = br.component_id
        LEFT JOIN institutions i ON i.id = br.requesting_institution_id
            WHERE br.requesting_hospital_district_id = $1
              AND br.urgency_tier = 'CR'
              AND br.raised_at >= NOW() - ($2 || ' days')::interval
         ORDER BY br.raised_at DESC
            LIMIT 30`,
          [districtId, String(days)],
        ),
    );

    res.json({ window_days: days, critical_requests: rows.rows });
  },
);

// ── GET /dho/hemovigilance ───────────────────────────────────────────────
// District-scoped lookback + reactive-TTI summary. Mirrors the structure of
// the /reports/hemovigilance endpoint but is scoped to this DHO's district.
router.get(
  '/hemovigilance',
  verifyJWT,
  requireRole('dho', 'ngo_admin', 'super_admin'),
  requireDistrict,
  async (req, res) => {
    const days = windowDays(req);
    const districtId = req.user.districtId;

    const data = await withRlsContextRaw(
      { actor_role: 'system', change_reason: 'DHO hemovigilance read' },
      async (c) => {
        const lookback = (
          await c.query(
            `SELECT
               COUNT(*) FILTER (WHERE created_at >= NOW() - ($2 || ' days')::interval)::int AS opened,
               COUNT(*) FILTER (WHERE closed_at IS NOT NULL
                                AND closed_at >= NOW() - ($2 || ' days')::interval)::int   AS closed,
               COUNT(*) FILTER (WHERE closed_at IS NULL
                                AND created_at < NOW() - INTERVAL '14 days')::int            AS overdue,
               COALESCE(
                 AVG(EXTRACT(EPOCH FROM (closed_at - created_at)))
                   FILTER (WHERE closed_at IS NOT NULL
                           AND closed_at >= NOW() - ($2 || ' days')::interval),
                 0
               )::int AS avg_resolution_seconds
             FROM lookback_registry lr
             JOIN donation_history dh ON dh.id = lr.donation_id
             JOIN institutions i      ON i.id = dh.blood_bank_id
            WHERE i.district_id = $1`,
            [districtId, String(days)],
          )
        ).rows[0];

        const reactive = (
          await c.query(
            `SELECT
               COUNT(*) FILTER (WHERE ds.hiv_status = 'RR')::int      AS hiv,
               COUNT(*) FILTER (WHERE ds.hbsag_status = 'RR')::int    AS hbsag,
               COUNT(*) FILTER (WHERE ds.hcv_status = 'RR')::int      AS hcv,
               COUNT(*) FILTER (WHERE ds.syphilis_status = 'RR')::int AS syphilis,
               COUNT(*) FILTER (WHERE ds.malaria_status = 'RR')::int  AS malaria,
               COUNT(*) FILTER (WHERE ds.overall_clearance = 'CL')::int AS cleared_total,
               COUNT(*) FILTER (WHERE ds.overall_clearance = 'IN')::int AS investigation_total
             FROM donor_screening ds
             JOIN donation_history dh ON dh.id = ds.donation_id
             JOIN institutions i      ON i.id = dh.blood_bank_id
            WHERE i.district_id = $1
              AND ds.entered_at >= NOW() - ($2 || ' days')::interval`,
            [districtId, String(days)],
          )
        ).rows[0];

        return {
          window_days: days,
          lookback,
          reactive_tti: reactive,
          adverse_reactions: { reported: 0, note: 'adverse_reaction_table_pending' },
        };
      },
    );

    res.json(data);
  },
);

module.exports = router;
