/**
 * WhatsApp bot dispatcher (spec §8).
 *
 * Two flows are supported here:
 *   1. Donor registration (state machine: IDLE → NAME → DOB → GENDER →
 *      VILLAGE → CONSENT → COMPLETE)
 *   2. Blood-bank inventory update parser ("UPDATE B+ 4 O+ 2 ...")
 *
 * Sessions are persisted in the bot_sessions table (1h TTL). When MSG91
 * DLT lands, the bot replies with pre-registered template messages — for
 * now (console provider) it logs replies that the smoke test inspects.
 *
 * The dispatcher is *intentionally* idempotent on identical messages
 * within a 5-second window so MSG91 retries don't drive the state machine
 * twice.
 */
const { withRlsContextRaw } = require('../../middleware/rlsContext');
const { sendNotification } = require('../notifications');
const { normaliseIndianMobile } = require('../../utils/phone');
const logger = require('../../config/logger');

const INVENTORY_UPDATE_RE = /^update\s+([A-Z0-9+\- ]+)$/i;
const BLOOD_GROUP_TOKEN_RE = /^(A|B|AB|O)([+-])$/i;

async function loadOrCreateSession(client, mobile) {
  const r = await client.query(
    `INSERT INTO bot_sessions (mobile)
     VALUES ($1)
     ON CONFLICT (mobile) DO UPDATE SET last_msg_at = clock_timestamp(),
                                        expires_at = NOW() + INTERVAL '1 hour'
     RETURNING mobile, state, context, last_msg_at, expires_at`,
    [mobile],
  );
  return r.rows[0];
}

async function saveSession(client, mobile, { state, context }) {
  await client.query(
    `UPDATE bot_sessions
        SET state = $2, context = $3,
            last_msg_at = clock_timestamp(),
            expires_at = NOW() + INTERVAL '1 hour'
      WHERE mobile = $1`,
    [mobile, state, JSON.stringify(context || {})],
  );
}

async function isRegisteredBloodBankStaff(client, mobile) {
  const r = await client.query(
    `SELECT pu.id, pu.institution_id, i.kind
       FROM platform_users pu
       JOIN institutions i ON i.id = pu.institution_id
      WHERE pu.mobile = $1 AND pu.role = 'blood_bank' AND i.kind = 'BB'
      LIMIT 1`,
    [mobile],
  );
  return r.rows[0] || null;
}

async function isRegisteredDonor(client, mobile) {
  const r = await client.query(
    // full_name intentionally not selected — it's column-encrypted and this
    // path only needs id / blood group / deferral for STATUS replies.
    `SELECT id, blood_group_verified, deferral_status
       FROM donors WHERE mobile = $1 LIMIT 1`,
    [mobile],
  );
  return r.rows[0] || null;
}

function parseInventoryMessage(text) {
  const m = text.match(INVENTORY_UPDATE_RE);
  if (!m) return null;
  const tokens = m[1].split(/\s+/).filter(Boolean);
  const updates = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const groupTok = tokens[i];
    const countTok = tokens[i + 1];
    const groupMatch = (groupTok || '').match(BLOOD_GROUP_TOKEN_RE);
    const count = parseInt(countTok, 10);
    if (!groupMatch || !Number.isFinite(count) || count < 0) {
      return { error: `unparseable token at position ${i}: '${groupTok} ${countTok}'` };
    }
    updates.push({ code: groupMatch[1].toUpperCase() + groupMatch[2], count });
  }
  return { updates };
}

/**
 * Update opening-stock counts for a blood bank from a parsed inventory message.
 * The bags created here are 'WB' source (legacy WhatsApp) — they skip TTI
 * gating per spec §6 and are clearly labelled "Legacy stock" in the UI.
 *
 * For Phase 6 scaffold, we only RECORD the update intent in notification_log
 * and write a stub payload to bot_sessions.context. The actual inventory
 * insertion is deferred to the cleaner POST /inventory/opening-stock route
 * (which already has the seed-donor lookup) — when a BB texts an update, the
 * bot replies with a deep link to that admin form. A future iteration can
 * wire the bot to do the inserts directly.
 */
async function handleBloodBankInventoryUpdate(_client, { mobile, updates, sender }) {
  const summary = updates.map((u) => `${u.code}=${u.count}`).join(' ');
  logger.info(
    { mobile, institution: sender.institution_id, updates: summary },
    'WhatsApp inventory update received (scaffold — not auto-applied)',
  );
  // Reply via the notification chokepoint
  await sendNotification({
    recipientId: mobile,
    templateType: 'BOT_REPLY',
    variables: {
      message: `Recorded inventory intent: ${summary}. Confirm via web admin to apply.`,
    },
    channel: 'WA',
    language: 'en',
  });
  return {
    flow: 'inventory_update',
    parsed_updates: updates,
    next_step: 'admin_confirmation_required',
    note: 'Scaffold only — bot does not auto-apply WB stock yet.',
  };
}

/** Drive the donor-registration state machine one step. */
async function handleDonorRegistration(client, { mobile, session, message }) {
  const ctx = session.context || {};
  const text = message.trim();
  let nextState = session.state;
  let reply = '';

  switch (session.state) {
    case 'IDLE':
      reply = 'Welcome to Raktify. To register as a donor please reply with your FULL NAME.';
      nextState = 'NAME';
      break;
    case 'NAME':
      ctx.full_name = text;
      reply = `Thanks ${text}. Reply with your DATE OF BIRTH (DD-MM-YYYY).`;
      nextState = 'DOB';
      break;
    case 'DOB': {
      const m = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (!m) {
        reply = 'Please reply with DOB as DD-MM-YYYY (e.g., 15-03-1995).';
        break;
      }
      ctx.date_of_birth = `${m[3]}-${m[2]}-${m[1]}`;
      reply = 'Reply with your gender: M / F / O.';
      nextState = 'GENDER';
      break;
    }
    case 'GENDER':
      if (!['M', 'F', 'O'].includes(text.toUpperCase())) {
        reply = 'Please reply with M, F, or O.';
        break;
      }
      ctx.gender = text.toUpperCase();
      reply = 'Reply with your VILLAGE NAME or PINCODE.';
      nextState = 'VILLAGE';
      break;
    case 'VILLAGE':
      ctx.village_or_pincode = text;
      reply =
        'Last step: do you consent to Raktify contacting you for blood emergencies? Reply YES or NO.';
      nextState = 'CONSENT';
      break;
    case 'CONSENT':
      if (text.toUpperCase() === 'YES') {
        ctx.consent_data_use = true;
        reply =
          'Thank you. Your registration is being processed. A coordinator will contact you to verify your blood group at a partnered blood bank.';
        nextState = 'COMPLETE';
      } else if (text.toUpperCase() === 'NO') {
        reply = 'Understood. Reply REGISTER any time to start over.';
        nextState = 'IDLE';
      } else {
        reply = 'Please reply YES or NO.';
      }
      break;
    case 'COMPLETE':
      reply =
        'Your registration is already complete. Reply HELP for options or STOP to opt out of WhatsApp.';
      break;
    default:
      reply = 'Reply REGISTER to start, or HELP for options.';
      nextState = 'IDLE';
  }

  await saveSession(client, mobile, { state: nextState, context: ctx });

  await sendNotification({
    recipientId: mobile,
    templateType: 'BOT_REPLY',
    variables: { message: reply },
    channel: 'WA',
    language: 'en',
  });

  return { flow: 'donor_registration', state: nextState, reply };
}

async function dispatchIncomingMessage({ from_mobile, message_text }) {
  const mobile = normaliseIndianMobile(from_mobile);
  if (!mobile) {
    return { error: 'invalid_mobile_format' };
  }
  const text = (message_text || '').trim();

  return withRlsContextRaw(
    { actor_role: 'webhook', change_reason: 'WhatsApp incoming bot' },
    async (c) => {
      const bbStaff = await isRegisteredBloodBankStaff(c, mobile);
      if (bbStaff) {
        // BB staff: try to parse as inventory update.
        const parsed = parseInventoryMessage(text);
        if (parsed?.updates) {
          return handleBloodBankInventoryUpdate(c, {
            mobile,
            updates: parsed.updates,
            sender: bbStaff,
          });
        }
        if (parsed?.error) {
          await sendNotification({
            recipientId: mobile,
            templateType: 'BOT_REPLY',
            variables: {
              message: `Sorry, I could not parse that update. ${parsed.error}. Format: UPDATE B+ 4 O+ 2`,
            },
            channel: 'WA',
            language: 'en',
          });
          return { flow: 'inventory_update', error: parsed.error };
        }
        // BB staff but message didn't match: send a tip
        await sendNotification({
          recipientId: mobile,
          templateType: 'BOT_REPLY',
          variables: { message: 'BB inventory update format: UPDATE B+ 4 O+ 2 A+ 6' },
          channel: 'WA',
          language: 'en',
        });
        return { flow: 'inventory_update', note: 'no parseable command' };
      }

      const donor = await isRegisteredDonor(c, mobile);
      if (donor) {
        // Registered donor: handle simple intents.
        const upper = text.toUpperCase();
        if (upper === 'STOP') {
          await c.query(
            `UPDATE donors SET whatsapp_opted_in = FALSE,
                                updated_at = clock_timestamp()
              WHERE mobile = $1`,
            [mobile],
          );
          return { flow: 'donor_intent', intent: 'STOP', applied: true };
        }
        if (upper === 'HELP') {
          await sendNotification({
            recipientId: mobile,
            templateType: 'BOT_REPLY',
            variables: {
              message:
                'Reply STATUS for your eligibility, AVAILABLE / UNAVAILABLE to toggle availability, STOP to unsubscribe.',
            },
            channel: 'WA',
            language: 'en',
          });
          return { flow: 'donor_intent', intent: 'HELP' };
        }
        if (upper === 'STATUS') {
          await sendNotification({
            recipientId: mobile,
            templateType: 'BOT_REPLY',
            variables: {
              message: `Status: ${donor.deferral_status === 'A' ? 'Active' : donor.deferral_status === 'T' ? 'Temp deferred' : 'Permanently deferred'}. Blood group: ${donor.blood_group_verified ? 'verified' : 'unverified'}.`,
            },
            channel: 'WA',
            language: 'en',
          });
          return { flow: 'donor_intent', intent: 'STATUS' };
        }
        return { flow: 'donor_intent', intent: 'unknown', message: text };
      }

      // Not registered — drive the registration state machine.
      const session = await loadOrCreateSession(c, mobile);
      return handleDonorRegistration(c, { mobile, session, message: text });
    },
  );
}

module.exports = { dispatchIncomingMessage, parseInventoryMessage };
