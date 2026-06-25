/**
 * Leegality (Aadhaar eSign) provider — leegality.com.
 *
 * STATUS: skeleton aligned to Leegality's dashboard-side credential shape
 * (Auth Token + Private Salt + Whitelisted IPs). The actual REST endpoints
 * + request/response field names need to be reconciled against Leegality's
 * docs (partner-portal only, not publicly indexed). Real testing waits for
 * the first MoU template to be uploaded to Leegality's dashboard.
 *
 * What this does today:
 *   - sendForSign POSTs to ${LEEGALITY_BASE_URL}/api/v1/documents/send with
 *     auth header `Authorization: Bearer ${LEEGALITY_AUTH_TOKEN}` and a JSON
 *     body containing the template ID + signer mobile + variables. The exact
 *     endpoint path may differ — update once Leegality's API docs are in hand.
 *   - verifyWebhook checks an HMAC signature header (X-Leegality-Signature)
 *     computed as HMAC-SHA256(rawBody, LEEGALITY_PRIVATE_SALT). The Private
 *     Salt is the dashboard-displayed "salt" used specifically for webhook
 *     verification — NOT the Auth Token. Confusing the two = signature
 *     mismatch on every callback.
 *
 * Both call sites are kept on the same provider contract as localProvider so
 * the route handlers don't need to know which one is active. Activation is
 * via env.leegality.{authToken,privateSalt,templateId} — see services/esign/index.js.
 */
const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../config/logger');

async function sendForSign({ institutionId, signatoryMobile, signatoryName, templateData }) {
  const url = `${env.leegality.baseUrl.replace(/\/$/, '')}/api/v1/documents/send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.leegality.authToken}`,
    },
    body: JSON.stringify({
      template_id: env.leegality.templateId,
      external_ref: institutionId,
      signer: { mobile: signatoryMobile, name: signatoryName },
      variables: templateData,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text }, 'Leegality sendForSign failed');
    throw new Error(`Leegality send failed: ${res.status}`);
  }
  const data = await res.json();
  return {
    docId: data.document_id || data.docId,
    signUrl: data.signing_url || data.signUrl,
    expiresAt: data.expires_at || data.expiresAt,
  };
}

function verifyWebhook(headers, body) {
  const sig = headers['x-leegality-signature'];
  if (!sig) throw new Error('Leegality webhook missing signature header');

  // CRITICAL: HMAC key is the Private Salt (dashboard → API → Private Salt),
  // NOT the Auth Token. Confusing the two = every webhook fails verification
  // silently in prod. The dashboard explicitly labels Private Salt as
  // "used to verify the webhook calls made by Leegality".
  const computed = crypto
    .createHmac('sha256', env.leegality.privateSalt)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');

  if (
    sig.length !== computed.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computed))
  ) {
    throw new Error('Leegality webhook signature mismatch');
  }

  const parsed = typeof body === 'string' ? JSON.parse(body) : body;
  return {
    docId: parsed.document_id || parsed.docId,
    signedAt: parsed.signed_at || parsed.signedAt,
    signatoryName: parsed.signatory_name || parsed.signatoryName,
    signatoryAadhaarLast4: parsed.signatory_aadhaar_last4 || parsed.signatoryAadhaarLast4,
  };
}

module.exports = { sendForSign, verifyWebhook, providerName: 'leegality' };
