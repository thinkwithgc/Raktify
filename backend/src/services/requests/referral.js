/**
 * Hospital onboarding-lead upsert — the growth flywheel.
 *
 * When a citizen raises a request naming a hospital that ISN'T on Raktify, that
 * hospital becomes an `institution_referrals` lead. Many relatives of patients
 * at the same un-onboarded hospital must roll up into ONE lead with a rising
 * referrer_count (a strong "go onboard this hospital" signal), not many leads —
 * enforced by the partial unique index uq_referral_open_target (migration 303)
 * and this ON CONFLICT upsert. A donor is only counted once per lead.
 *
 * Data-model note: referrer_count is a GENERATED column
 * (1 + len(referrer_donor_ids)) — the "+1" is primary_referrer_id (the FIRST
 * referrer), and referrer_donor_ids holds every SUBSEQUENT distinct referrer.
 * So never write referrer_count, keep the primary OUT of the array, and only
 * append a donor who is neither the primary nor already listed.
 *
 * `donorId` is a donors.id (primary_referrer_id FKs to donors) and may be NULL:
 * a citizen raising a request need not have a full donor profile (the mobile
 * gets a thin platform_users row on first OTP, no donors row until they
 * register). A NULL referrer still creates a valuable lead — we just don't link
 * a donor, and never append NULL to the array.
 */
async function recordHospitalReferral(client, { name, districtId, address, donorId }) {
  const r = await client.query(
    `INSERT INTO institution_referrals
        (target_kind, target_name, target_district_id, target_address,
         primary_referrer_id, referrer_donor_ids, funnel_status)
      VALUES ('HO', $1, $2, $3, $4, ARRAY[]::uuid[], 'NE')
      ON CONFLICT (target_kind, lower(target_name), target_district_id)
        WHERE onboarded_institution_id IS NULL
      DO UPDATE SET
        -- adopt the first profiled referrer as primary if the lead started with none
        primary_referrer_id = COALESCE(institution_referrals.primary_referrer_id, $4),
        referrer_donor_ids = CASE
          WHEN $4 IS NULL THEN institution_referrals.referrer_donor_ids
          WHEN institution_referrals.primary_referrer_id = $4
            OR institution_referrals.referrer_donor_ids @> ARRAY[$4]::uuid[]
            THEN institution_referrals.referrer_donor_ids
          ELSE array_append(institution_referrals.referrer_donor_ids, $4) END,
        updated_at = clock_timestamp()
      RETURNING id`,
    [name, districtId, address || null, donorId],
  );
  return r.rows[0].id;
}

module.exports = { recordHospitalReferral };
