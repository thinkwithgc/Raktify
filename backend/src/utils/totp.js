/**
 * TOTP wrapper around otplib v15.
 *
 * v15 returns plain strings from generate() and requires { secret, token }
 * for verify(). Pinning the wrapper means the route code does not have to
 * track upstream changes.
 */
const otplib = require('otplib');

function newSecret() {
  return otplib.generateSecret();
}

async function currentCode(secret) {
  return otplib.generate({ secret });
}

async function verifyCode(secret, token) {
  if (!token) return false;
  try {
    return await otplib.verify({ secret, token });
  } catch {
    return false;
  }
}

function buildUri({ accountName, secret, issuer = 'Raktify' }) {
  return otplib.generateURI({ accountName, secret, issuer });
}

module.exports = { newSecret, currentCode, verifyCode, buildUri };
