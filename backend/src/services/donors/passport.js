/**
 * Donor health passport (spec §5).
 *
 * Returns the donor's complete record from the donor's perspective:
 *   - profile (name, blood group with verified/unverified badge)
 *   - donation history with source labels (V=Verified, S=Self-reported,
 *     R=Retroactively verified)
 *   - hemoglobin readings per verified donation
 *   - overall_clearance status WITHOUT individual TTI fields
 *   - next_eligible_date with component breakdown
 *
 * Privacy invariants:
 *   - Self-reported donations get an "Unverified — not used in matching" label
 *   - Verified blood group renders as "Lab verified: B+"; self-reported as
 *     "Self-reported (unverified): B+" with visual distinction signal
 *   - donor_screening individual fields are NEVER returned — only the
 *     overall_clearance string maps to PE/CL/IN
 */

const { open } = require('../pii');

async function buildPassport(client, donorId) {
  // Profile
  const profileR = await client.query(
    `SELECT d.id, d.full_name, d.date_of_birth, d.gender, d.preferred_language,
            d.blood_group_self_reported, d.blood_group_verified,
            d.blood_group_verified_at,
            bg_self.code  AS bg_self_reported_code,
            bg_ver.code   AS bg_verified_code,
            d.eligible_components, d.deferral_status, d.deferral_until,
            d.next_eligible_date, d.total_donations, d.total_units_ml,
            d.community_id, d.is_available, d.reliability_score,
            c.name AS community_name,
            d.village_id, v.district_id, v.taluka_id
       FROM donors d
  LEFT JOIN blood_groups bg_self ON bg_self.id = d.blood_group_self_reported
  LEFT JOIN blood_groups bg_ver  ON bg_ver.id  = d.blood_group_verified
  LEFT JOIN communities c        ON c.id = d.community_id
  LEFT JOIN villages v           ON v.id = d.village_id
      WHERE d.id = $1`,
    [donorId],
  );
  if (profileR.rowCount === 0) return null;
  const p = profileR.rows[0];

  // Donations — with verification badge
  const donationsR = await client.query(
    `SELECT dh.id, dh.collection_date, dh.component_id, dh.volume_ml,
            dh.hb_gdl, dh.hb_method, dh.trust_level, dh.source,
            bc.code AS component_code, bc.name_en AS component_name,
            i.display_name AS blood_bank_name
       FROM donation_history dh
  LEFT JOIN blood_components bc ON bc.id = dh.component_id
  LEFT JOIN institutions i ON i.id = dh.blood_bank_id
      WHERE dh.donor_id = $1
        AND dh.is_invalidated = FALSE
   ORDER BY dh.collection_date DESC`,
    [donorId],
  );

  // Overall clearance — only PE/CL/IN/HD, never field-level TTI values.
  // Returned as "the donor's most recent screening verdict per donation".
  const clearanceR = await client.query(
    `SELECT donation_id, overall_clearance, verified_at
       FROM donor_screening
      WHERE donor_id = $1`,
    [donorId],
  );
  const clearanceMap = new Map(clearanceR.rows.map((r) => [r.donation_id, r.overall_clearance]));

  return {
    donor: {
      id: p.id,
      full_name: open(p.full_name), // column-encrypted at rest
      date_of_birth: p.date_of_birth,
      gender: p.gender,
      preferred_language: p.preferred_language,
      blood_group: {
        verified: p.bg_verified_code
          ? {
              code: p.bg_verified_code,
              label: `Lab verified: ${p.bg_verified_code}`,
              verified_at: p.blood_group_verified_at,
            }
          : null,
        self_reported: p.bg_self_reported_code
          ? {
              code: p.bg_self_reported_code,
              label: `Self-reported (unverified): ${p.bg_self_reported_code}`,
            }
          : null,
        used_in_matching: p.bg_verified_code ? 'verified' : 'none',
      },
      eligibility: {
        deferral_status: p.deferral_status,
        deferral_until: p.deferral_until,
        next_eligible_date: p.next_eligible_date,
        eligible_components: p.eligible_components,
      },
      community: p.community_id ? { id: p.community_id, name: p.community_name } : null,
      location: {
        district_id: p.district_id || null,
        taluka_id: p.taluka_id || null,
        village_id: p.village_id || null,
      },
      stats: {
        total_donations: p.total_donations,
        total_units_ml: p.total_units_ml,
        reliability_score: p.reliability_score,
        is_available: p.is_available,
      },
    },
    donations: donationsR.rows.map((d) => {
      const trustLabel =
        d.trust_level === 'V'
          ? 'Verified'
          : d.trust_level === 'R'
            ? 'Retroactively verified'
            : 'Unverified — not used in matching';
      return {
        id: d.id,
        date: d.collection_date,
        component: { code: d.component_code, name: d.component_name },
        volume_ml: d.volume_ml,
        hb_gdl: d.hb_gdl,
        hb_method: d.hb_method,
        blood_bank: d.blood_bank_name,
        trust_level: d.trust_level,
        trust_label: trustLabel,
        clearance: clearanceMap.get(d.id) || null,
      };
    }),
    overall_clearance:
      clearanceR.rows.find((r) => r.overall_clearance === 'IN')?.overall_clearance ||
      (clearanceR.rows.some((r) => r.overall_clearance === 'PE') ? 'PE' : 'CL'),
  };
}

module.exports = { buildPassport };
