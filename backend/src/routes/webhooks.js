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

// ── POST /webhooks/whatsapp/incoming ─────────────────────────────────────
const incomingSchema = z.object({
  from_mobile: z.string(),
  message_text: z.string().min(1),
  provider_message_id: z.string().optional(),
  received_at: z.string().datetime().optional(),
});

router.post('/whatsapp/incoming', async (req, res) => {
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
