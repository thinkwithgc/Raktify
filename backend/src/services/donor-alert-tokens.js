/**
 * Donor-alert one-tap token (V2 spec — public-link auth).
 *
 * When a donor gets a WhatsApp alert, the URL button carries a signed token
 * that encodes (alert_id, donor_id). Donor taps → lands on /alert/:token →
 * public endpoint verifies the token → shows the alert without OTP.
 *
 * Signed with the existing JWT_SECRET but with sub='donor-alert' so it can
 * never be confused with a session token by the auth middleware.
 *
 * Expiry sized to the request's escalation window (CRITICAL 90 min, URGENT
 * 6 hr, PLANNED 72 hr) — long enough to see + decide, short enough that a
 * leaked link ages out.
 */
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const TOKEN_SUB = 'donor-alert';

function ttlSecondsFor(urgencyTier) {
  if (urgencyTier === 'CR') return 90 * 60;
  if (urgencyTier === 'UR') return 6 * 60 * 60;
  return 72 * 60 * 60;
}

/**
 * Mint a token for one (alert, donor) pair. Called by the notification
 * dispatcher when preparing the WhatsApp template payload.
 */
function mintDonorAlertToken({ alertId, donorId, urgencyTier }) {
  const expiresIn = ttlSecondsFor(urgencyTier);
  return jwt.sign(
    {
      sub: TOKEN_SUB,
      alertId,
      donorId,
    },
    env.jwt.secret,
    { expiresIn },
  );
}

/**
 * Verify a token from the URL. Returns { ok: true, alertId, donorId } on
 * success, { ok: false, error } on any failure (invalid signature, expired,
 * wrong sub claim).
 */
function verifyDonorAlertToken(token) {
  try {
    const payload = jwt.verify(token, env.jwt.secret);
    if (payload.sub !== TOKEN_SUB) {
      return { ok: false, error: 'wrong_token_kind' };
    }
    if (!payload.alertId || !payload.donorId) {
      return { ok: false, error: 'malformed_token' };
    }
    return { ok: true, alertId: payload.alertId, donorId: payload.donorId };
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { ok: false, error: 'token_expired' };
    return { ok: false, error: 'token_invalid' };
  }
}

module.exports = { mintDonorAlertToken, verifyDonorAlertToken };
