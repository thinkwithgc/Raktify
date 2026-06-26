const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Per-role JWT TTL.
//
// Donors + community_leaders are 30 days — they touch low-criticality
// data (own donor profile, community roster without donor PII) so
// re-OTP-ing every day is friction with no security upside.
//
// All staff roles are 8 hours — they auth via username + password +
// TOTP and touch clinical / operational data. Coordinator joined the
// staff cluster in migration 282 (NGO-employed, role-shaped, signs
// NGO terms) — same auth path, same short TTL as the rest of staff.
const TTL_BY_ROLE = {
  donor: '30d',
  community_leader: '30d',
  coordinator: '8h',
  hospital: '8h',
  blood_bank: '8h',
  ngo_admin: '8h',
  super_admin: '8h',
  dho: '8h',
};

function ttlForRole(role) {
  return TTL_BY_ROLE[role] || env.jwt.expiresIn;
}

function sign(payload) {
  return jwt.sign(payload, env.jwt.secret, {
    expiresIn: ttlForRole(payload.role),
    algorithm: 'HS256',
  });
}

function verify(token) {
  return jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] });
}

function newSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { sign, verify, newSessionId, ttlForRole };
