const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Per-role JWT TTL.
//
// Donors + community_leaders bumped to 30 days (post-Phase-3 UX call):
// these roles touch low-criticality data (own donor profile, community
// roster without donor PII) so re-OTP-ing every day is friction with
// no security upside. A stolen 30-day session for these roles can:
//   • flip a donor's is_available toggle (donor can fix in seconds)
//   • view a community's donor list (name + blood group + last-donation
//     — no mobile/address/medical)
// Neither is a clinical-data breach.
//
// Coordinator KEPT at 12h — they accept in-flight blood requests, see
// patient context, and act on critical alerts. A stolen 30-day session
// could mess with active clinical orchestration.
//
// Staff (hospital/blood_bank/admin/super_admin/dho) stay at 8h — TOTP-
// protected and touch clinical/operational data. Short TTL is appropriate.
const TTL_BY_ROLE = {
  donor: '30d',
  community_leader: '30d',
  coordinator: '12h',
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
