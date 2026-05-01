/**
 * Aadhaar eSign provider abstraction.
 *
 * Two implementations:
 *   leegallyProvider — production (LeegAlly REST API).
 *   localProvider    — dev. Generates a fake doc_id, writes the "MoU" payload
 *                      to .outbox/esign/, returns a callback URL that the
 *                      smoke test (or a curl) can POST to so the lifecycle
 *                      progresses without LeegAlly availability.
 *
 * Contract:
 *   sendForSign({ institutionId, signatoryMobile, signatoryName, templateData })
 *     -> { docId, signUrl, expiresAt }
 *   verifyWebhook(headers, body) -> { docId, signedAt, signatoryName, signatoryAadhaarLast4 }
 */
const env = require('../../config/env');

// Real LeegAlly requires BOTH an API key AND a template ID. Without either,
// fall back to the local provider so dev / CI doesn't depend on LeegAlly.
let provider;
if (env.leegally.apiKey && env.leegally.templateId) {
  provider = require('./leegallyProvider');
} else {
  provider = require('./localProvider');
}

module.exports = provider;
