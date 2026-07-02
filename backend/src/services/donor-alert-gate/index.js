/**
 * Donor Alert Gate (V2 spec §2).
 *
 * The matcher no longer fires donor_alerts synchronously — a naïve "ping
 * donors immediately" flow causes alert fatigue as BBs would-have-fulfilled
 * silently. Instead the matcher writes to pending_donor_alerts with a
 * scheduled_fire_at based on urgency tier. This service is the evaluator:
 *
 *   - CRITICAL requests get a 3-min BB-exclusive window (config)
 *   - URGENT requests get a 30-min window
 *   - PLANNED never fires; existing planned_request_upgrade auto-upgrades
 *     to URGENT 4 hours before need_by
 *
 * Bypass paths (fire immediately, ignoring the timer):
 *
 *   - All eligible BBs (BBs with compatible AV stock in-district) have marked
 *     "Can't fulfill" with reason='NS' → cascade fires
 *   - Coordinator clicks "Alert donors NOW" → trigger_source='CT'
 *   - Admin override → trigger_source='AD'
 *
 * Fire-time gates:
 *
 *   - Recheck shortfall (may have been offered in the interim)
 *   - Skip if held (coordinator paused donor alerts)
 *   - Skip if request already fulfilled or cancelled
 *
 * Pool selection is delegated to rateLimit.selectDonorPool which enforces
 * the "2 alerts / week / donor" fatigue cap + reliability-first ordering.
 */
const env = require('../../config/env');
const logger = require('../../config/logger');
const { findCompatibleDonorGroups } = require('../matching/compatibility');
const { createAlerts } = require('../matching/donors');
const { selectDonorPool } = require('./rateLimit');
const { areAllEligibleBBsDeclined } = require('./cascade');

/**
 * Write a pending_donor_alerts row (upsert) with scheduled_fire_at derived
 * from the urgency tier. Idempotent — repeated calls (e.g., from re-match)
 * overwrite the schedule but preserve the created_at + created_by.
 *
 * source options: 'AT' auto-timer (default), 'BD' bb-decline-cascade,
 *                 'CT' coord-triggered, 'AD' admin-manual
 */
async function schedulePendingAlert(client, { request, actorUserId, source = 'AT', shortfall }) {
  const windowMin = pickWindowMin(request.urgency_tier);
  if (windowMin === null && source === 'AT') {
    // PLANNED — never auto-fires; planned_request_upgrade job handles it.
    return { skipped: true, reason: 'planned_never_fires' };
  }

  // Minutes-until-fire: for AT (auto-timer) use the urgency window; for
  // BD/CT/AD (bypass sources) use 0 so the scheduler picks it up next tick.
  const scheduledMinutes = source === 'AT' ? windowMin : 0;

  await client.query(
    `INSERT INTO pending_donor_alerts (
       request_id, scheduled_fire_at, trigger_source,
       urgency_snapshot, shortfall_snapshot, created_by)
     VALUES ($1, clock_timestamp() + ($6::int * INTERVAL '1 minute'),
             $2, $3, $4, $5)
     ON CONFLICT (request_id) DO UPDATE
       SET scheduled_fire_at = EXCLUDED.scheduled_fire_at,
           trigger_source = EXCLUDED.trigger_source,
           urgency_snapshot = EXCLUDED.urgency_snapshot,
           shortfall_snapshot = EXCLUDED.shortfall_snapshot,
           evaluated_at = NULL,
           fired_at = NULL,
           held_at = NULL,
           held_by = NULL,
           held_reason = NULL,
           fire_skip_reason = NULL`,
    [request.id, source, request.urgency_tier, shortfall, actorUserId, scheduledMinutes],
  );

  return { scheduled: true, source, windowMin };
}

function pickWindowMin(urgencyTier) {
  if (urgencyTier === 'CR') return env.matching.donorAlertWindowCrMin;
  if (urgencyTier === 'UR') return env.matching.donorAlertWindowUrMin;
  return null; // PLANNED
}

/**
 * Evaluate a single pending alert row. Called by the scheduler for every
 * row where scheduled_fire_at <= NOW() AND fired_at IS NULL AND held_at IS NULL.
 * Returns { fired: boolean, alerts_created, skip_reason }.
 */
async function evaluateAndFire(client, requestId) {
  // Fetch full request state
  const reqRow = (
    await client.query(
      `SELECT br.id, br.status, br.urgency_tier, br.units_required, br.units_fulfilled,
              br.donor_activation_required, br.requesting_hospital_district_id,
              br.component_id, br.patient_blood_group_id,
              br.attributed_community_id
         FROM blood_requests br
        WHERE br.id = $1`,
      [requestId],
    )
  ).rows[0];
  if (!reqRow) {
    await markSkip(client, requestId, 'request_not_found');
    return { fired: false, skip_reason: 'request_not_found' };
  }
  if (!['OP', 'MT', 'AS', 'PF'].includes(reqRow.status)) {
    await markSkip(client, requestId, `request_status_${reqRow.status}`);
    return { fired: false, skip_reason: `request_status_${reqRow.status}` };
  }

  // Recheck shortfall via committed bags (may have been offered since scheduling)
  const committed = (
    await client.query(
      `SELECT COUNT(*)::int AS n
         FROM blood_inventory
        WHERE reserved_for_request_id = $1
          AND status IN ('RE','IS','TR')`,
      [requestId],
    )
  ).rows[0].n;
  const shortfall = reqRow.units_required - committed;
  if (shortfall <= 0) {
    await markSkip(client, requestId, 'request_fulfilled');
    return { fired: false, skip_reason: 'request_fulfilled' };
  }
  if (!reqRow.donor_activation_required) {
    await markSkip(client, requestId, 'donor_activation_not_required');
    return { fired: false, skip_reason: 'donor_activation_not_required' };
  }

  // Compatible donor groups
  const compat = await findCompatibleDonorGroups(client, {
    componentId: reqRow.component_id,
    recipientGroupId: reqRow.patient_blood_group_id,
  });
  const compatibleGroupIds = compat.map((c) => c.donor_group_id);
  if (compatibleGroupIds.length === 0) {
    await markSkip(client, requestId, 'no_compatible_donor_groups');
    return { fired: false, skip_reason: 'no_compatible_donor_groups' };
  }

  // Select the donor pool (rate-limit-aware, community-first, reliability-first)
  const pool = await selectDonorPool(client, {
    districtId: reqRow.requesting_hospital_district_id,
    compatibleGroupIds,
    limit: env.matching.donorAlertPoolSizeCap,
    excludeDonorsAlertedForRequest: requestId,
    attributedCommunityId: reqRow.attributed_community_id,
  });
  if (pool.length === 0) {
    await markSkip(client, requestId, 'no_eligible_donors_in_pool');
    return { fired: false, skip_reason: 'no_eligible_donors_in_pool' };
  }

  const alertsCreated = await createAlerts(client, { requestId, donors: pool });

  await client.query(
    `UPDATE pending_donor_alerts
        SET fired_at = clock_timestamp(),
            fired_alert_count = $2,
            evaluated_at = clock_timestamp()
      WHERE request_id = $1`,
    [requestId, alertsCreated],
  );

  logger.info(
    {
      request_id: requestId,
      alerts_created: alertsCreated,
      pool_size: pool.length,
    },
    'donor-alert-gate: alerts fired',
  );

  return { fired: true, alerts_created: alertsCreated, pool_size: pool.length };
}

async function markSkip(client, requestId, reason) {
  await client.query(
    `UPDATE pending_donor_alerts
        SET evaluated_at = clock_timestamp(),
            fire_skip_reason = $2
      WHERE request_id = $1`,
    [requestId, reason],
  );
}

/**
 * Coordinator "Hold donor alerts" — suppresses fire even if timer elapses.
 */
async function holdAlert(client, { requestId, actorUserId, reason }) {
  await client.query(
    `UPDATE pending_donor_alerts
        SET held_at = clock_timestamp(),
            held_by = $2,
            held_reason = $3
      WHERE request_id = $1`,
    [requestId, actorUserId, reason || null],
  );
}

/**
 * Coordinator "Alert donors NOW" — bypasses timer, fires immediately by
 * setting scheduled_fire_at = NOW() and clearing any hold. Scheduler picks
 * up on next tick.
 */
async function triggerNow(client, { actorUserId, request }) {
  const shortfall = request.units_required - (request.units_fulfilled || 0);
  return schedulePendingAlert(client, {
    request,
    actorUserId,
    source: 'CT',
    shortfall,
  });
}

/**
 * Fires the BB-decline-cascade check for a request. Called from the decline
 * endpoint after every 'NS' decline. If all eligible BBs have declined with
 * NS, upserts pending_donor_alerts with scheduled_fire_at = NOW() so donors
 * are alerted on next scheduler tick (zero-timer bypass per spec).
 */
async function evaluateCascade(client, { requestId, actorUserId }) {
  const request = (
    await client.query(
      `SELECT id, urgency_tier, units_required, units_fulfilled,
              donor_activation_required, requesting_hospital_district_id,
              component_id, patient_blood_group_id
         FROM blood_requests WHERE id = $1`,
      [requestId],
    )
  ).rows[0];
  if (!request) return { cascaded: false, reason: 'request_not_found' };

  const cascade = await areAllEligibleBBsDeclined(client, request);
  if (!cascade.declined) return { cascaded: false, ...cascade };

  const shortfall = request.units_required - (request.units_fulfilled || 0);
  await schedulePendingAlert(client, {
    request,
    actorUserId,
    source: 'BD',
    shortfall,
  });
  logger.info({ request_id: requestId, cascade }, 'donor-alert-gate: bb-decline cascade fired');
  return { cascaded: true, ...cascade };
}

module.exports = {
  schedulePendingAlert,
  evaluateAndFire,
  evaluateCascade,
  holdAlert,
  triggerNow,
};
