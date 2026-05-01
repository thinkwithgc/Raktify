/**
 * Inventory matching — finds available bags compatible with a request and
 * (optionally) reserves them.
 *
 * Spec §7 step 1+2:
 *   Query blood_inventory WHERE
 *     blood_bank_id IN (onboarded banks in the request's district)
 *     AND blood_group_id IN (compatible groups for the patient's group)
 *     AND component_id = requested
 *     AND status = 'AV'
 *     AND expiry_date > NOW()
 *     AND is_recalled = FALSE
 *   ORDER BY is_preferred DESC, expiry_date ASC (FIFO + same-group first)
 *
 * The "is_preferred" sort key requires a join against compatibility_matrix
 * keyed on (component_id, donor_group_id, recipient_group_id).
 *
 * Reservation: status='RE', reserved_for_request_id=req.id, reserved_at=NOW().
 * The blood_inventory row has a reserve_consistency CHECK that enforces both
 * fields move together — we satisfy it by setting both in one UPDATE.
 */

async function findAvailableBags(client, { districtId, recipientGroupId, componentId, limit }) {
  const r = await client.query(
    `SELECT bi.id, bi.blood_bank_id, bi.blood_group_id, bi.expiry_date,
            cm.is_preferred
       FROM blood_inventory bi
       JOIN institutions i ON i.id = bi.blood_bank_id
       JOIN compatibility_matrix cm
         ON cm.component_id = bi.component_id
        AND cm.donor_group_id = bi.blood_group_id
        AND cm.recipient_group_id = $2
      WHERE i.district_id = $1
        AND bi.component_id = $3
        AND bi.status = 'AV'
        AND bi.expiry_date > CURRENT_DATE
        AND bi.is_recalled = FALSE
        AND cm.is_compatible = TRUE
   ORDER BY cm.is_preferred DESC, bi.expiry_date ASC
      LIMIT $4`,
    [districtId, recipientGroupId, componentId, limit],
  );
  return r.rows;
}

async function reserveBags(client, { bagIds, requestId, actorUserId }) {
  if (bagIds.length === 0) return 0;
  const r = await client.query(
    `UPDATE blood_inventory
        SET status = 'RE',
            reserved_for_request_id = $2,
            reserved_at = clock_timestamp(),
            status_changed_by = $3
      WHERE id = ANY($1)
        AND status = 'AV'
        AND is_recalled = FALSE
   RETURNING id`,
    [bagIds, requestId, actorUserId],
  );
  return r.rowCount;
}

module.exports = { findAvailableBags, reserveBags };
