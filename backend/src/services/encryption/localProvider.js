const crypto = require('crypto');
const env = require('../../config/env');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

function loadKey(kind) {
  const hex =
    kind === 'screening' ? env.local.screeningEncryptionKeyHex : env.local.encryptionKeyHex;
  if (!hex) {
    throw new Error(
      `LOCAL ${kind} encryption key missing. Set LOCAL_${kind === 'screening' ? 'SCREENING_' : ''}ENCRYPTION_KEY_HEX in .env (32 bytes hex).`,
    );
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) throw new Error(`LOCAL ${kind} key must be 32 bytes (got ${buf.length})`);
  return buf;
}

function encrypt(plaintext, { keyKind = 'main' } = {}) {
  if (plaintext == null) return null;
  const key = loadKey(keyKind);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // header = version|provider|kind  payload = iv||tag||ciphertext (base64url)
  const payload = Buffer.concat([iv, tag, ct]).toString('base64url');
  return `${VERSION}:loc:${keyKind}:${payload}`;
}

function decrypt(ciphertext, { keyKind } = {}) {
  if (ciphertext == null) return null;
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION || parts[1] !== 'loc') {
    throw new Error('Invalid ciphertext header for local provider');
  }
  const kind = keyKind || parts[2];
  const key = loadKey(kind);
  const buf = Buffer.from(parts[3], 'base64url');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

module.exports = { encrypt, decrypt, providerName: 'local' };
