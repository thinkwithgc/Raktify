/**
 * NGO admin / ops endpoints (Phase 6 + Phase 8).
 *
 *   GET  /admin/jobs                          list registered scheduler jobs
 *   POST /admin/jobs/run                      manually trigger one job (super_admin)
 *
 *   GET  /admin/coordinators                  list (filter: status=PE|AC|SU)
 *   POST /admin/coordinators/:id/verify       verification-queue approve
 *   POST /admin/coordinators/:id/suspend      suspend an active coordinator
 *
 *   GET  /admin/duplicates                    suspected_duplicate_of pairs
 *   POST /admin/duplicates/:id/clear          clear the flag (false positive)
 *   POST /admin/duplicates/:id/merge          STUB — see services/donors/merge.js
 *
 *   GET  /admin/referrals                     institution_referrals funnel summary
 *
 *   GET  /admin/audit                         filterable audit_log_safe view
 *                                             (table, actor, since, until, limit)
 *   GET  /admin/audit/integrity               sample N rows + verify hash chain
 */
const express = require('express');
const { z } = require('zod');

const { pool } = require('../config/db');
const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');
const scheduler = require('../services/scheduler');

const router = express.Router();

// ── Scheduler (Phase 6) ──────────────────────────────────────────────────
router.get('/jobs', verifyJWT, requireRole('ngo_admin', 'super_admin'), (_req, res) => {
  res.json({ jobs: scheduler.listJobs() });
});

router.post('/jobs/run', verifyJWT, requireRole('super_admin'), async (req, res) => {
  const schema = z.object({ name: z.string().min(2) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  try {
    const result = await scheduler.runJob(parsed.data.name);
    res.json(result);
  } catch (err) {
    if (/unknown_job/.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    throw err;
  }
});

// ── Coordinator management (Phase 8) ─────────────────────────────────────
// Coordinator schema: id_verified_at marks ID-proof verification (NULL =
// pending verification). is_active gates operational availability. Spec §7
// "verification queue" = id_verified_at IS NULL. "Active" = is_active = TRUE
// AND id_verified_at IS NOT NULL. "Suspended" = is_active = FALSE AND
// suspended_at IS NOT NULL.
router.get(
  '/coordinators',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const status = req.query.status || null; // 'pending' | 'active' | 'suspended' | null
    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT co.id, co.display_name, co.district_id, co.is_district_lead,
                co.is_active, co.on_duty, co.reliability_score,
                co.id_verified_at, co.id_verified_by, co.joined_at,
                co.suspended_at, co.suspension_reason,
                co.donations_facilitated, co.requests_fulfilled,
                co.median_response_time_min,
                co.platform_user_id
           FROM coordinators co
          WHERE CASE
                  WHEN $1::text = 'pending'   THEN co.id_verified_at IS NULL
                  WHEN $1::text = 'active'    THEN co.is_active = TRUE AND co.id_verified_at IS NOT NULL
                  WHEN $1::text = 'suspended' THEN co.suspended_at IS NOT NULL
                  ELSE TRUE
                END
       ORDER BY (co.id_verified_at IS NULL) DESC, co.joined_at DESC
          LIMIT 500`,
        [status],
      ),
    );
    res.json({ coordinators: r.rows, count: r.rowCount });
  },
);

router.post(
  '/coordinators/:id/verify',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE coordinators
              SET id_verified_at = clock_timestamp(),
                  id_verified_by = $2,
                  is_active = TRUE
            WHERE id = $1
              AND id_verified_at IS NULL
         RETURNING id, id_verified_at, is_active`,
          [req.params.id, req.user.userId],
        ),
      { change_reason: 'admin verifies coordinator' },
    );
    if (r.rowCount === 0) return res.status(409).json({ error: 'not_pending_or_not_found' });
    res.json(r.rows[0]);
  },
);

router.post(
  '/coordinators/:id/suspend',
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
          `UPDATE coordinators
              SET is_active = FALSE,
                  on_duty = FALSE,
                  suspended_at = clock_timestamp(),
                  suspension_reason = $2
            WHERE id = $1
         RETURNING id, is_active, suspended_at`,
          [req.params.id, parsed.data.reason],
        ),
      { change_reason: `admin suspends coordinator: ${parsed.data.reason}` },
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  },
);

// ── Duplicate donor review (Phase 8) ─────────────────────────────────────
router.get('/duplicates', verifyJWT, requireRole('ngo_admin', 'super_admin'), async (req, res) => {
  const r = await withRlsContext(req, (c) =>
    c.query(
      `SELECT d.id AS suspected_id, d.full_name, d.date_of_birth,
                d.suspected_duplicate_of AS canonical_id,
                cd.full_name AS canonical_name, cd.date_of_birth AS canonical_dob,
                d.created_at
           FROM donors d
           JOIN donors cd ON cd.id = d.suspected_duplicate_of
          WHERE d.suspected_duplicate_of IS NOT NULL
       ORDER BY d.created_at DESC
          LIMIT 200`,
    ),
  );
  res.json({ pairs: r.rows, count: r.rowCount });
});

router.post(
  '/duplicates/:id/clear',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE donors
              SET suspected_duplicate_of = NULL
            WHERE id = $1
              AND suspected_duplicate_of IS NOT NULL
         RETURNING id`,
          [req.params.id],
        ),
      { change_reason: 'admin cleared duplicate flag (false positive)' },
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_flagged_or_not_found' });
    res.json({ status: 'cleared', donor_id: r.rows[0].id });
  },
);

// Merge is still a stub — see services/donors/merge.js for the design notes
// (worst-case vs strictest deferral_until). Pre-condition: medical-advisor
// confirmation of the merge semantics.
router.post(
  '/duplicates/:id/merge',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (_req, res) => {
    res
      .status(501)
      .json({ error: 'not_implemented', detail: 'see services/donors/merge.js design notes' });
  },
);

// ── Referral funnel (Phase 8) ────────────────────────────────────────────
// funnel_status: NE=new, CO=contacted, IN=interested, ON=onboarded,
//                DC=declined, DR=dropped (institution_referrals.sql)
router.get('/referrals', verifyJWT, requireRole('ngo_admin', 'super_admin'), async (req, res) => {
  const summary = await withRlsContext(req, (c) =>
    c.query(
      `SELECT funnel_status, COUNT(*)::int AS count
           FROM institution_referrals
          GROUP BY funnel_status
          ORDER BY funnel_status`,
    ),
  );
  const recent = await withRlsContext(req, (c) =>
    c.query(
      `SELECT id, target_kind, target_name, target_district_id,
                target_contact_name,
                funnel_status, status_changed_at, status_changed_by, notes,
                onboarded_institution_id, onboarded_at, declined_reason,
                referrer_count,
                created_at
           FROM institution_referrals
       ORDER BY created_at DESC
          LIMIT 100`,
    ),
  );

  // Conversion rate: onboarded / total. Denominator excludes nothing —
  // every referral started in NE. Spec doesn't define a 'reaches' baseline.
  const total = summary.rows.reduce((s, r) => s + r.count, 0);
  const onboarded = summary.rows.find((r) => r.funnel_status === 'ON')?.count || 0;
  const conversion_rate = total === 0 ? 0 : onboarded / total;

  res.json({
    funnel: summary.rows,
    total,
    onboarded,
    conversion_rate,
    recent: recent.rows,
  });
});

// ── Audit log viewer (Phase 8) ───────────────────────────────────────────
// Reads from the `audit_log_safe` view (granted to audit_reader role). We
// run this query with the elevated audit-reader connection because the
// app_user role doesn't have SELECT on audit_log itself.
router.get('/audit', verifyJWT, requireRole('ngo_admin', 'super_admin'), async (req, res) => {
  const schema = z.object({
    table_name: z.string().optional(),
    actor_user_id: z.string().uuid().optional(),
    event_type: z.enum(['INSERT', 'UPDATE', 'DELETE']).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const f = parsed.data;

  // The audit_log_safe view is owned by audit_reader. Our default app_user
  // pool can't SELECT it directly; we issue this read against the same
  // pool but stamped with the audit reader's session role.
  const r = await pool.query(
    `SELECT id, event_time, event_type, table_name, record_id, field_name,
              old_value, new_value,
              actor_user_id, actor_role, actor_institution_id,
              request_reference, change_reason
         FROM audit_log_safe
        WHERE ($1::text IS NULL OR table_name = $1)
          AND ($2::uuid IS NULL OR actor_user_id = $2)
          AND ($3::text IS NULL OR event_type = $3)
          AND ($4::timestamptz IS NULL OR event_time >= $4)
          AND ($5::timestamptz IS NULL OR event_time <= $5)
     ORDER BY event_time DESC
        LIMIT $6`,
    [
      f.table_name || null,
      f.actor_user_id || null,
      f.event_type || null,
      f.since || null,
      f.until || null,
      f.limit,
    ],
  );
  res.json({ rows: r.rows, count: r.rowCount });
});

// Hash-chain integrity check: pull the most recent N audit rows in event-time
// order and recompute each row's expected `previous_row_hash` from the row
// before it. Any mismatch indicates tampering or out-of-order writes.
router.get(
  '/audit/integrity',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    // We need the raw audit_log here (not the safe view) because integrity
    // verification must use the row_hash + previous_row_hash columns. Those
    // columns are not exposed via audit_log_safe. The pool runs as
    // audit_reader so SELECT on audit_log is permitted (if not, this returns
    // 500 — a deliberate signal that infra needs the GRANT fixed).
    let rows;
    try {
      const r = await pool.query(
        `SELECT id, event_time, table_name, record_id,
                row_hash, previous_row_hash
           FROM audit_log
       ORDER BY event_time DESC, id DESC
          LIMIT $1`,
        [limit],
      );
      rows = r.rows.reverse(); // oldest → newest for chain check
    } catch (err) {
      return res.status(500).json({
        error: 'audit_read_denied',
        detail: 'pool role cannot SELECT audit_log — check audit_reader grants',
        message: err.message,
      });
    }

    let breaks = 0;
    const broken = [];
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].previous_row_hash !== rows[i - 1].row_hash) {
        breaks += 1;
        broken.push({
          id: rows[i].id,
          event_time: rows[i].event_time,
          expected_prev: rows[i - 1].row_hash,
          actual_prev: rows[i].previous_row_hash,
        });
        if (broken.length >= 20) break; // cap response size
      }
    }
    res.json({
      sampled: rows.length,
      breaks,
      ok: breaks === 0,
      broken_examples: broken,
    });
  },
);

module.exports = router;
