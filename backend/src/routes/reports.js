/**
 * DHO + hemovigilance reports (Phase 8 spec §10).
 *
 *   GET /reports/district/:district_id/summary?month=YYYY-MM
 *   GET /reports/hemovigilance?month=YYYY-MM
 *   GET /reports/blood-bank/:id/performance?month=YYYY-MM
 *
 * Each route accepts ?format=json (default) or ?format=csv. PDF generation
 * via Puppeteer is intentionally deferred — see Phase 8 status notes.
 *
 * Access:
 *   district summary    — ngo_admin / super_admin / coordinator (own district)
 *   hemovigilance       — ngo_admin / super_admin
 *   bb performance      — ngo_admin / super_admin / blood_bank (own institution)
 */
const express = require('express');

const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Helpers ─────────────────────────────────────────────────────────────
function parseMonth(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1)); // exclusive
  return { start, end, label: s };
}

// CSV serialiser for plain JS objects + arrays of plain objects. We don't
// reach for `csv-stringify` because the surface is small and we control the
// shape — keep the dep tree slim.
function csvEscape(val) {
  if (val == null) return '';
  const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows) {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(cols.map((k) => csvEscape(r[k])).join(','));
  }
  return lines.join('\n') + '\n';
}

function maybeCsv(req, res, payload, sectionsForCsv) {
  if ((req.query.format || '').toLowerCase() !== 'csv') {
    return res.json(payload);
  }
  // For multi-section reports we concatenate the sections separated by a blank
  // line and a `# section: <name>` heading. Simple, machine-readable enough.
  const chunks = [];
  for (const [name, rows] of Object.entries(sectionsForCsv)) {
    chunks.push(`# section: ${name}`);
    chunks.push(rowsToCsv(rows));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${(req.params.id || 'report').replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}.csv"`,
  );
  res.send(chunks.join('\n'));
}

// ── GET /reports/district/:district_id/summary?month=YYYY-MM ─────────────
router.get(
  '/district/:district_id/summary',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin', 'coordinator'),
  async (req, res) => {
    const districtId = parseInt(req.params.district_id, 10);
    if (!Number.isFinite(districtId)) {
      return res.status(400).json({ error: 'invalid_district_id' });
    }
    const month = parseMonth(req.query.month);
    if (!month) return res.status(400).json({ error: 'invalid_month' });

    const requests = await withRlsContext(req, (c) =>
      c.query(
        `SELECT
           COUNT(*) FILTER (WHERE TRUE)                                    AS raised,
           COUNT(*) FILTER (WHERE status = 'CL')                           AS fulfilled,
           COUNT(*) FILTER (WHERE status = 'EX')                           AS expired_unfulfilled,
           AVG(EXTRACT(EPOCH FROM (fulfilled_at - raised_at)))::int        AS avg_response_seconds,
           AVG(EXTRACT(EPOCH FROM (first_match_found_at - raised_at)))::int AS avg_time_to_match_seconds
         FROM blood_requests
         WHERE requesting_hospital_district_id = $1
           AND raised_at >= $2 AND raised_at < $3`,
        [districtId, month.start, month.end],
      ),
    );

    const shortages = await withRlsContext(req, (c) =>
      c.query(
        `SELECT bg.code AS blood_group,
                COUNT(*) FILTER (WHERE br.status = 'EX')::int AS expired_unfulfilled,
                COUNT(*) FILTER (WHERE br.status = 'OP' AND br.urgency_tier = 'CR')::int AS open_critical
           FROM blood_requests br
           JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
          WHERE br.requesting_hospital_district_id = $1
            AND br.raised_at >= $2 AND br.raised_at < $3
          GROUP BY bg.code
          ORDER BY expired_unfulfilled DESC, open_critical DESC`,
        [districtId, month.start, month.end],
      ),
    );

    // Donor pool: donors registered in this district (approximate via village→district join)
    const donors = await withRlsContext(req, (c) =>
      c.query(
        `SELECT COUNT(*)::int AS total_donors,
                COUNT(*) FILTER (WHERE is_available = TRUE)::int AS active_donors
           FROM donors d
      LEFT JOIN villages v ON v.id = d.village_id
      LEFT JOIN talukas t ON t.id = v.taluka_id
          WHERE t.district_id = $1`,
        [districtId],
      ),
    );

    const camps = await withRlsContext(req, (c) =>
      c.query(
        `SELECT COUNT(*)::int AS camp_count,
                COALESCE(SUM(units_collected), 0)::int AS units_collected
           FROM donation_camps
          WHERE district_id = $1
            AND scheduled_date >= $2 AND scheduled_date < $3`,
        [districtId, month.start, month.end],
      ),
    );

    const wastage = await withRlsContext(req, (c) =>
      c.query(
        `SELECT COUNT(*)::int AS expired_units,
                COUNT(*) FILTER (WHERE is_recalled = TRUE)::int AS recalled_units
           FROM blood_inventory bi
           JOIN institutions i ON i.id = bi.blood_bank_id
          WHERE i.district_id = $1
            AND bi.expiry_date >= $2::date AND bi.expiry_date < $3::date
            AND bi.status = 'EX'`,
        [districtId, month.start, month.end],
      ),
    );

    const payload = {
      district_id: districtId,
      month: month.label,
      requests: requests.rows[0],
      shortages: shortages.rows,
      donors: donors.rows[0],
      camps: camps.rows[0],
      wastage: wastage.rows[0],
    };

    return maybeCsv(req, res, payload, {
      summary: [{ ...payload.requests, ...payload.donors, ...payload.camps, ...payload.wastage }],
      shortages: payload.shortages,
    });
  },
);

// ── GET /reports/hemovigilance?month=YYYY-MM ─────────────────────────────
router.get(
  '/hemovigilance',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const month = parseMonth(req.query.month);
    if (!month) return res.status(400).json({ error: 'invalid_month' });

    const lookback = await withRlsContext(req, (c) =>
      c.query(
        `SELECT
           COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::int AS opened,
           COUNT(*) FILTER (WHERE closed_at  >= $1 AND closed_at  < $2)::int AS closed,
           COUNT(*) FILTER (WHERE lookback_status IN ('OP','IP','CN','RV')
                            AND created_at < $2)::int AS still_open_at_period_end
         FROM lookback_registry`,
        [month.start, month.end],
      ),
    );

    const reactiveTti = await withRlsContext(req, (c) =>
      c.query(
        `SELECT
           COUNT(*) FILTER (WHERE hiv_status      = 'RR')::int AS hiv_reactive,
           COUNT(*) FILTER (WHERE hbsag_status    = 'RR')::int AS hbsag_reactive,
           COUNT(*) FILTER (WHERE hcv_status      = 'RR')::int AS hcv_reactive,
           COUNT(*) FILTER (WHERE syphilis_status = 'RR')::int AS syphilis_reactive,
           COUNT(*) FILTER (WHERE malaria_status  = 'RR')::int AS malaria_reactive,
           COUNT(*) FILTER (WHERE nat_status      = 'RR')::int AS nat_reactive
         FROM donor_screening
         WHERE created_at >= $1 AND created_at < $2`,
        [month.start, month.end],
      ),
    );

    // Replacement vs voluntary: donation_history.source codes:
    //   BB=blood-bank chair, RP=replacement (relative), VC=voluntary camp,
    //   ER=emergency call-out, etc. Roll up the spec's voluntary vs replacement.
    const breakdown = await withRlsContext(req, (c) =>
      c.query(
        `SELECT source, COUNT(*)::int AS count
           FROM donation_history
          WHERE collection_date >= $1::date AND collection_date < $2::date
          GROUP BY source
          ORDER BY count DESC`,
        [month.start, month.end],
      ),
    );

    // Adverse transfusion reactions table doesn't exist yet (post-launch).
    // Return 0 + a note so the DHO PDF template can render the section.
    const adverseReactions = { reported: 0, note: 'adverse_reaction_table_pending' };

    const payload = {
      month: month.label,
      adverse_reactions: adverseReactions,
      lookback: lookback.rows[0],
      reactive_tti: reactiveTti.rows[0],
      donation_source_breakdown: breakdown.rows,
    };

    return maybeCsv(req, res, payload, {
      lookback: [payload.lookback],
      reactive_tti: [payload.reactive_tti],
      donation_breakdown: payload.donation_source_breakdown,
    });
  },
);

// ── GET /reports/blood-bank/:id/performance?month=YYYY-MM ────────────────
router.get(
  '/blood-bank/:id/performance',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin', 'blood_bank'),
  async (req, res) => {
    // BB users may only request their own institution.
    if (req.user.role === 'blood_bank' && req.user.institutionId !== req.params.id) {
      return res.status(403).json({ error: 'cross_institution_read_forbidden' });
    }
    const month = parseMonth(req.query.month);
    if (!month) return res.status(400).json({ error: 'invalid_month' });

    const inventoryAccuracy = await withRlsContext(req, (c) =>
      c.query(
        `SELECT
           COUNT(*) FILTER (WHERE dh.collection_date >= $2::date AND dh.collection_date < $3::date)::int
             AS donations_recorded,
           COUNT(bi.id) FILTER (WHERE bi.collection_date >= $2::date AND bi.collection_date < $3::date)::int
             AS bags_present
         FROM donation_history dh
    LEFT JOIN blood_inventory bi ON bi.donation_id = dh.id
        WHERE dh.blood_bank_id = $1`,
        [req.params.id, month.start, month.end],
      ),
    );

    // Fulfilment rate from this BB's matched_blood_bank_id.
    const fulfilment = await withRlsContext(req, (c) =>
      c.query(
        `SELECT
           COUNT(*)::int AS matched_to_us,
           COUNT(*) FILTER (WHERE status = 'CL')::int AS closed_successfully,
           COUNT(*) FILTER (WHERE status = 'EX')::int AS expired_unfulfilled
         FROM blood_requests
         WHERE matched_blood_bank_id = $1
           AND raised_at >= $2 AND raised_at < $3`,
        [req.params.id, month.start, month.end],
      ),
    );

    // Average TTI entry latency: donation collection_date → screening created_at.
    const ttiLatency = await withRlsContext(req, (c) =>
      c.query(
        `SELECT
           AVG(EXTRACT(EPOCH FROM (ds.created_at - (dh.collection_date::timestamptz))))::int
             AS avg_tti_entry_seconds,
           COUNT(ds.id)::int AS screenings_recorded
         FROM donation_history dh
         JOIN donor_screening ds ON ds.donation_id = dh.id
        WHERE dh.blood_bank_id = $1
          AND dh.collection_date >= $2::date AND dh.collection_date < $3::date`,
        [req.params.id, month.start, month.end],
      ),
    );

    const inv = inventoryAccuracy.rows[0];
    const accuracyScore =
      inv.donations_recorded > 0
        ? Math.round((100 * inv.bags_present) / inv.donations_recorded)
        : null;

    const payload = {
      blood_bank_id: req.params.id,
      month: month.label,
      inventory_accuracy: { ...inv, accuracy_score_pct: accuracyScore },
      fulfilment: fulfilment.rows[0],
      tti_latency: ttiLatency.rows[0],
    };

    return maybeCsv(req, res, payload, {
      summary: [
        {
          ...payload.inventory_accuracy,
          ...payload.fulfilment,
          ...payload.tti_latency,
        },
      ],
    });
  },
);

module.exports = router;
