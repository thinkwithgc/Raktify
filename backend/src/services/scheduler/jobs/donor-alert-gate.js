/**
 * donor_alert_gate scheduler job.
 *
 * Ticks every minute. Finds pending_donor_alerts rows that are ready to fire
 * (scheduled_fire_at <= NOW() AND fired_at IS NULL AND held_at IS NULL)
 * and evaluates each via services/donor-alert-gate.evaluateAndFire.
 *
 * evaluateAndFire is responsible for shortfall recheck, cascade-vs-timer
 * decision, and the rate-limit-aware donor pool selection.
 *
 * node-cron uses a 5-field cron with 1-minute minimum resolution.  1 min
 * cadence gives 3 evaluation windows within a CRITICAL 3-min BB-exclusive
 * period, which is acceptable for the trust-first posture. Bypass-mode
 * (source='BD' / 'CT' / 'AD') sets scheduled_fire_at = NOW() so they fire
 * on the very next tick.
 */
const { withRlsContextRaw } = require('../../../middleware/rlsContext');
const { evaluateAndFire } = require('../../donor-alert-gate');
const { dispatchDonorAlertsFromGate } = require('../../notifications/dispatchDonorAlerts');
const logger = require('../../../config/logger');

async function run() {
  // Phase 1 (one transaction): evaluate + create the alert rows, collecting the
  // dispatch payloads. Phase 2 (after commit): send the notifications. Keeping
  // the send OUT of the alert-creation transaction means we never WhatsApp a
  // donor for an alert that rolls back, and notification_log.related_alert_id
  // (written on sendNotification's own connection) can see the committed alert.
  const dispatches = [];
  const summary = await withRlsContextRaw(
    { actor_role: 'system', change_reason: 'donor_alert_gate' },
    async (c) => {
      const rows = (
        await c.query(
          `SELECT request_id
             FROM pending_donor_alerts
            WHERE fired_at IS NULL
              AND held_at IS NULL
              AND scheduled_fire_at IS NOT NULL
              AND scheduled_fire_at <= NOW()
            ORDER BY scheduled_fire_at ASC
            LIMIT 100`,
        )
      ).rows;

      if (rows.length === 0) return { evaluated: 0, fired: 0 };

      let firedCount = 0;
      for (const row of rows) {
        try {
          const outcome = await evaluateAndFire(c, row.request_id);
          if (outcome.fired) firedCount += 1;
          if (outcome.dispatch) dispatches.push(outcome.dispatch);
        } catch (err) {
          logger.error(
            { request_id: row.request_id, err: err.message },
            'donor_alert_gate: evaluate failed',
          );
        }
      }
      return { evaluated: rows.length, fired: firedCount };
    },
  );

  // Phase 2 — post-commit dispatch. Each in its own short transaction so one
  // bad send can't poison the batch. Best-effort: the alert rows are the source
  // of truth; a missed send is recoverable via the /alert/:token path.
  let dispatched = 0;
  for (const payload of dispatches) {
    try {
      await withRlsContextRaw(
        { actor_role: 'system', change_reason: 'donor_alert_dispatch' },
        (c) => dispatchDonorAlertsFromGate(c, payload),
      );
      dispatched += 1;
    } catch (err) {
      logger.error(
        { request_id: payload.requestId, err: err.message },
        'donor_alert_gate: post-commit dispatch failed',
      );
    }
  }

  return { ...summary, dispatched };
}

module.exports = {
  name: 'donor_alert_gate',
  cron: '* * * * *', // every minute
  description:
    'Evaluate pending_donor_alerts, fire donor alerts when timer elapsed, respect holds + rechecks',
  run,
};
