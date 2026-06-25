/**
 * Aadhaar eSign provider abstraction.
 *
 * Two implementations:
 *   leegalityProvider — production (Leegality REST API, leegality.com).
 *   localProvider     — dev. Generates a fake doc_id, writes the "MoU" payload
 *                       to .outbox/esign/, returns a callback URL that the
 *                       smoke test (or a curl) can POST to so the lifecycle
 *                       progresses without Leegality availability.
 *
 * Contract:
 *   sendForSign({ institutionId, signatoryMobile, signatoryName, templateData })
 *     -> { docId, signUrl, expiresAt }
 *   verifyWebhook(headers, body) -> { docId, signedAt, signatoryName, signatoryAadhaarLast4 }
 */
const env = require('../../config/env');

// Real Leegality requires the Auth Token AND a Template ID (and Private Salt
// for webhook HMAC verification). Without all three, fall back to the local
// provider so dev / CI doesn't depend on Leegality availability.
let provider;
if (env.leegality.authToken && env.leegality.templateId && env.leegality.privateSalt) {
  provider = require('./leegalityProvider');
} else {
  provider = require('./localProvider');
}

module.exports = provider;
