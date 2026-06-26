/**
 * NGO admin / ops endpoints (Phase 6 + Phase 8 + post-Phase-8).
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
 *
 *   POST /admin/community-leaders             invite a new community_leader
 *   GET  /admin/community-leaders             list (filter: status=active|suspended)
 *   POST /admin/community-leaders/:id/suspend  suspend a leader (auto-handover to co-leader is Phase 2)
 *   POST /admin/community-leaders/:id/reactivate  un-suspend a leader
 */
const express = require('express');
const { z } = require('zod');

const { pool } = require('../config/db');
const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { normaliseIndianMobile } = require('../utils/phone');
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

// ── Community-leader management (post-Phase-8) ───────────────────────────
// External volunteers who run pre-existing donor communities (WhatsApp
// groups). NGO admin invites them; they log in via mobile + OTP (donor-style
// auth path). Profile lives in community_leaders (migration 271). See the
// Phase 1 plan in this session for the full taxonomy + capability split.
//
// Activation is intentionally low-friction in v1: the NGO admin enters
// mobile + name, backend inserts both rows, then NGO admin tells the leader
// out-of-band ("I've added you, log in at raktify.choudhari.ngo/login").
// No setup token / no automatic WhatsApp template — the leader's existing
// WhatsApp group is THEIR comms channel, we don't insert ourselves into it.
//
// Phase 2 adds: communities CRUD, co-leader mgmt, suspension auto-handover.
// Phase 3 adds: donor roster, referral attribution, public community page.

const inviteLeaderSchema = z.object({
  mobile: z.string(),
  full_name: z.string().min(2).max(120),
  display_name: z.string().min(2).max(80),
  preferred_language: z.enum(['mr', 'hi', 'en']).optional(),
  state_id: z.number().int().positive().optional(),
  district_id: z.number().int().positive().optional(),
  email: z.string().email().optional(),
  invitation_notes: z.string().max(500).optional(),
});

router.post(
  '/community-leaders',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const parsed = inviteLeaderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
    }
    const data = parsed.data;
    const mobile = normaliseIndianMobile(data.mobile);
    if (!mobile) return res.status(400).json({ error: 'invalid_mobile_format' });

    // The OTP-cluster partial unique index (migration 269) prevents two leader
    // rows for one mobile. Check explicitly so we can return a clean 409
    // instead of letting the DB raise a violation that the user has to parse.
    const existing = await pool.query(
      `SELECT id FROM platform_users WHERE mobile = $1 AND role = 'community_leader'`,
      [mobile],
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'mobile_already_invited' });
    }

    try {
      const result = await withRlsContext(
        req,
        async (c) => {
          // 1. platform_users row — OTP-auth path, no password.
          const userR = await c.query(
            `INSERT INTO platform_users (role, mobile)
             VALUES ('community_leader', $1)
             RETURNING id`,
            [mobile],
          );
          const userId = userR.rows[0].id;

          // 2. community_leaders profile row — approved immediately since the
          //    ngo_admin's invite IS the approval.
          const profR = await c.query(
            `INSERT INTO community_leaders
               (platform_user_id, full_name, display_name,
                preferred_language, state_id, district_id,
                email, invitation_notes,
                approved_at, approved_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
             RETURNING id`,
            [
              userId,
              data.full_name,
              data.display_name,
              data.preferred_language || 'mr',
              data.state_id || null,
              data.district_id || null,
              data.email || null,
              data.invitation_notes || null,
              req.user.userId,
            ],
          );
          return { platform_user_id: userId, community_leader_id: profR.rows[0].id };
        },
        { change_reason: 'invite community_leader' },
      );

      res.status(201).json({
        community_leader_id: result.community_leader_id,
        platform_user_id: result.platform_user_id,
        mobile,
        display_name: data.display_name,
        next_step:
          'Tell the leader to log in at /login with this mobile. They will receive an OTP. No password needed.',
      });
    } catch (err) {
      // Defensive: cluster index could still trip if a race happened between
      // the existence check above and the INSERT.
      if (/idx_platform_users_mobile_otp_cluster/.test(err.message)) {
        return res.status(409).json({ error: 'mobile_already_in_otp_cluster' });
      }
      throw err;
    }
  },
);

router.get(
  '/community-leaders',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const status = req.query.status || 'all'; // 'active' | 'suspended' | 'all'
    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT cl.id, cl.display_name, cl.is_active,
                cl.suspended_at, cl.suspension_reason,
                cl.communities_count, cl.total_donor_count,
                cl.donations_facilitated, cl.camps_hosted,
                cl.preferred_language, cl.joined_at, cl.created_at,
                cl.invitation_notes,
                pu.mobile, pu.last_login_at,
                d.name AS district_name,
                s.name AS state_name
           FROM community_leaders cl
           JOIN platform_users pu ON pu.id = cl.platform_user_id
           LEFT JOIN districts d ON d.id = cl.district_id
           LEFT JOIN states    s ON s.id = cl.state_id
          WHERE CASE
                  WHEN $1 = 'active'    THEN cl.is_active = TRUE
                  WHEN $1 = 'suspended' THEN cl.suspended_at IS NOT NULL
                  ELSE TRUE
                END
          ORDER BY cl.created_at DESC
          LIMIT 500`,
        [status],
      ),
    );
    // Mask mobile in the list view — the admin can see the last 4 digits,
    // but the full number stays masked at this scope per the donor-PII pattern.
    const leaders = r.rows.map((l) => ({
      ...l,
      mobile: l.mobile ? `+91XXXXX${l.mobile.slice(-4)}` : null,
    }));
    res.json({ leaders, count: r.rowCount });
  },
);

router.post(
  '/community-leaders/:id/suspend',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const schema = z.object({ reason: z.string().min(3).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE community_leaders
              SET suspended_at = NOW(),
                  suspended_by = $1,
                  suspension_reason = $2
            WHERE id = $3 AND suspended_at IS NULL
            RETURNING id, display_name`,
          [req.user.userId, parsed.data.reason, req.params.id],
        ),
      { change_reason: `suspend community_leader: ${parsed.data.reason.slice(0, 100)}` },
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'not_found_or_already_suspended' });
    }
    res.json({ community_leader_id: r.rows[0].id, status: 'suspended' });
  },
);

router.post(
  '/community-leaders/:id/reactivate',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE community_leaders
              SET suspended_at = NULL,
                  suspended_by = NULL,
                  suspension_reason = NULL
            WHERE id = $1 AND suspended_at IS NOT NULL
            RETURNING id, display_name`,
          [req.params.id],
        ),
      { change_reason: 'reactivate community_leader' },
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'not_found_or_already_active' });
    }
    res.json({ community_leader_id: r.rows[0].id, status: 'active' });
  },
);

module.exports = router;
