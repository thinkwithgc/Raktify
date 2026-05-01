const fs = require('fs');
const path = require('path');
const env = require('../../config/env');

const root = path.resolve(env.local.storageDir);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function pathFor(key) {
  return path.join(root, key);
}

async function put(key, buffer) {
  const full = pathFor(key);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, buffer);
  return { key };
}

async function exists(key) {
  return fs.existsSync(pathFor(key));
}

async function getUploadUrl({ key }) {
  // Local dev: backend accepts upload at POST /uploads/local/:key (route added when Phase 5 lands).
  return {
    url: `/uploads/local/${encodeURIComponent(key)}`,
    fields: {},
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

async function getDownloadUrl(key, { expiresInSec = 600 } = {}) {
  return {
    url: `/uploads/local/${encodeURIComponent(key)}`,
    expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
  };
}

module.exports = { put, exists, getUploadUrl, getDownloadUrl, providerName: 'local' };
