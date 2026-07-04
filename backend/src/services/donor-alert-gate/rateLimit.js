/**
 * Donor-side rate limiting for alert-fatigue prevention (V2 spec §4).
 *
 * Selection rules for a request's donor pool:
 *
 *   1. Eligibility (existing): matching blood group, past next_eligible_date,
 *      is_available=TRUE, mobile_verified, consent_data_use, is_active,
 *      deferral_status='A', donor's district = request's hospital district
 *      (ring 1 — geographic ring expansion handled by services/escalation).
 *
 *   2. Fatigue cap: skip donors who received >= FATIGUE_CAP alerts in the
 *      last 7 days.
 *
 *   3. Recency skip: skip donors who received an alert in the last
 *      RECENCY_SKIP hours and didn't respond (accepted). This gives them a
 *      cool-off period regardless of their overall count.
 *
 *   4. Never double-alert: skip donors already in donor_alerts for THIS
 *      request (idempotency).
 *
 *   5. Ordering: reliability_score DESC → highest-response-rate donors first,
 *      keeping alert pool small and effective.
 *
 * NOTE for future: rare/Bombay-group donors should be exempt from fatigue
 * cap (life-critical uniqueness). Not implemented in v1 pool selection —
 * comes with the rare-blood-registry integration (post-Amravati pilot).
 */
const env = require('../../config/env');

async function selectDonorPool(
  client,
  { districtId, compatibleGroupIds, limit, excludeDonorsAlertedForRequest, attributedCommunityId },
) {
  if (compatibleGroupIds.length === 0) return [];

  const fatigueCap = env.matching.donorFatigueCapPerWeek;
  const recencySkipHr = env.matching.donorRecencySkipHr;

  // Community-first ordering (V2 spec §6). When the request is attributed
  // to a community, donors referred by the leader who OWNS that community
  // are surfaced first in the pool. Rate-limit + eligibility rules apply
  // uniformly — only the ORDER BY changes.
  //
  // Full "24hr exclusive community window" (fire community-only, wait, then
  // fire district) needs a state column on pending_donor_alerts + is a task
  // 77 companion piece. This priority sort covers the pragmatic 80% for
  // Amravati pilot.
  const r = await client.query(
    `WITH recent_alerts AS (
       SELECT donor_id,
              COUNT(*)::int AS alerts_7d,
              MAX(created_at) AS last_alert_at,
              BOOL_OR(status = 'AC') AS any_accepted_recently
         FROM donor_alerts
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY donor_id
     ),
     community_leader AS (
       -- The leader who owns the attributed community, if any.
       SELECT owner_community_leader_id AS leader_id
         FROM communities
        WHERE id = $7
     )
     SELECT d.id, d.blood_group_verified, d.reliability_score,
            d.village_id, d.latitude, d.longitude, d.preferred_contact_channel,
            d.preferred_language, d.whatsapp_opted_in, d.sms_opted_in,
            v.district_id AS donor_district_id,
            (d.referred_by_community_leader_id IS NOT NULL
             AND d.referred_by_community_leader_id
                 = (SELECT leader_id FROM community_leader)) AS is_community_member
       FROM donors d
  LEFT JOIN villages v ON v.id = d.village_id
  LEFT JOIN recent_alerts ra ON ra.donor_id = d.id
      WHERE d.blood_group_verified = ANY($2)
        AND d.deferral_status = 'A'
        AND d.is_available = TRUE
        AND d.mobile_verified = TRUE
        AND d.consent_data_use = TRUE
        AND (d.next_eligible_date IS NULL OR d.next_eligible_date <= CURRENT_DATE)
        AND d.is_active = TRUE
        AND (v.district_id = $1 OR v.district_id IS NULL)
        AND COALESCE(ra.alerts_7d, 0) < $4
        AND (
             ra.last_alert_at IS NULL
          OR ra.last_alert_at < NOW() - ($6::int * INTERVAL '1 hour')
          OR ra.any_accepted_recently = TRUE
        )
        AND NOT EXISTS (
             SELECT 1 FROM donor_alerts da
              WHERE da.donor_id = d.id AND da.request_id = $5
        )
   ORDER BY (d.referred_by_community_leader_id IS NOT NULL
             AND d.referred_by_community_leader_id
                 = (SELECT leader_id FROM community_leader)) DESC,
            d.reliability_score DESC, d.created_at ASC
      LIMIT $3`,
    [
      districtId,
      compatibleGroupIds,
      limit,
      fatigueCap,
      excludeDonorsAlertedForRequest,
      recencySkipHr,
      attributedCommunityId || null,
    ],
  );
  return r.rows;
}

module.exports = { selectDonorPool };
