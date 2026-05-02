/**
 * stale_reservation_release (spec §6) — hourly.
 *
 * Find RE bags reserved for a request whose urgency stale-window has passed
 * (CRITICAL > 2h, URGENT/PLANNED > 4h). Release them back to AV.
 */
const { withRlsContextRaw } = require('../../../middleware/rlsContext');

async function run() {
  return withRlsContextRaw(
    { actor_role: 'system', change_reason: 'stale_reservation_release' },
    async (c) => {
      const r = await c.query(
        `UPDATE blood_inventory bi
            SET status = 'AV',
                reserved_for_request_id = NULL,
                reserved_at = NULL,
                status_changed_at = clock_timestamp(),
                status_changed_by = (SELECT id FROM platform_users
                                       WHERE role IN ('super_admin','ngo_admin')
                                       ORDER BY created_at LIMIT 1)
           FROM blood_requests br
          WHERE bi.reserved_for_request_id = br.id
            AND bi.status = 'RE'
            AND bi.reserved_at <
                  CASE br.urgency_tier
                    WHEN 'CR' THEN NOW() - INTERVAL '2 hours'
                    ELSE NOW() - INTERVAL '4 hours'
                  END
        RETURNING bi.id, bi.blood_bank_id, br.id AS request_id, br.urgency_tier`,
      );
      return { released_count: r.rowCount, sample: r.rows.slice(0, 5) };
    },
  );
}

module.exports = {
  run,
  name: 'stale_reservation_release',
  cron: '0 * * * *',
  description: 'Release RE bags whose reservation window has passed',
};
