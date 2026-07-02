const crypto = require('crypto');

const OTP_LENGTH = 6;
const OTP_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MIN = 30;
// Pilot-friendly default: 20 sends/mobile/hour. Tunable via env
// OTP_SEND_RATE_LIMIT_PER_HOUR. Threat model is DoS + brute-force; brute
// force is the /verify path (separate MAX_ATTEMPTS cap of 5). Send abuse
// costs Meta a WhatsApp session (well under Meta India free tier at pilot
// scale). Tighten to 5–10 for steady state; loosen for demo weeks.
const RATE_LIMIT_PER_HOUR = parseInt(process.env.OTP_SEND_RATE_LIMIT_PER_HOUR || '20', 10);

function generate() {
  // 6-digit OTP, leading zeros allowed.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(OTP_LENGTH, '0');
}

function hash(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function constantTimeEquals(a, b) {
  const ab = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = {
  generate,
  hash,
  constantTimeEquals,
  OTP_LENGTH,
  OTP_TTL_MIN,
  MAX_ATTEMPTS,
  LOCK_DURATION_MIN,
  RATE_LIMIT_PER_HOUR,
};
