/**
 * escalate_overdue (spec §7 escalation engine).
 *
 * Runs every 5 minutes. For each open request whose latest escalation_log
 * row is older than its escalation_timeout_minutes, advances to the next
 * ring via services/escalation.escalateRequest().
 *
 * Skips rare-blood-group requests at ring 2 — those go straight to
 * national (handled inside escalateRequest).
 */
const { withRlsContextRaw } = require('../../../middleware/rlsContext');
const { escalateRequest } = require('../../escalation');

async function run() {
  return withRlsContextRaw(
    { actor_role: 'system', change_reason: 'escalate_overdue' },
    async (c) => {
      // Pull all open requests with their latest ring.
      const r = await c.query(
        `SELECT br.id,
                br.urgency_tier, br.source_tier,
                br.donor_activation_required,
                br.requesting_hospital_district_id,
                br.component_id, br.patient_blood_group_id,
                br.units_required, br.units_fulfilled,
                br.escalation_timeout_minutes,
                COALESCE(MAX(el.ring), 0) AS last_ring,
                MAX(el.triggered_at) AS last_ring_at
           FROM blood_requests br
      LEFT JOIN escalation_log el ON el.request_id = br.id
          WHERE br.status IN ('OP','MT','AS','PF')
       GROUP BY br.id`,
      );

      const escalated = [];
      for (const req of r.rows) {
        if (req.last_ring >= 5) continue; // already at top ring
        if (req.units_fulfilled >= req.units_required) continue; // already fulfilled
        const ageMin = req.last_ring_at
          ? Math.floor((Date.now() - new Date(req.last_ring_at).getTime()) / 60_000)
          : null;
        if (ageMin === null || ageMin < req.escalation_timeout_minutes) continue;

        const nextRing = req.last_ring + 1;
        try {
          const result = await escalateRequest(c, { request: req, ring: nextRing });
          escalated.push({ request_id: req.id, ring: nextRing, ...result });
        } catch (err) {
          escalated.push({ request_id: req.id, ring: nextRing, error: err.message });
        }
      }
      return { escalated_count: escalated.length, escalated };
    },
  );
}

module.exports = {
  run,
  name: 'escalate_overdue',
  cron: '*/5 * * * *',
  description: 'Advance open requests to the next escalation ring',
};
