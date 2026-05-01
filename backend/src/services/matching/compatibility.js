/**
 * Compatibility lookup — returns the donor blood groups that can supply
 * a given recipient + component combination.
 *
 * Reads compatibility_matrix (immutable, advisor-confirmed seed) — never
 * computes ABO/Rh logic in code. The matrix is the source of truth.
 *
 * Returned ordering: same-group (is_preferred=TRUE) first, then fallback
 * groups. Callers can use this ordering to bias matching toward minimal
 * fallback usage.
 */

async function findCompatibleDonorGroups(client, { componentId, recipientGroupId }) {
  const r = await client.query(
    `SELECT donor_group_id, is_preferred, note
       FROM compatibility_matrix
      WHERE component_id = $1
        AND recipient_group_id = $2
        AND is_compatible = TRUE
   ORDER BY is_preferred DESC, donor_group_id ASC`,
    [componentId, recipientGroupId],
  );
  return r.rows;
}

module.exports = { findCompatibleDonorGroups };
