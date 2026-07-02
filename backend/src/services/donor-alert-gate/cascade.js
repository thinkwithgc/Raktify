/**
 * BB-decline cascade check (V2 spec §1).
 *
 * A request is "cascaded" when every blood bank that CAN help (i.e., every
 * BB with compatible AV stock in the request's district) has voluntarily
 * marked "Can't fulfill" with reason='NS' (no stock). At that moment BBs
 * have collectively declared shortage — no reason to keep donors waiting
 * for the urgency-tier timer to expire.
 *
 * BBs that never had compatible stock in the first place are irrelevant to
 * the cascade — they weren't eligible to help, so their silence doesn't
 * block the alert.
 *
 * Only NS declines count: NC (no capacity) and ND (not on duty) mean the BB
 * physically can't process donations today, so cascading to donors doesn't
 * help. Those declines just remove the BB from donor routing, not from the
 * cascade check.
 */

async function areAllEligibleBBsDeclined(client, request) {
  // Eligible BBs = BBs in this district with at least 1 compatible AV bag.
  const eligible = (
    await client.query(
      `SELECT COUNT(DISTINCT bi.blood_bank_id)::int AS n
         FROM blood_inventory bi
         JOIN institutions i ON i.id = bi.blood_bank_id
         JOIN compatibility_matrix cm
           ON cm.component_id = bi.component_id
          AND cm.donor_group_id = bi.blood_group_id
          AND cm.recipient_group_id = $2
          AND cm.is_compatible = TRUE
        WHERE i.district_id = $1
          AND bi.component_id = $3
          AND bi.status = 'AV'
          AND bi.is_recalled = FALSE
          AND bi.expiry_date > CURRENT_DATE
          AND bi.reserved_for_request_id IS NULL`,
      [
        request.requesting_hospital_district_id,
        request.patient_blood_group_id,
        request.component_id,
      ],
    )
  ).rows[0].n;

  // Zero eligible BBs = no cascade to check; donor alerts are the only path.
  // Report "declined" so the caller schedules an immediate fire.
  if (eligible === 0) {
    return { declined: true, eligible_bbs: 0, ns_declines: 0, reason: 'no_eligible_bbs' };
  }

  // NS declines still-in-force for this request
  const nsDeclines = (
    await client.query(
      `SELECT COUNT(*)::int AS n
         FROM open_request_bb_declines
        WHERE request_id = $1
          AND reason = 'NS'
          AND expires_at > NOW()`,
      [request.id],
    )
  ).rows[0].n;

  return {
    declined: nsDeclines >= eligible,
    eligible_bbs: eligible,
    ns_declines: nsDeclines,
  };
}

module.exports = { areAllEligibleBBsDeclined };
