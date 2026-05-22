/**
 * Inbound webhooks (spec §8).
 *
 *   POST /webhooks/msg91/delivery     MSG91 delivery-status updates
 *   POST /webhooks/whatsapp/incoming  inbound WhatsApp messages (bot dispatcher)
 *
 * For dev (no MSG91 yet), both endpoints accept the raw shape MSG91 will
 * send and are exercised by the smoke test directly. Once MSG91 DLT lands,
 * MSG91 calls these URLs from its own webhook configuration.
 *
 * No JWT — these are public endpoints called by upstream services. Spec-
 * compliant production will validate an HMAC signature header (X-MSG91-Signature)
 * against MSG91_AUTH_KEY. The skeleton for that is in place but skipped in
 * dev when MSG91_AUTH_KEY is empty.
 */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const env = require('../config/env');
const logger = require('../config/logger');
const { withRlsContextRaw } = require('../middleware/rlsContext');
const { dispatchIncomingMessage } = require('../services/whatsapp/bot');

const router = express.Router();

function verifyMsg91Signature(req) {
  if (!env.msg91.authKey) return true; // dev: skip
  const sig = req.headers['x-msg91-signature'];
  if (!sig) return false;
  const computed = crypto
    .createHmac('sha256', env.msg91.authKey)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return (
    sig.length === computed.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computed))
  );
}

// Meta WhatsApp Cloud API signs every webhook POST with
// `X-Hub-Signature-256: sha256=<hex>` where the HMAC is computed over the
// RAW request body bytes, keyed by the App Secret. Skip verification only
// when the secret is unset (dev convenience) — the same posture as
// verifyMsg91Signature. In prod, WHATSAPP_APP_SECRET MUST be set; otherwise
// anyone with our webhook URL can spoof delivery receipts and inbound
// messages.
function verifyMetaSignature(req) {
  if (!env.whatsapp.appSecret) {
    logger.warn(
      'WHATSAPP_APP_SECRET not set — skipping Meta webhook signature verification (dev only).',
    );
    return true;
  }
  const header = req.headers['x-hub-signature-256'];
  if (!header || typeof header !== 'string' || !header.startsWith('sha256=')) {
    return false;
  }
  const provided = header.slice('sha256='.length);
  const expected = crypto
    .createHmac('sha256', env.whatsapp.appSecret)
    .update(req.rawBody || Buffer.alloc(0))
    .digest('hex');
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ── POST /webhooks/msg91/delivery ────────────────────────────────────────
const deliverySchema = z.object({
  notification_id: z.union([z.number(), z.string()]).optional(),
  provider_message_id: z.string().optional(),
  status: z.enum(['SE', 'DL', 'RD', 'FA', 'OP', 'UN']),
  failure_reason: z.string().optional(),
  occurred_at: z.string().datetime().optional(),
});

router.post('/msg91/delivery', async (req, res) => {
  if (!verifyMsg91Signature(req)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  const parsed = deliverySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }

  const { notification_id, provider_message_id, status, failure_reason, occurred_at } = parsed.data;

  const result = await withRlsContextRaw(
    { actor_role: 'webhook', change_reason: 'MSG91 delivery webhook' },
    async (c) => {
      // Look up by id or provider_message_id
      const lookup = notification_id ? `id = $1` : `provider_message_id = $1`;
      const lookupVal = notification_id ?? provider_message_id;
      if (!lookupVal) {
        throw Object.assign(new Error('no_identifier'), { status: 400 });
      }

      // `lookup` is one of two hardcoded SQL fragments (`id = $1` or
      // `provider_message_id = $1`) selected by which body field the webhook
      // sender provided. The actual identifier value is parameterised.
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax
        `UPDATE notification_log
            SET delivery_status = $2,
                delivery_status_updated = COALESCE($3::timestamptz, clock_timestamp()),
                failure_reason = COALESCE($4, failure_reason)
          WHERE ${lookup}
       RETURNING id, delivery_status, recipient_donor_id, channel, is_opt_out_trigger`,
        [lookupVal, status, occurred_at || null, failure_reason || null],
      );
      if (r.rowCount === 0) {
        throw Object.assign(new Error('notification_not_found'), { status: 404 });
      }
      return r.rows[0];
    },
  );
  res.json({ status: 'recorded', notification: result });
});

// ── GET /webhooks/whatsapp/incoming ──────────────────────────────────────
// Meta WhatsApp Cloud API webhook verification handshake. When you register
// the callback URL, Meta sends a GET with hub.mode / hub.verify_token /
// hub.challenge — echo the challenge back if the verify token matches.
router.get('/whatsapp/incoming', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (
    mode === 'subscribe' &&
    env.whatsapp.webhookVerifyToken &&
    token === env.whatsapp.webhookVerifyToken
  ) {
    return res.status(200).send(String(challenge ?? ''));
  }
  return res.sendStatus(403);
});

// ── POST /webhooks/whatsapp/incoming ─────────────────────────────────────
// Accepts two payload shapes:
//   - Meta WhatsApp Cloud API  ({ object: 'whatsapp_business_account', entry: […] })
//   - the simple {from_mobile, message_text} shape used by the smoke test
const incomingSchema = z.object({
  from_mobile: z.string(),
  message_text: z.string().min(1),
  provider_message_id: z.string().optional(),
  received_at: z.string().datetime().optional(),
});

// Meta delivery-status string -> notification_log.delivery_status code.
const META_STATUS = { sent: 'SE', delivered: 'DL', read: 'RD', failed: 'FA' };

async function handleMetaWebhook(req, res) {
  // Meta signs the POST with X-Hub-Signature-256 (HMAC-SHA256 of the raw
  // request body, keyed by WHATSAPP_APP_SECRET). The raw body is captured
  // by the express.json `verify` callback in app.js and attached to
  // req.rawBody. Reject silently with 401 on mismatch.
  if (!verifyMetaSignature(req)) {
    logger.warn(
      {
        ip: req.ip,
        hasHeader: Boolean(req.headers['x-hub-signature-256']),
        rawBodyBytes: req.rawBody?.length || 0,
      },
      'WhatsApp webhook signature verification failed — rejecting',
    );
    return res.status(401).json({ error: 'invalid_signature' });
  }

  for (const entry of Array.isArray(req.body.entry) ? req.body.entry : []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      // Incoming messages -> the registration bot dispatcher.
      for (const msg of value.messages || []) {
        if (msg.type === 'text' && msg.text?.body) {
          try {
            await dispatchIncomingMessage({
              from_mobile: msg.from,
              message_text: msg.text.body,
              provider_message_id: msg.id,
            });
          } catch (err) {
            logger.error({ err: err.message }, 'WhatsApp bot dispatch failed');
          }
        }
      }
      // Delivery / read receipts -> notification_log.
      for (const st of value.statuses || []) {
        const code = META_STATUS[st.status];
        if (!code || !st.id) continue;
        try {
          await withRlsContextRaw(
            { actor_role: 'webhook', change_reason: 'WhatsApp delivery webhook' },
            (c) =>
              c.query(
                `UPDATE notification_log
                    SET delivery_status = $2, delivery_status_updated = clock_timestamp()
                  WHERE provider_message_id = $1`,
                [st.id, code],
              ),
          );
        } catch (err) {
          logger.error({ err: err.message }, 'WhatsApp status update failed');
        }
      }
    }
  }
  // Meta requires a prompt 200, otherwise it retries the delivery.
  res.sendStatus(200);
}

router.post('/whatsapp/incoming', async (req, res) => {
  if (req.body && req.body.object === 'whatsapp_business_account') {
    return handleMetaWebhook(req, res);
  }
  // Simple shape (smoke test).
  if (!verifyMsg91Signature(req)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  const parsed = incomingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  try {
    const result = await dispatchIncomingMessage(parsed.data);
    res.json(result);
  } catch (err) {
    logger.error({ err: err.message }, 'WhatsApp bot dispatch failed');
    res.status(500).json({ error: 'bot_dispatch_failed' });
  }
});

module.exports = router;
