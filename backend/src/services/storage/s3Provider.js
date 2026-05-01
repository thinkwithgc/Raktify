/**
 * S3 storage provider — STUB until AWS go-live.
 *
 * To activate:
 *   1. npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *   2. Implement put / getUploadUrl / getDownloadUrl using AWS SDK v3.
 *   3. Set STORAGE_PROVIDER=s3 + S3_BUCKET_NAME + AWS creds in .env.
 *
 * Per spec Section 10.5: presigned URL upload (browser → S3 directly), max 10MB,
 * MIME whitelist (PDF/JPG/PNG), server-side encryption with KMS_MAIN_KEY_ARN.
 */
function notImplemented() {
  throw new Error(
    'S3 storage provider not implemented yet. Use STORAGE_PROVIDER=local until AWS go-live.',
  );
}

module.exports = {
  put: notImplemented,
  exists: notImplemented,
  getUploadUrl: notImplemented,
  getDownloadUrl: notImplemented,
  providerName: 's3',
};
