const fs = require('fs');
const path = require('path');
const env = require('../../config/env');
const logger = require('../../config/logger');

const outboxDir = path.resolve(env.local.outboxDir);

function ensureOutbox() {
  if (!fs.existsSync(outboxDir)) fs.mkdirSync(outboxDir, { recursive: true });
}

async function send(payload) {
  ensureOutbox();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(outboxDir, `${id}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ ...payload, sent_at: new Date().toISOString() }, null, 2),
  );
  logger.info(
    { id, channel: payload.channel, template: payload.templateType },
    'Notification dispatched (console provider)',
  );
  return {
    success: true,
    provider: 'console',
    messageId: id,
    deliveryStatus: 'SE',
  };
}

module.exports = { send, providerName: 'console' };
