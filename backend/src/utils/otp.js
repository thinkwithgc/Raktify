const crypto = require('crypto');

const OTP_LENGTH = 6;
const OTP_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MIN = 30;
const RATE_LIMIT_PER_HOUR = 3;

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
