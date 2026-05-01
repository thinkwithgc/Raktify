/**
 * LeegAlly (Aadhaar eSign) provider.
 *
 * STATUS: skeleton — wired up to real LeegAlly endpoints once the user
 * confirms the exact API shape (LeegAlly's docs are partner-portal only).
 *
 * What this does today:
 *   - sendForSign POSTs to ${LEEGALLY_BASE_URL}/api/v1/documents/send with
 *     auth header `Authorization: Bearer ${LEEGALLY_API_KEY}` and a JSON
 *     body containing the template ID + signer mobile + variables.
 *   - verifyWebhook checks an HMAC signature header (X-LeegAlly-Signature)
 *     computed as HMAC-SHA256(body, LEEGALLY_API_KEY).
 *
 * Both of the above will need to be reconciled with LeegAlly's actual API
 * before going to production. Keeping the contract identical to the local
 * provider so callers do not need to change.
 */
const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../config/logger');

async function sendForSign({ institutionId, signatoryMobile, signatoryName, templateData }) {
  const url = `${env.leegally.baseUrl.replace(/\/$/, '')}/api/v1/documents/send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.leegally.apiKey}`,
    },
    body: JSON.stringify({
      template_id: env.leegally.templateId,
      external_ref: institutionId,
      signer: { mobile: signatoryMobile, name: signatoryName },
      variables: templateData,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text }, 'LeegAlly sendForSign failed');
    throw new Error(`LeegAlly send failed: ${res.status}`);
  }
  const data = await res.json();
  return {
    docId: data.document_id || data.docId,
    signUrl: data.signing_url || data.signUrl,
    expiresAt: data.expires_at || data.expiresAt,
  };
}

function verifyWebhook(headers, body) {
  const sig = headers['x-leegally-signature'];
  if (!sig) throw new Error('LeegAlly webhook missing signature header');

  const computed = crypto
    .createHmac('sha256', env.leegally.apiKey)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');

  if (
    sig.length !== computed.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computed))
  ) {
    throw new Error('LeegAlly webhook signature mismatch');
  }

  const parsed = typeof body === 'string' ? JSON.parse(body) : body;
  return {
    docId: parsed.document_id || parsed.docId,
    signedAt: parsed.signed_at || parsed.signedAt,
    signatoryName: parsed.signatory_name || parsed.signatoryName,
    signatoryAadhaarLast4: parsed.signatory_aadhaar_last4 || parsed.signatoryAadhaarLast4,
  };
}

module.exports = { sendForSign, verifyWebhook, providerName: 'leegally' };
