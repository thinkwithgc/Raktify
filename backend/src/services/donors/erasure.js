/**
 * Donor erasure — DPDP Act 2023 §12 (right to erasure).
 *
 * Founder decision (docs/Raktify_Data_Retention_Matrix.md): ANONYMISE the
 * donor rather than hard-delete. We scrub every identifying field on the
 * `donors` row AND the linked `platform_users` auth row, but KEEP the
 * de-identified clinical record (donation_history, donor_screening) and the
 * immutable audit_log — blood-safety lookback and hemovigilance depend on
 * them, and DPDP §12 exempts data retained under a legal obligation.
 *
 * BLOCKED while an open lookback investigation references the donor: a reactive
 * TTI result may still require counselling/notification, so erasure is deferred
 * (not refused) until the lookback closes. Once closed, erasure proceeds.
 *
 * Runs in the CALLER's transaction + RLS context — the route passes a client
 * whose actor can UPDATE both tables (ngo_admin today; see routes/admin.js).
 * The `mobile` columns are CHAR(13) NOT NULL UNIQUE and cannot be nulled, so
 * they are overwritten with a unique 'ERSD…' tombstone from donor_erasure_seq.
 */

async function eraseDonor(client, donorId) {
  const cur = await client.query(
    `SELECT id, erased_at, platform_user_id FROM donors WHERE id = $1`,
    [donorId],
  );
  if (cur.rowCount === 0) return { ok: false, error: 'donor_not_found' };
  const donor = cur.rows[0];
  if (donor.erased_at) {
    return { ok: true, already_erased: true, donor_id: donorId, erased_at: donor.erased_at };
  }

  // DPDP §12 legal-obligation exception: hold erasure while a lookback is open.
  const lb = await client.query(
    `SELECT 1 FROM lookback_registry
      WHERE donor_id = $1 AND lookback_status NOT IN ('CL', 'EX') LIMIT 1`,
    [donorId],
  );
  if (lb.rowCount > 0) {
    return {
      ok: false,
      error: 'erasure_blocked_open_lookback',
      detail:
        'An open blood-safety lookback references this donor. Erasure is deferred until it closes (DPDP §12 legal-obligation exception).',
    };
  }

  // 1. Scrub the donor row. Keep blood_group_verified + gender + village_id
  //    (de-identified clinical/aggregate fields); scrub everything identifying.
  //    date_of_birth is NOT NULL with an 18–65y CHECK, so it is generalised to a
  //    within-band sentinel rather than nulled. Consent columns are left alone —
  //    a separate trigger protects them and is_active=FALSE already withdraws use.
  const upd = await client.query(
    `UPDATE donors SET
        full_name                 = '[erased]',
        full_name_bidx            = NULL,
        mobile                    = 'ERSD' || LPAD(nextval('donor_erasure_seq')::text, 9, '0'),
        mobile_verified           = FALSE,
        mobile_verified_at        = NULL,
        abha_id                   = NULL,
        aadhaar_last4             = NULL,
        date_of_birth             = (CURRENT_DATE - INTERVAL '40 years')::date,
        address_line              = NULL,
        pincode                   = NULL,
        latitude                  = NULL,
        longitude                 = NULL,
        alternate_mobiles         = NULL,
        blood_group_self_reported = NULL,
        deferral_reason           = NULL,
        whatsapp_opted_in         = FALSE,
        whatsapp_opted_in_at      = NULL,
        sms_opted_in              = FALSE,
        is_available              = FALSE,
        is_active                 = FALSE,
        erased_at                 = NOW()
      WHERE id = $1 AND erased_at IS NULL
      RETURNING id, erased_at`,
    [donorId],
  );
  if (upd.rowCount === 0) return { ok: false, error: 'donor_not_found' };

  // 2. Scrub + lock the linked auth row so the person can no longer sign in.
  //    (OTP resolves on platform_users.mobile — tombstoning it kills login;
  //    the far-future lock + nulled secrets are defence-in-depth.)
  if (donor.platform_user_id) {
    await client.query(
      `UPDATE platform_users SET
          mobile           = 'ERSD' || LPAD(nextval('donor_erasure_seq')::text, 9, '0'),
          otp_hash         = NULL,
          otp_expires_at   = NULL,
          otp_attempts     = 0,
          email            = NULL,
          password_hash    = NULL,
          totp_secret      = NULL,
          totp_enabled     = FALSE,
          last_login_ip    = NULL,
          is_locked        = TRUE,
          locked_until     = NOW() + INTERVAL '100 years'
        WHERE id = $1`,
      [donor.platform_user_id],
    );
  }

  return { ok: true, donor_id: donorId, erased_at: upd.rows[0].erased_at };
}

module.exports = { eraseDonor };
