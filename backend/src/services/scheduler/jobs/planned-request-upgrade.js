/**
 * planned_request_upgrade (spec §6) — every 15 minutes.
 *
 * Promote PL → UR when needed_by < NOW + 4h.
 * Promote UR → CR when needed_by < NOW + 60min.
 *
 * Critical-tier promotions also flip donor_activation_required to TRUE
 * (the BEFORE INSERT trigger handles new requests; this update path needs
 * to mirror it).
 */
const { withRlsContextRaw } = require('../../../middleware/rlsContext');

async function run() {
  return withRlsContextRaw(
    { actor_role: 'system', change_reason: 'planned_request_upgrade' },
    async (c) => {
      const upgraded = [];

      // PL → UR
      const r1 = await c.query(
        `UPDATE blood_requests
            SET urgency_tier = 'UR',
                donor_activation_required = TRUE
          WHERE urgency_tier = 'PL'
            AND status IN ('OP','MT','AS','PF')
            AND needed_by < NOW() + INTERVAL '4 hours'
       RETURNING id, request_number, urgency_tier`,
      );
      upgraded.push(...r1.rows.map((r) => ({ ...r, from: 'PL', to: 'UR' })));

      // UR → CR
      const r2 = await c.query(
        `UPDATE blood_requests
            SET urgency_tier = 'CR',
                donor_activation_required = TRUE
          WHERE urgency_tier = 'UR'
            AND status IN ('OP','MT','AS','PF')
            AND needed_by < NOW() + INTERVAL '60 minutes'
            AND source_tier IN ('OH','GH')
       RETURNING id, request_number, urgency_tier`,
      );
      upgraded.push(...r2.rows.map((r) => ({ ...r, from: 'UR', to: 'CR' })));

      return { upgraded_count: upgraded.length, upgraded };
    },
  );
}

module.exports = {
  run,
  name: 'planned_request_upgrade',
  cron: '*/15 * * * *',
  description: 'Promote PL→UR→CR as needed_by approaches',
};
