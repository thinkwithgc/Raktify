/**
 * Donor merge — moves all dependent rows from secondary → primary, marks
 * secondary inactive, copies worst-case deferral status.
 *
 * STATUS: stub. The merge is invoked from POST /donors/merge (ngo_admin).
 *
 * Spec §5.3 — must run inside one transaction. Tables to re-point:
 *   donation_history, donor_screening, donor_alerts, blood_inventory,
 *   lookback_registry, screening_audit_log, rare_blood_registry,
 *   thalassemia_patients.paired_donor_ids[]
 *
 * Worst-case deferral logic:
 *   primary.deferral_status = max(primary, secondary) where
 *     P (Permanent) > T (Temporary) > A (Active)
 *
 * Side effects:
 *   - secondary.merged_into = primary.id
 *   - secondary.is_active = FALSE
 *   - primary.alternate_mobiles += secondary.mobile (encrypted) and
 *     secondary.alternate_mobiles[*]
 *   - audit_log records a MERGE event
 *
 * TODO: full implementation in next session — patient-safety review needed
 *       before this lands. Confirm with medical advisor that worst-case
 *       deferral merging is the desired clinical default (vs. the strictest
 *       individual deferral_until date).
 */

async function mergeDonors(_client, _primaryId, _secondaryId) {
  throw new Error(
    'donor merge not implemented yet — requires patient-safety review of deferral merging rules',
  );
}

module.exports = { mergeDonors };
