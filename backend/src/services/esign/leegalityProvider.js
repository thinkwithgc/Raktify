/**
 * Leegality (Aadhaar eSign) provider — leegality.com.
 *
 * Aligned to Leegality's v3.0 docs (see /leegality.md/ folder for the
 * docs the integration was built against). The most important things
 * that aren't obvious from reading any other eSign provider's API:
 *
 *   • Auth header is `X-Auth-Token: <authToken>` — NOT
 *     `Authorization: Bearer …`. Both outbound API calls AND inbound
 *     webhooks carry this header.
 *
 *   • Webhook HMAC is computed as `HMAC-SHA1(documentId, privateSalt)`.
 *     The signed payload is the documentId STRING ONLY, not the request
 *     body. The MAC is returned in the JSON body as the `mac` field
 *     (not in a header). Confusing this with the standard "HMAC of the
 *     raw body" pattern = every webhook fails verification silently in
 *     prod.
 *
 *   • Private Salt and Auth Token are DIFFERENT credentials with
 *     DIFFERENT uses. Auth Token authenticates API calls + webhooks.
 *     Private Salt verifies webhook integrity. Confusing the two is the
 *     #1 source of integration bugs per their support docs.
 *
 *   • What we call LEEGALITY_TEMPLATE_ID in our env is what Leegality
 *     calls `profileId` (the Workflow ID). A Leegality workflow wraps a
 *     template + invitee config + signature placements + webhook URLs.
 *     The "template" in our naming sense is the workflow + uploaded PDF.
 *
 *   • The webhook does NOT contain `signedAt` or signatory aadhaar last
 *     4. Use server-side receipt time for signedAt; fetch aadhaar last 4
 *     via the Details API as a follow-up if needed.
 *
 *   • Two webhook event categories share the same payload envelope:
 *     `webhookType: "Success"` (Signed / Reviewer approves) and
 *     `webhookType: "Error"` (Signer rejects / Certificate verification
 *     fails / Document expired). The route handler branches on
 *     webhookType + request.action.
 *
 * Provider contract (unchanged, matches localProvider):
 *   sendForSign({ institutionId, signatoryMobile, signatoryName, templateData })
 *     -> { docId, signUrl, expiresAt }
 *   verifyWebhook(headers, body)
 *     -> { docId, webhookType, documentStatus, signedAt,
 *          signatoryName, signatoryAadhaarLast4, action, error }
 */
const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../config/logger');

// Leegality bodies use 10-digit phone numbers (no country code). Our
// institutions.primary_contact_mobile is stored as `+91XXXXXXXXXX` (CHAR(13)).
function to10DigitPhone(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function sendForSign({ institutionId, signatoryMobile, signatoryName, templateData }) {
  const url = `${env.leegality.baseUrl.replace(/\/$/, '')}/v3.0/sign/request`;

  // For template-based workflows, Leegality reads PDF + signature placements
  // from the workflow definition; we only supply the field values + invitee.
  // Pass each templateData key as a named field; Leegality matches by name.
  const fields = Object.entries(templateData || {}).map(([name, value]) => ({
    name,
    type: 'text',
    value: String(value ?? ''),
  }));

  const body = {
    profileId: env.leegality.templateId, // Workflow ID per Leegality terminology
    irn: institutionId, // Internal Reference Number — our institution UUID
    file: {
      name: `Raktify_MoU_${institutionId}`,
      fields,
    },
    invitees: [
      {
        name: signatoryName,
        phone: to10DigitPhone(signatoryMobile),
        defaultLanguageSelect: 'ENGLISH',
      },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': env.leegality.authToken,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text }, 'Leegality sendForSign HTTP error');
    throw new Error(`Leegality send failed: HTTP ${res.status}`);
  }

  // Leegality returns 200 even on validation errors — check the status
  // field in the body. 1 = success, 0 = validation/config error.
  const data = await res.json();
  if (data.status !== 1) {
    const msg = (data.messages && data.messages[0]?.message) || 'unknown';
    logger.error({ body: data }, 'Leegality sendForSign rejected by Leegality');
    throw new Error(`Leegality rejected: ${msg}`);
  }

  const invitee = data.data?.invitees?.[0] || {};
  return {
    docId: data.data?.documentId,
    signUrl: invitee.signUrl,
    expiresAt: invitee.expiryDate, // Leegality format: "DD-MM-YYYY HH:MM:SS"
  };
}

function verifyWebhook(headers, body) {
  // Two auth checks: (a) the X-Auth-Token header must match our authToken
  // (Leegality sends this on every webhook), and (b) the `mac` body field
  // must be HMAC-SHA1(documentId, privateSalt).
  const headerToken = headers['x-auth-token'] || headers['X-Auth-Token'];
  if (!headerToken) {
    throw new Error('Leegality webhook missing X-Auth-Token header');
  }
  if (headerToken !== env.leegality.authToken) {
    throw new Error('Leegality webhook X-Auth-Token mismatch');
  }

  const parsed = typeof body === 'string' ? JSON.parse(body) : body;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Leegality webhook body is not an object');
  }

  const { documentId, mac } = parsed;
  if (!documentId || !mac) {
    throw new Error('Leegality webhook missing documentId or mac');
  }

  // HMAC-SHA1, NOT SHA-256. Signed value is the documentId STRING ONLY,
  // not the JSON body. Key is the dashboard's Private Salt.
  const computed = crypto
    .createHmac('sha1', env.leegality.privateSalt)
    .update(String(documentId))
    .digest('hex');

  if (
    mac.length !== computed.length ||
    !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(computed))
  ) {
    throw new Error('Leegality webhook mac mismatch (HMAC-SHA1 of documentId failed verification)');
  }

  // The webhook envelope doesn't carry signedAt or aadhaarLast4. signedAt
  // uses server receipt time; aadhaarLast4 is fetched via the Details API
  // later if needed (institutions.mou_signatory_aadhaar_last4 stays null
  // for now — non-blocking).
  return {
    docId: documentId,
    irn: parsed.irn || null, // Our institution_id was set as irn at sendForSign time
    webhookType: parsed.webhookType || 'Success',
    documentStatus: parsed.documentStatus || null,
    signedAt: new Date().toISOString(),
    signatoryName: parsed.request?.name || null,
    signatoryAadhaarLast4: null,
    action: parsed.request?.action || null,
    error: parsed.request?.error || null,
  };
}

module.exports = { sendForSign, verifyWebhook, providerName: 'leegality' };
