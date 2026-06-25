const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../config/logger');

const dir = path.resolve(env.local.outboxDir, 'esign');

function ensureDir() {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function sendForSign({ institutionId, signatoryMobile, signatoryName, templateData }) {
  ensureDir();
  const docId = `local-${crypto.randomBytes(8).toString('hex')}`;
  const file = path.join(dir, `${docId}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        docId,
        institutionId,
        signatoryMobile,
        signatoryName,
        templateData,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  logger.info({ docId, institutionId }, 'eSign request created (local provider)');
  return {
    docId,
    signUrl: `local://esign/${docId}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * In dev mode, callers can simulate a signed event by POSTing to
 * /onboarding/mou-signed with body { doc_id, signed_at, signatory_aadhaar_last4 }.
 * No HMAC signature validation here — the real Leegality provider does that.
 */
function verifyWebhook(_headers, body) {
  if (!body?.doc_id) throw new Error('doc_id missing from local webhook body');
  return {
    docId: body.doc_id,
    signedAt: body.signed_at || new Date().toISOString(),
    signatoryName: body.signatory_name,
    signatoryAadhaarLast4: body.signatory_aadhaar_last4,
  };
}

module.exports = { sendForSign, verifyWebhook, providerName: 'local' };
