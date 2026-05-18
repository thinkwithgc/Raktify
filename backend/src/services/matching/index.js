/**
 * Matching engine orchestrator (spec §7).
 *
 * Run after a request is created (or manually re-run via POST
 * /requests/:id/match). Steps:
 *
 *   1. Find compatible donor groups for (component_id, recipient_group_id)
 *   2. Find available bags in the request's district. Reserve up to
 *      units_required.
 *   3. If insufficient AND donor_activation_required=TRUE, find activatable
 *      donors and create donor_alerts rows. Notification dispatch is
 *      decoupled — Phase 6 picks alerts off donor_alerts and sends via
 *      sendNotification(). For now we set channel from donor preference.
 *   4. Insert the ring=1 escalation_log row so the scheduler knows the
 *      district sweep happened.
 *
 * Returns a summary the route handler surfaces in the response.
 */
const { findCompatibleDonorGroups } = require('./compatibility');
const { findAvailableBags, reserveBags } = require('./inventory');
const { findActivatableDonors, createAlerts } = require('./donors');

/**
 * runMatch is a system side effect — invoked from request creation, manual
 * re-trigger, or coordinator verify. Its inserts into donor_alerts and
 * escalation_log are gated by RLS policies that allow only 'system' /
 * coordinator / admin. We elevate the actor_role to 'system' for the duration
 * and restore the prior value before returning so the caller's audit context
 * survives.
 */
async function runMatch(client, { request, actorUserId }) {
  const prior = (await client.query(`SELECT current_setting('raktify.actor_role', TRUE) AS r`))
    .rows[0].r;
  await client.query(`SELECT set_config('raktify.actor_role', 'system', TRUE)`);
  try {
    return await runMatchImpl(client, { request, actorUserId });
  } finally {
    await client.query(`SELECT set_config('raktify.actor_role', $1, TRUE)`, [prior || '']);
  }
}

async function runMatchImpl(client, { request, actorUserId }) {
  // 1. Compatibility lookup
  const compat = await findCompatibleDonorGroups(client, {
    componentId: request.component_id,
    recipientGroupId: request.patient_blood_group_id,
  });
  const compatibleGroupIds = compat.map((c) => c.donor_group_id);
  const sameGroupId = compat.find((c) => c.is_preferred)?.donor_group_id;

  // 2. Inventory pull
  const candidateBags = await findAvailableBags(client, {
    districtId: request.requesting_hospital_district_id,
    recipientGroupId: request.patient_blood_group_id,
    componentId: request.component_id,
    limit: request.units_required - request.units_fulfilled,
  });

  const sameGroupBags = candidateBags.filter((b) => b.is_preferred);
  const fallbackBags = candidateBags.filter((b) => !b.is_preferred);
  const usingFallback = sameGroupBags.length < request.units_required - request.units_fulfilled;
  const bagsToReserve = candidateBags.slice(0, request.units_required - request.units_fulfilled);

  let bagsReserved = 0;
  if (bagsToReserve.length > 0) {
    bagsReserved = await reserveBags(client, {
      bagIds: bagsToReserve.map((b) => b.id),
      requestId: request.id,
      actorUserId,
    });
  }

  // Decide request status update based on what was reserved
  const reservedFromOneBank = new Set(bagsToReserve.map((b) => b.blood_bank_id));
  const matchedBloodBankId = reservedFromOneBank.size === 1 ? [...reservedFromOneBank][0] : null;
  const fullyMatched = bagsReserved >= request.units_required - request.units_fulfilled;
  const fallbackUsed = usingFallback || bagsToReserve.some((b) => b.blood_group_id !== sameGroupId);

  if (bagsReserved > 0) {
    await client.query(
      `UPDATE blood_requests
          SET status = CASE WHEN $4 THEN 'MT' ELSE status END,
              matched_blood_bank_id = COALESCE($1, matched_blood_bank_id),
              first_match_found_at = COALESCE(first_match_found_at, clock_timestamp()),
              compatibility_fallback_used = compatibility_fallback_used OR $2,
              fallback_blood_group_id = CASE
                WHEN $2 AND fallback_blood_group_id IS NULL
                  THEN $3 ELSE fallback_blood_group_id END
        WHERE id = $5`,
      [
        matchedBloodBankId,
        fallbackUsed,
        bagsToReserve[0]?.blood_group_id || null,
        fullyMatched,
        request.id,
      ],
    );
  }

  // 3. Donor alerts (only when insufficient + activation required)
  let alertsCreated = 0;
  let activatableDonors = [];
  if (!fullyMatched && request.donor_activation_required) {
    activatableDonors = await findActivatableDonors(client, {
      districtId: request.requesting_hospital_district_id,
      compatibleGroupIds,
      limit: 50, // Cap initial alert volume; ring 2 expands geography
    });
    alertsCreated = await createAlerts(client, {
      requestId: request.id,
      donors: activatableDonors,
    });
  }

  // 4. Escalation log ring=1 (district sweep)
  await client.query(
    `INSERT INTO escalation_log (
       request_id, ring, triggered_by, triggered_by_user_id,
       radius_km, search_state_ids, donors_alerted_count)
     VALUES ($1, 1, 'AU', $2, 50, ARRAY[]::INTEGER[], $3)
     ON CONFLICT (request_id, ring) DO NOTHING`,
    [request.id, actorUserId, alertsCreated],
  );

  return {
    request_id: request.id,
    bags_reserved: bagsReserved,
    bags_required: request.units_required - request.units_fulfilled,
    fully_matched_from_inventory: fullyMatched,
    fallback_used: fallbackUsed,
    fallback_blood_group_id: fallbackUsed ? bagsToReserve[0]?.blood_group_id : null,
    matched_blood_bank_id: matchedBloodBankId,
    same_group_bags_available: sameGroupBags.length,
    fallback_group_bags_available: fallbackBags.length,
    donor_alerts_created: alertsCreated,
    donors_to_alert: activatableDonors.length,
    compatible_donor_group_ids: compatibleGroupIds,
  };
}

module.exports = { runMatch };
