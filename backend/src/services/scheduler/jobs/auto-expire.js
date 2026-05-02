/**
 * auto_expire_job (spec §6) — daily at midnight.
 *
 * Set status='EX' for all AV bags whose expiry_date < today. Returns count.
 *
 * Runs as actor_role='system' so audit_log records the system as the actor.
 */
const { withRlsContextRaw } = require('../../../middleware/rlsContext');

async function run() {
  return withRlsContextRaw(
    { actor_role: 'system', change_reason: 'auto_expire_job' },
    async (c) => {
      const r = await c.query(
        `UPDATE blood_inventory
            SET status = 'EX',
                status_changed_at = clock_timestamp(),
                status_changed_by = (SELECT id FROM platform_users
                                       WHERE role IN ('super_admin','ngo_admin')
                                       ORDER BY created_at LIMIT 1)
          WHERE status = 'AV'
            AND expiry_date < CURRENT_DATE
        RETURNING id, blood_bank_id, blood_group_id, component_id`,
      );
      return { expired_count: r.rowCount, sample: r.rows.slice(0, 5) };
    },
  );
}

module.exports = {
  run,
  name: 'auto_expire',
  cron: '0 0 * * *',
  description: 'Expire AV bags past expiry_date',
};
