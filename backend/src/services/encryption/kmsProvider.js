/**
 * AWS KMS provider — STUB. Implementation deferred until AWS go-live.
 *
 * To activate:
 *   1. npm i @aws-sdk/client-kms
 *   2. Implement encrypt/decrypt below using KMS Encrypt/Decrypt commands.
 *   3. Set ENCRYPTION_PROVIDER=kms and KMS_*_KEY_ARN in .env.
 *
 * Ciphertext format must remain "v1:kms:<keyKind>:<base64url payload>"
 * so the encryption module can route between providers transparently.
 */
function notImplemented() {
  throw new Error(
    'KMS encryption provider not implemented yet. Use ENCRYPTION_PROVIDER=local until AWS go-live.',
  );
}

module.exports = {
  encrypt: notImplemented,
  decrypt: notImplemented,
  providerName: 'kms',
};
