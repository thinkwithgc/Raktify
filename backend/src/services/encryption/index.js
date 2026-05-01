/**
 * Envelope-encryption-shaped contract:
 *   encrypt(plaintext, { keyKind })  -> ciphertext (string, base64url)
 *   decrypt(ciphertext, { keyKind }) -> plaintext (string)
 *
 * keyKind: 'main' (default) | 'screening'
 *
 * Local provider: AES-256-GCM with key from env (dev only).
 * KMS provider:   AWS KMS Encrypt/Decrypt with the configured key ARN (prod).
 */
const env = require('../../config/env');

let provider;
if (env.providers.encryption === 'kms') {
  provider = require('./kmsProvider');
} else {
  provider = require('./localProvider');
}

module.exports = provider;
