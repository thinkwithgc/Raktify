/**
 * MSG91 provider — STUB. Full implementation lands in Phase 6.
 *
 * Required env (from .env):
 *   MSG91_AUTH_KEY, MSG91_SENDER_ID, MSG91_WHATSAPP_NUMBER,
 *   MSG91_TEMPLATE_* (DLT-registered template IDs)
 *
 * Endpoints to integrate:
 *   - WhatsApp Business: POST https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/
 *   - SMS DLT:           POST https://api.msg91.com/api/v5/flow/
 *   - Voice call:        POST https://api.msg91.com/api/v5/voice-call/
 *
 * All sends MUST use pre-registered DLT templates (TRAI compliance).
 */
async function send() {
  throw new Error(
    'MSG91 provider not implemented. DLT templates + auth key pending. Use NOTIFICATIONS_PROVIDER=console.',
  );
}

module.exports = { send, providerName: 'msg91' };
