/**
 * Donation eligibility check (spec §6).
 *
 * Run BEFORE INSERT into donation_history. Confirms:
 *   1. donor.deferral_status = 'A' (Active — not Temp/Permanent deferred)
 *   2. donor.next_eligible_date <= today (donation gap respected)
 *   3. hb_gdl >= blood_components.min_donor_hb_male / female for the donor's gender
 *   4. donor.mobile_verified (registered AND verified, not a phantom record)
 *
 * Returns { ok: true } or { ok: false, error: '...', detail: {...} }.
 *
 * Note: shelf-life and TTI gating happen at the DB layer via triggers.
 * This service only enforces the donor-side checks the API needs to give
 * a useful error message before the DB rejects with a CHECK constraint.
 */

async function validateDonation(client, { donorId, componentId, hbGdl }) {
  const donor = await client.query(
    `SELECT id, gender, deferral_status, deferral_until, next_eligible_date,
            mobile_verified, blood_group_verified, is_active
       FROM donors WHERE id = $1`,
    [donorId],
  );
  if (donor.rowCount === 0) return { ok: false, error: 'donor_not_found' };
  const d = donor.rows[0];

  if (!d.is_active) return { ok: false, error: 'donor_inactive' };
  if (!d.mobile_verified) return { ok: false, error: 'donor_mobile_not_verified' };
  if (d.blood_group_verified == null) {
    return { ok: false, error: 'donor_blood_group_not_lab_verified' };
  }
  if (d.deferral_status !== 'A') {
    return {
      ok: false,
      error: 'donor_deferred',
      detail: { deferral_status: d.deferral_status, deferral_until: d.deferral_until },
    };
  }
  if (d.next_eligible_date && new Date(d.next_eligible_date) > new Date()) {
    return {
      ok: false,
      error: 'donation_gap_not_met',
      detail: { next_eligible_date: d.next_eligible_date },
    };
  }

  // Hb threshold per component + gender
  const comp = await client.query(
    `SELECT min_donor_hb_male, min_donor_hb_female
       FROM blood_components WHERE id = $1`,
    [componentId],
  );
  if (comp.rowCount === 0) return { ok: false, error: 'unknown_component' };
  const minHb =
    d.gender === 'M' ? comp.rows[0].min_donor_hb_male : comp.rows[0].min_donor_hb_female;
  if (hbGdl != null && Number(hbGdl) < Number(minHb)) {
    return {
      ok: false,
      error: 'hb_below_threshold',
      detail: { hb_gdl: Number(hbGdl), min_required: Number(minHb), gender: d.gender },
    };
  }

  return { ok: true };
}

module.exports = { validateDonation };
