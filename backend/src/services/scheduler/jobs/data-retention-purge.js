/**
 * data_retention_purge — daily. DPDP §8(7): scrub the free PII payload from
 * notification_log rows older than env.piiLogRetentionDays. The log ROW is
 * kept (delivery_status, template_type, sent_at, recipient FK ids) for audit +
 * analytics; only the PII payload is removed:
 *   • template_variables       → NULL   (names/mobiles bound into the message)
 *   • recipient_external_mobile → '[scrubbed]' sentinel (not NULL — the
 *     recipient_present CHECK needs at least one recipient field populated).
 *
 * Idempotent: rows whose payload is already scrubbed are skipped. Runs under
 * actor_role 'system', which the notif_webhook_update RLS policy permits.
 */
const { withRlsContextRaw } = require('../../../middleware/rlsContext');
const env = require('../../../config/env');

async function run() {
  return withRlsContextRaw(
    { actor_role: 'system', change_reason: 'data_retention_purge' },
    async (c) => {
      const r = await c.query(
        `UPDATE notification_log
            SET template_variables = NULL,
                recipient_external_mobile =
                  CASE WHEN recipient_external_mobile IS NOT NULL THEN '[scrubbed]' ELSE NULL END
          WHERE sent_at < NOW() - make_interval(days => $1)
            AND (
              template_variables IS NOT NULL
              OR (recipient_external_mobile IS NOT NULL AND recipient_external_mobile <> '[scrubbed]')
            )`,
        [env.piiLogRetentionDays],
      );
      return { scrubbed_count: r.rowCount, retention_days: env.piiLogRetentionDays };
    },
  );
}

module.exports = {
  run,
  name: 'data_retention_purge',
  cron: '30 3 * * *', // daily at 03:30
  description: 'Scrub PII payload from notification_log rows past the retention window',
};
