/**
 * Community-leader self-service endpoints (Phase 1).
 *
 *   GET  /community-leader/me      — own profile + summary stats
 *
 * Phase 2 will add: communities CRUD, co-leader mgmt, community stats.
 * Phase 3 will add: donor roster (limited PII), referral link, camp wiring.
 */
const express = require('express');

const { pool } = require('../config/db');
const { verifyJWT, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/me', verifyJWT, requireRole('community_leader'), async (req, res) => {
  // Pull the profile + the joined geo names + lookup-friendly counters.
  // RLS (migration 272) restricts community_leader to their own row.
  const r = await pool.query(
    `SELECT cl.id, cl.display_name, cl.full_name,
            cl.date_of_birth, cl.gender, cl.preferred_language,
            cl.email, cl.whatsapp_number,
            cl.id_proof_type, cl.id_proof_last4, cl.id_verified_at,
            cl.invitation_notes,
            cl.communities_count, cl.total_donor_count,
            cl.donations_facilitated, cl.camps_hosted,
            cl.joined_at, cl.is_active,
            cl.suspended_at, cl.suspension_reason,
            pu.mobile, pu.last_login_at,
            s.name AS state_name,
            d.name AS district_name
       FROM community_leaders cl
       JOIN platform_users pu ON pu.id = cl.platform_user_id
       LEFT JOIN states    s ON s.id = cl.state_id
       LEFT JOIN districts d ON d.id = cl.district_id
      WHERE cl.platform_user_id = $1`,
    [req.user.userId],
  );

  if (r.rowCount === 0) {
    // The JWT says they're a community_leader but no profile row exists.
    // Should not happen in production (the invite flow inserts both); could
    // happen mid-migration. 404 + clear message helps the user contact admin.
    return res.status(404).json({ error: 'profile_not_found' });
  }

  res.json({ profile: r.rows[0] });
});

module.exports = router;
