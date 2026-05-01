/**
 * File storage abstraction. Used by:
 *   - MoU PDFs (Phase 2)
 *   - Prescriptions / patient reports (Phase 5)
 *
 * Contract:
 *   getUploadUrl({ key, contentType, maxBytes }) -> { url, fields, expiresAt }
 *   getDownloadUrl(key, { expiresInSec })        -> { url, expiresAt }
 *   put(key, buffer, { contentType })            -> { key }
 *   exists(key)                                  -> boolean
 *
 * Local provider writes to LOCAL_STORAGE_DIR; S3 provider uses presigned URLs.
 */
const env = require('../../config/env');

let provider;
if (env.providers.storage === 's3') {
  provider = require('./s3Provider');
} else {
  provider = require('./localProvider');
}

module.exports = provider;
