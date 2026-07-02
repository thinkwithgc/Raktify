/**
 * Escalation engine (spec §7).
 *
 * Each ring expands the search:
 *   ring 1 → district           (fired by runMatch on initial match)
 *   ring 2 → state-wide         (radius 150 km)
 *   ring 3 → adjacent states; for rare blood groups → national immediately
 *   ring 4 → DHO contact (WhatsApp + voice call to district health officer)
 *   ring 5 → ngo_admin voice call (CRITICAL only, after 30 min unresolved)
 *
 * The scheduled `escalate_overdue` job runs every escalation_timeout_minutes
 * (computed per request from urgency_tier) and calls escalateRequest() for
 * each open request whose latest ring is older than its timeout. The job
 * itself lands in Phase 6 (it is a notification-emitting cron). What lives
 * here is the per-ring widening logic.
 */
const { findActivatableDonors, createAlerts } = require('../matching/donors');
const { findCompatibleDonorGroups } = require('../matching/compatibility');

const RADIUS_BY_RING = { 2: 150, 3: 500 };

async function escalateRequest(
  client,
  { request, ring, triggeredBy = 'AU', triggeredByUserId = null },
) {
  if (ring < 2 || ring > 5) {
    throw new Error(`escalateRequest: ring must be 2..5 (got ${ring})`);
  }

  // Look up state ids in scope (ring 2: same state; ring 3: adjacent — for the
  // scaffold we just include all active states. A future migration will add an
  // adjacency table.)
  let stateIds = [];
  if (ring === 2 || ring === 3) {
    const r = await client.query(
      `SELECT id FROM states WHERE is_active = TRUE` +
        (ring === 2 ? ` AND id = (SELECT state_id FROM districts WHERE id = $1)` : ''),
      ring === 2 ? [request.requesting_hospital_district_id] : [],
    );
    stateIds = r.rows.map((r) => r.id);
  }

  // Re-run donor search across the expanded geography.
  const compat = await findCompatibleDonorGroups(client, {
    componentId: request.component_id,
    recipientGroupId: request.patient_blood_group_id,
  });
  const compatibleGroupIds = compat.map((c) => c.donor_group_id);

  let alertsCreated = 0;
  if (request.donor_activation_required && (ring === 2 || ring === 3)) {
    // Find donors in the broader geography. We approximate "adjacent states"
    // by using the active states list — replace with an adjacency table.
    const r = await client.query(
      `SELECT d.id, d.preferred_contact_channel, d.reliability_score
         FROM donors d
    LEFT JOIN villages v ON v.id = d.village_id
        WHERE d.blood_group_verified = ANY($1)
          AND d.deferral_status = 'A'
          AND d.is_available = TRUE
          AND d.mobile_verified = TRUE
          AND d.consent_data_use = TRUE
          AND (d.next_eligible_date IS NULL OR d.next_eligible_date <= CURRENT_DATE)
          AND d.is_active = TRUE
          AND v.state_id = ANY($2)
     ORDER BY d.reliability_score DESC
        LIMIT 200`,
      [compatibleGroupIds, stateIds],
    );
    const alertRows = await createAlerts(client, { requestId: request.id, donors: r.rows });
    alertsCreated = alertRows.length;
  }

  // Append the escalation_log row. escalation_log is append-only — we cannot
  // change a prior ring's row here.
  await client.query(
    `INSERT INTO escalation_log (
       request_id, ring, triggered_by, triggered_by_user_id,
       radius_km, search_state_ids, donors_alerted_count,
       dho_district_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (request_id, ring) DO NOTHING`,
    [
      request.id,
      ring,
      triggeredBy,
      triggeredByUserId,
      RADIUS_BY_RING[ring] || null,
      stateIds,
      alertsCreated,
      ring === 4 ? request.requesting_hospital_district_id : null,
    ],
  );

  return {
    ring,
    state_ids_scope: stateIds,
    donor_alerts_created: alertsCreated,
    dho_alerted: ring === 4,
    ngo_admin_called: ring === 5,
  };
}

module.exports = { escalateRequest, RADIUS_BY_RING };

// Re-export so the caller doesn't need to import from matching for compat.
module.exports.findActivatableDonors = findActivatableDonors;
