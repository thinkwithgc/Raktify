/**
 * Single chokepoint for ALL outgoing donor/coordinator/hospital comms.
 * Per Section 6.6 of the spec: "Never call MSG91 directly from route handlers."
 *
 * sendNotification({ recipientId, templateType, variables, channel, language, emergencyOverride })
 *   - delegates the wire transmission to the provider (console | msg91)
 *   - persists ONE notification_log row per attempt regardless of provider
 *     success/failure so we have a complete outbound audit
 *   - returns { success, provider, messageId, deliveryStatus, notificationLogId }
 *
 * Resolution: recipientId may be a UUID (donors.id / platform_users.id /
 * institutions.id) OR a +91 mobile string. We try to resolve it to a
 * donor first; if that fails it's stored as recipient_external_mobile.
 *
 * Opt-in / DND enforcement is intentionally a TODO — when MSG91 lands in
 * Phase 6, this chokepoint adds the donors.{whatsapp,sms}_opted_in checks
 * and the DND hours window. The spec calls for fallback chains too
 * (WA -> SM -> CA on Critical) — that machinery lands with MSG91 wiring.
 */
const { pool } = require('../../config/db');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { isValidIndianMobile } = require('../../utils/phone');

let provider;
if (env.providers.notifications === 'msg91') {
  provider = require('./msg91Provider');
} else {
  provider = require('./consoleProvider');
}

async function resolveRecipient(client, recipientId) {
  if (!recipientId) return { recipient_external_mobile: null };
  // UUID? try donors first, then platform_users, then institutions.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(recipientId))) {
    const donor = await client.query(`SELECT id, mobile FROM donors WHERE id = $1 LIMIT 1`, [
      recipientId,
    ]);
    if (donor.rowCount > 0) {
      return {
        recipient_donor_id: donor.rows[0].id,
        recipient_external_mobile: donor.rows[0].mobile,
      };
    }
    const user = await client.query(`SELECT id, mobile FROM platform_users WHERE id = $1 LIMIT 1`, [
      recipientId,
    ]);
    if (user.rowCount > 0) {
      return {
        recipient_user_id: user.rows[0].id,
        recipient_external_mobile: user.rows[0].mobile,
      };
    }
    const inst = await client.query(
      `SELECT id, primary_contact_mobile FROM institutions WHERE id = $1 LIMIT 1`,
      [recipientId],
    );
    if (inst.rowCount > 0) {
      return {
        recipient_institution_id: inst.rows[0].id,
        recipient_external_mobile: inst.rows[0].primary_contact_mobile,
      };
    }
    return {};
  }
  // Mobile string?
  if (isValidIndianMobile(recipientId)) {
    const donor = await client.query(`SELECT id FROM donors WHERE mobile = $1 LIMIT 1`, [
      recipientId,
    ]);
    if (donor.rowCount > 0) {
      return { recipient_donor_id: donor.rows[0].id, recipient_external_mobile: recipientId };
    }
    const user = await client.query(`SELECT id FROM platform_users WHERE mobile = $1 LIMIT 1`, [
      recipientId,
    ]);
    if (user.rowCount > 0) {
      return { recipient_user_id: user.rows[0].id, recipient_external_mobile: recipientId };
    }
    return { recipient_external_mobile: recipientId };
  }
  return { recipient_external_mobile: null };
}

async function sendNotification({
  recipientId,
  templateType,
  variables = {},
  channel = 'WA', // WA | SM | CA | EM
  language = 'mr',
  emergencyOverride = false,
  relatedRequestId = null,
  relatedAlertId = null,
}) {
  const dispatchResult = await provider.send({
    recipientId,
    templateType,
    variables,
    channel,
    language,
    emergencyOverride,
  });

  // Persist to notification_log regardless of provider outcome.
  // sendNotification runs from many contexts (routes, jobs, bot dispatcher);
  // some have an RLS actor_role set on their tx, some don't (we use pool.query
  // here on a fresh connection). Always SET LOCAL actor_role='system' so the
  // notif_system_insert RLS policy permits the INSERT.
  let notificationLogId = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('raktify.actor_role', 'system', TRUE)`);
    const recipient = await resolveRecipient(client, recipientId);
    const r = await client.query(
      `INSERT INTO notification_log (
         recipient_donor_id, recipient_user_id, recipient_institution_id,
         recipient_external_mobile,
         channel, template_type, language, msg91_template_id, template_variables,
         related_request_id, related_alert_id,
         provider, provider_message_id,
         delivery_status, was_dnd_overridden)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)
    RETURNING id`,
      [
        recipient.recipient_donor_id || null,
        recipient.recipient_user_id || null,
        recipient.recipient_institution_id || null,
        recipient.recipient_external_mobile || null,
        channel,
        templateType,
        language,
        env.msg91.templates?.[templateType?.toLowerCase()] || null,
        JSON.stringify(variables),
        relatedRequestId,
        relatedAlertId,
        provider.providerName === 'msg91' ? 'M9' : 'LO',
        dispatchResult.messageId || null,
        dispatchResult.deliveryStatus || (dispatchResult.success ? 'SE' : 'FA'),
        emergencyOverride,
      ],
    );
    notificationLogId = r.rows[0].id;
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    // Never break the upstream send if logging fails.
    logger.error({ err: err.message, templateType, channel }, 'notification_log write failed');
  } finally {
    client.release();
  }

  return { ...dispatchResult, notificationLogId };
}

module.exports = { sendNotification, providerName: provider.providerName };
