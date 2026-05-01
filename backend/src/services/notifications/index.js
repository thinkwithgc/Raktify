/**
 * Single chokepoint for ALL outgoing donor/coordinator/hospital comms.
 * Per Section 6.6 of the spec: "Never call MSG91 directly from route handlers."
 *
 * sendNotification(recipientId, templateType, variables, channel)
 *   - checks opt-in for the channel
 *   - checks DND hours unless Critical override
 *   - selects language template
 *   - delegates to provider (console | msg91)
 *   - writes notification_log (added when notification_log table exists in Phase 1)
 *   - registers delivery webhook expectations
 *
 * Phase 0 ships the contract + console provider. MSG91 provider lands in Phase 6.
 */
const env = require('../../config/env');

let provider;
if (env.providers.notifications === 'msg91') {
  provider = require('./msg91Provider');
} else {
  provider = require('./consoleProvider');
}

async function sendNotification({
  recipientId,
  templateType,
  variables = {},
  channel = 'WA', // WA | SM | CA
  language = 'mr',
  emergencyOverride = false,
}) {
  return provider.send({
    recipientId,
    templateType,
    variables,
    channel,
    language,
    emergencyOverride,
  });
}

module.exports = { sendNotification, providerName: provider.providerName };
