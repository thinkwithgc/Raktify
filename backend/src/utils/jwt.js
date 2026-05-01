const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Per-role TTL (spec §4)
const TTL_BY_ROLE = {
  donor: '24h',
  coordinator: '12h',
  hospital: '8h',
  blood_bank: '8h',
  ngo_admin: '8h',
  super_admin: '8h',
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
