/**
 * Donation attribution (V2 spec §5 refinement 2).
 *
 * When a BB records a donation, this service looks up any active
 * donor_alert_choices for the donor that could be fulfilled by this
 * donation (matching component + compatible blood group). It supports:
 *
 *   • lookupCandidates()  — returns the pending choices this donation
 *                            could fulfil (BB uses this to render a
 *                            dropdown when multiple matches exist)
 *
 *   • applyAttribution()  — after INSERT, links the donation to the
 *                            chosen donor_alert_choice, updates the
 *                            choice status to 'DO', increments the
 *                            request's fulfilment counter, tags
 *                            donation_history.donation_type='DA', and
 *                            handles replacement obligations if any.
 *
 * Rules:
 *   • 0 candidates → treat as regular voluntary walk-in (donation_type='VO')
 *   • 1 candidate  → auto-attribute
 *   • 2+ candidates → BB dropdown at recording time; POST /donations
 *                     accepts an explicit attribute_to_choice_id override.
 */

/**
 * Find the set of active donor_alert_choices this donor could fulfil with
 * the given donation. Filters by:
 *   - donor_id matches
 *   - status in PE (pending) or AR (arrived) — not yet donated
 *   - deadline_at not passed
 *   - request status still open (OP/MT/AS/PF)
 *   - blood group + component compatible with the donation
 *   - chosen BB matches OR is null (some flows may not lock the BB)
 */
async function lookupCandidates(client, { donorId, componentId, bloodGroupId, bloodBankId }) {
  const r = await client.query(
    `SELECT dac.id AS choice_id,
            dac.request_id,
            dac.status,
            dac.deadline_at,
            dac.chosen_blood_bank_id,
            br.request_number,
            br.urgency_tier,
            br.units_required,
            br.patient_blood_group_id,
            br.component_id,
            cm.is_preferred
       FROM donor_alert_choices dac
       JOIN blood_requests br ON br.id = dac.request_id
       JOIN compatibility_matrix cm
         ON cm.component_id = br.component_id
        AND cm.donor_group_id = $3
        AND cm.recipient_group_id = br.patient_blood_group_id
        AND cm.is_compatible = TRUE
      WHERE dac.donor_id = $1
        AND dac.status IN ('PE', 'AR')
        AND dac.deadline_at > NOW()
        AND br.status IN ('OP', 'MT', 'AS', 'PF')
        AND br.component_id = $2
        AND (dac.chosen_blood_bank_id = $4 OR dac.chosen_blood_bank_id IS NULL)
   ORDER BY dac.accepted_at ASC`,
    [donorId, componentId, bloodGroupId, bloodBankId],
  );
  return r.rows;
}

/**
 * Apply attribution: link donation to a specific choice, mark choice as
 * done, update request fulfilment, tag donation type. Also increments any
 * matching replacement_obligation.
 *
 * Elevates actor_role to 'system' briefly for the choice UPDATE + request
 * fulfilment UPDATE so RLS write policies allow it.
 */
async function applyAttribution(client, { donationId, choiceId }) {
  const prior = (await client.query(`SELECT current_setting('raktify.actor_role', TRUE) AS r`))
    .rows[0].r;
  await client.query(`SELECT set_config('raktify.actor_role', 'system', TRUE)`);
  try {
    // Link + status flip. Guard status transition so we don't over-write DO/NS/DE/CN.
    const choiceRow = (
      await client.query(
        `UPDATE donor_alert_choices
            SET status = 'DO',
                donation_id = $2,
                arrived_at = COALESCE(arrived_at, clock_timestamp())
          WHERE id = $1
            AND status IN ('PE', 'AR')
      RETURNING request_id, chosen_blood_bank_id`,
        [choiceId, donationId],
      )
    ).rows[0];
    if (!choiceRow) return { attributed: false, reason: 'choice_not_active' };

    // Tag donation type = 'DA' (donor-response-to-request)
    await client.query(`UPDATE donation_history SET donation_type = 'DA' WHERE id = $1`, [
      donationId,
    ]);

    // Handle replacement obligation for this BB, if any.
    await client.query(
      `UPDATE replacement_obligations
          SET units_fulfilled = LEAST(units_fulfilled + 1, units_target),
              fulfilled_at = CASE
                WHEN units_fulfilled + 1 >= units_target
                  THEN clock_timestamp() ELSE fulfilled_at END
        WHERE request_id = $1
          AND blood_bank_id = $2
          AND fulfilled_at IS NULL`,
      [choiceRow.request_id, choiceRow.chosen_blood_bank_id],
    );

    return {
      attributed: true,
      request_id: choiceRow.request_id,
      blood_bank_id: choiceRow.chosen_blood_bank_id,
    };
  } finally {
    await client.query(`SELECT set_config('raktify.actor_role', $1, TRUE)`, [prior || '']);
  }
}

module.exports = { lookupCandidates, applyAttribution };
