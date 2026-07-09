/**
 * verifyJWT — extracts Bearer token, verifies, fetches the platform_users
 * row to confirm not-locked, attaches { userId, role, institutionId, sessionId }
 * to req.user. Returns 401 on any failure.
 *
 * requireRole(...roles) — gates the route to a whitelist of roles.
 *
 * requireInstitution — for hospital/blood_bank, verifies that the
 * institution_id in the URL params or body matches req.user.institutionId.
 */
const { verify } = require('../utils/jwt');
const { pool } = require('../config/db');
const logger = require('../config/logger');

// The only endpoints a TOTP-pending (`tp`) enrolment token may reach. Every
// other route is blocked until the staff member finishes 2FA enrolment.
const TOTP_ENROLL_PATHS = new Set([
  '/auth/institutional/setup-totp',
  '/auth/institutional/confirm-totp',
]);

async function verifyJWT(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) return res.status(401).json({ error: 'missing_token' });

  let payload;
  try {
    payload = verify(m[1]);
  } catch (err) {
    logger.debug({ err: err.message }, 'JWT verify failed');
    return res.status(401).json({ error: 'invalid_token' });
  }

  // Verify the user still exists and is not locked.
  const r = await pool.query(
    'SELECT id, role, institution_id, district_id, is_locked FROM platform_users WHERE id = $1',
    [payload.sub],
  );
  if (r.rowCount === 0) return res.status(401).json({ error: 'user_not_found' });
  const u = r.rows[0];
  if (u.is_locked) return res.status(403).json({ error: 'account_locked' });
  if (u.role !== payload.role) return res.status(401).json({ error: 'role_mismatch' });

  // Enforce 2FA enrolment: a `tp` token can only reach the enrolment endpoints.
  // req.baseUrl + req.path reconstructs the full mounted path (req.path alone
  // is router-relative).
  if (payload.tp && !TOTP_ENROLL_PATHS.has(req.baseUrl + req.path)) {
    return res.status(403).json({ error: 'totp_enrollment_required' });
  }

  req.user = {
    userId: u.id,
    role: u.role,
    institutionId: u.institution_id,
    districtId: u.district_id,
    sessionId: payload.sid,
    totpPending: payload.tp === true,
  };
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

function requireInstitution(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  if (!['hospital', 'blood_bank'].includes(req.user.role)) {
    return next(); // not a staff role; nothing to check
  }
  const wantedId = req.params.id || req.body.institution_id;
  if (wantedId && wantedId !== req.user.institutionId) {
    return res.status(403).json({ error: 'institution_mismatch' });
  }
  next();
}

module.exports = { verifyJWT, requireRole, requireInstitution };
