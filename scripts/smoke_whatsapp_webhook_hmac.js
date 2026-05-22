#!/usr/bin/env node
/**
 * Smoke test for the WhatsApp webhook HMAC signature verification.
 *
 * Boots the Express app locally with a synthetic WHATSAPP_APP_SECRET, then
 * sends three POSTs to /webhooks/whatsapp/incoming:
 *
 *   1. A Meta-shape payload with a CORRECT X-Hub-Signature-256 → expect 200
 *   2. A Meta-shape payload with a WRONG signature              → expect 401
 *   3. A Meta-shape payload with NO signature header            → expect 401
 *
 * Usage:
 *   node scripts/smoke_whatsapp_webhook_hmac.js
 *
 * Exits 0 on all-pass, 1 on any fail. Safe to wire into CI later.
 */
const crypto = require('crypto');
const http = require('http');
const path = require('path');

// Force a synthetic app secret + minimum required env vars BEFORE app.js
// loads. The smoke harness must not depend on a real .env / Azure config.
process.env.WHATSAPP_APP_SECRET = 'smoke-test-secret-do-not-use-in-prod';
process.env.NOTIFICATIONS_PROVIDER = 'console';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-jwt-secret-not-for-prod-32-chars';
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  '0000000000000000000000000000000000000000000000000000000000000000';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://noop:noop@127.0.0.1:5432/noop';

const createApp = require(path.join(__dirname, '..', 'backend', 'src', 'app'));

function postJson(server, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port: server.address().port,
        path: '/webhooks/whatsapp/incoming',
        headers: { 'Content-Type': 'application/json', 'Content-Length': raw.length, ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

function sign(secret, bodyObj) {
  const raw = Buffer.from(JSON.stringify(bodyObj));
  return (
    'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  );
}

(async () => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));

  const metaPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1234567890',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15556380237', phone_number_id: '1139331555927611' },
              statuses: [
                {
                  id: 'wamid.smoke_test',
                  status: 'delivered',
                  timestamp: '1716300000',
                  recipient_id: '918586999969',
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const validSig = sign(process.env.WHATSAPP_APP_SECRET, metaPayload);
  const badSig = 'sha256=' + 'a'.repeat(64);

  let failed = 0;

  // 1. Correct signature → 200
  {
    const r = await postJson(server, metaPayload, { 'X-Hub-Signature-256': validSig });
    const ok = r.status === 200;
    console.log(`  ${ok ? '✓' : '✗'} valid signature  → status ${r.status} (expected 200)`);
    if (!ok) failed++;
  }

  // 2. Wrong signature → 401
  {
    const r = await postJson(server, metaPayload, { 'X-Hub-Signature-256': badSig });
    const ok = r.status === 401;
    console.log(`  ${ok ? '✓' : '✗'} wrong signature  → status ${r.status} (expected 401)`);
    if (!ok) failed++;
  }

  // 3. Missing header → 401
  {
    const r = await postJson(server, metaPayload);
    const ok = r.status === 401;
    console.log(`  ${ok ? '✓' : '✗'} missing header   → status ${r.status} (expected 401)`);
    if (!ok) failed++;
  }

  server.close();
  if (failed > 0) {
    console.error(`\n${failed} smoke check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll WhatsApp HMAC smoke checks passed ✓');
  process.exit(0);
})().catch((err) => {
  console.error('Smoke harness crashed:', err);
  process.exit(1);
});
