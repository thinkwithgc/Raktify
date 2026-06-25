/**
 * Setup-token service — magic-link password setup for institutional admins.
 *
 * Each function expects an already-connected pg client (so callers can run
 * inside their own transaction / RLS context). Plaintext tokens leave this
 * module only on generateToken() — every other function consumes them.
 *
 * Token shape: 43-char base64url string (32 random bytes encoded).
 * Storage: SHA-256 hash only. The URL we send to WhatsApp is the only
 * place the plaintext ever exists in our system.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DEFAULT_TTL_DAYS = 7;

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Generate a fresh setup token for a platform_users row.
 * Stores the hash + expiry; clears any prior used_at marker so re-issuance
 * works after expiry. Returns the plaintext token (caller embeds in URL).
 */
async function generateSetupToken(client, userId, ttlDays = DEFAULT_TTL_DAYS) {
  const plaintext = crypto.randomBytes(32).toString('base64url');
  const hash = sha256(plaintext);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await client.query(
    `UPDATE platform_users
        SET setup_token_hash       = $1,
            setup_token_expires_at = $2,
            setup_token_used_at    = NULL
      WHERE id = $3`,
    [hash, expiresAt, userId],
  );

  return { token: plaintext, expiresAt };
}

/**
 * Look up a platform_users row by setup token. Returns user + institution
 * info for the setup-page UI, or a clear error code on failure.
 *
 * Returns { ok: true, user, institution } OR
 *         { ok: false, code: 'invalid' | 'expired' | 'used' }
 */
async function validateSetupToken(client, plaintextToken) {
  if (!plaintextToken || typeof plaintextToken !== 'string') {
    return { ok: false, code: 'invalid' };
  }
  const hash = sha256(plaintextToken);

  const { rows } = await client.query(
    `SELECT pu.id, pu.email, pu.role, pu.institution_id,
            pu.setup_token_expires_at, pu.setup_token_used_at,
            i.shortname           AS institution_shortname,
            i.legal_name          AS institution_name,
            i.mou_signatory_name  AS signatory_name
       FROM platform_users pu
       LEFT JOIN institutions i ON i.id = pu.institution_id
      WHERE pu.setup_token_hash = $1`,
    [hash],
  );

  if (rows.length === 0) return { ok: false, code: 'invalid' };
  const r = rows[0];

  if (r.setup_token_used_at) return { ok: false, code: 'used' };
  if (new Date(r.setup_token_expires_at) <= new Date()) {
    return { ok: false, code: 'expired' };
  }

  return {
    ok: true,
    user: {
      id: r.id,
      email: r.email,
      role: r.role,
    },
    institution: {
      id: r.institution_id,
      shortname: r.institution_shortname,
      name: r.institution_name,
      signatory_name: r.signatory_name,
    },
    expires_at: r.setup_token_expires_at,
  };
}

/**
 * Consume a setup token: validate, bcrypt the new password, atomically
 * update password_hash + mark used_at. Single-use: a second consume call
 * with the same plaintext returns { ok: false, code: 'used' }.
 */
async function consumeSetupToken(client, plaintextToken, newPassword) {
  const v = await validateSetupToken(client, plaintextToken);
  if (!v.ok) return v;

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const hash = sha256(plaintextToken);

  // The WHERE clause includes setup_token_used_at IS NULL so a race
  // between two concurrent setup attempts produces a single winner — the
  // loser sees 0 rows updated and returns { ok: false, code: 'used' }.
  const result = await client.query(
    `UPDATE platform_users
        SET password_hash         = $1,
            password_set_at       = NOW(),
            force_password_change = FALSE,
            setup_token_used_at   = NOW()
      WHERE setup_token_hash = $2
        AND setup_token_used_at IS NULL
        AND setup_token_expires_at > NOW()
      RETURNING id`,
    [passwordHash, hash],
  );

  if (result.rowCount === 0) return { ok: false, code: 'used' };
  return { ok: true, user_id: result.rows[0].id };
}

/**
 * Placeholder password to satisfy the auth_path_required CHECK constraint
 * on platform_users (staff roles need password_hash NOT NULL). The
 * plaintext is 32 random bytes that nobody sees — the user MUST go through
 * the setup link to set a real password.
 */
async function unusablePasswordHash() {
  return bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
}

module.exports = {
  generateSetupToken,
  validateSetupToken,
  consumeSetupToken,
  unusablePasswordHash,
  DEFAULT_TTL_DAYS,
};
