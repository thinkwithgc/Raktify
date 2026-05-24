/**
 * Authentication routes.
 *
 *   POST /auth/otp/send        — donors and coordinators (mobile OTP)
 *   POST /auth/otp/verify      — verify OTP, return JWT
 *   POST /auth/institutional/login         — email + password + TOTP
 *   POST /auth/institutional/setup-totp    — bootstrap TOTP secret
 *   POST /auth/institutional/confirm-totp  — first verification enables it
 *   POST /auth/institutional/reset-password — ngo_admin only
 *   POST /auth/logout          — invalidate session (current behavior: stateless JWT)
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const totp = require('../utils/totp');
const { z } = require('zod');

const env = require('../config/env');
const logger = require('../config/logger');
const { pool } = require('../config/db');
const { withRlsContextRaw } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { sign, newSessionId } = require('../utils/jwt');
const { normaliseIndianMobile } = require('../utils/phone');
const otp = require('../utils/otp');
const encryption = require('../services/encryption');
const { sendNotification } = require('../services/notifications');

const router = express.Router();

// ── Rate limits (spec §10) ──────────────────────────────────────────────
const otpSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: otp.RATE_LIMIT_PER_HOUR,
  keyGenerator: (req) => normaliseIndianMobile(req.body?.mobile) || req.ip,
  standardHeaders: 'draft-8',
  message: { error: 'rate_limit_otp_send' },
});

const institutionalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.ip,
  standardHeaders: 'draft-8',
  message: { error: 'rate_limit_login' },
});

// ── Helpers ──────────────────────────────────────────────────────────────
function shouldUnlock(user) {
  return user.is_locked && user.locked_until && new Date(user.locked_until) <= new Date();
}

// ── POST /auth/otp/send ──────────────────────────────────────────────────
router.post('/otp/send', otpSendLimiter, async (req, res) => {
  const schema = z.object({
    mobile: z.string(),
    role_hint: z.enum(['donor', 'coordinator']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const mobile = normaliseIndianMobile(parsed.data.mobile);
  if (!mobile) return res.status(400).json({ error: 'invalid_mobile_format' });

  // Spec rule: donor/coordinator OTP path. We look up the existing user; if
  // none, we DO NOT auto-create — registration is a separate flow.
  const existing = await pool.query(
    'SELECT id, role, is_locked, locked_until, otp_attempts FROM platform_users WHERE mobile = $1',
    [mobile],
  );

  let userId;
  if (existing.rowCount === 0) {
    // Auto-create a thin platform_users row in 'donor' role on first OTP request.
    // The donor profile (donors table) is created later by the registration form.
    // Coordinators are NEVER auto-created — they require ngo_admin onboarding.
    if (parsed.data.role_hint === 'coordinator') {
      return res.status(403).json({ error: 'coordinator_not_registered' });
    }
    const created = await withRlsContextRaw(
      { actor_role: 'registration', change_reason: 'auth otp send first contact' },
      async (c) => {
        const r = await c.query(
          `INSERT INTO platform_users (role, mobile) VALUES ('donor', $1) RETURNING id`,
          [mobile],
        );
        return r.rows[0].id;
      },
    );
    userId = created;
  } else {
    const u = existing.rows[0];
    if (u.is_locked && !shouldUnlock(u)) {
      return res.status(429).json({ error: 'account_locked', locked_until: u.locked_until });
    }
    if (shouldUnlock(u)) {
      await pool.query(
        `UPDATE platform_users SET is_locked = FALSE, locked_until = NULL,
         otp_attempts = 0 WHERE id = $1`,
        [u.id],
      );
    }
    userId = u.id;
  }

  const code = otp.generate();
  const codeHash = otp.hash(code);
  const expiresAt = new Date(Date.now() + otp.OTP_TTL_MIN * 60_000);

  await pool.query(
    `UPDATE platform_users
        SET otp_hash = $1, otp_expires_at = $2, otp_attempts = 0
      WHERE id = $3`,
    [codeHash, expiresAt, userId],
  );

  // Dispatch via the notification service. In dev with NOTIFICATIONS_PROVIDER=console,
  // this writes to .outbox/<id>.json. Real MSG91 lands in Phase 6.
  await sendNotification({
    recipientId: mobile,
    templateType: 'OTP',
    variables: { otp: code, ttl_minutes: otp.OTP_TTL_MIN },
    channel: 'WA',
    language: 'en',
  });

  // Surface the OTP in the response for local dev, and for staging when the
  // OTP_ECHO flag is explicitly set (so a live staging site can be demoed
  // without a working SMS/WhatsApp channel). Never enabled in real production.
  const echoOtp = env.nodeEnv === 'development' || env.otpEcho;
  const devEcho = echoOtp ? { dev_otp: code } : {};
  res.json({ status: 'sent', expires_at: expiresAt.toISOString(), ...devEcho });
});

// ── POST /auth/otp/verify ────────────────────────────────────────────────
router.post('/otp/verify', async (req, res) => {
  const schema = z.object({
    mobile: z.string(),
    otp: z.string().regex(/^\d{6}$/, 'otp must be 6 digits'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const mobile = normaliseIndianMobile(parsed.data.mobile);
  if (!mobile) return res.status(400).json({ error: 'invalid_mobile_format' });

  const r = await pool.query(
    `SELECT id, role, institution_id, otp_hash, otp_expires_at, otp_attempts,
            is_locked, locked_until
       FROM platform_users WHERE mobile = $1`,
    [mobile],
  );
  if (r.rowCount === 0) return res.status(401).json({ error: 'invalid_credentials' });
  const u = r.rows[0];

  if (u.is_locked && !shouldUnlock(u)) {
    return res.status(429).json({ error: 'account_locked' });
  }
  if (!u.otp_hash || !u.otp_expires_at || new Date(u.otp_expires_at) < new Date()) {
    return res.status(401).json({ error: 'otp_expired' });
  }

  const submitted = otp.hash(parsed.data.otp);
  if (!otp.constantTimeEquals(submitted, u.otp_hash)) {
    const attempts = (u.otp_attempts || 0) + 1;
    const locking = attempts >= otp.MAX_ATTEMPTS;
    await pool.query(
      `UPDATE platform_users
          SET otp_attempts = $1,
              is_locked = $2,
              locked_until = CASE WHEN $2 THEN NOW() + make_interval(mins => $4)
                                  ELSE locked_until END
        WHERE id = $3`,
      [attempts, locking, u.id, otp.LOCK_DURATION_MIN],
    );
    return res.status(401).json({
      error: locking ? 'account_locked_too_many_attempts' : 'invalid_otp',
      attempts_remaining: Math.max(0, otp.MAX_ATTEMPTS - attempts),
    });
  }

  // Success — clear OTP, stamp last_login, return JWT.
  const sessionId = newSessionId();
  await pool.query(
    `UPDATE platform_users
        SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0,
            last_login_at = clock_timestamp(), is_locked = FALSE, locked_until = NULL
      WHERE id = $1`,
    [u.id],
  );

  // Donor mobile re-verification (Phase 3 cleanup): if a donor row is paired
  // to this platform_user and mobile_verified is still FALSE, set it TRUE.
  // The donors table has its own mobile_verified flag (not on platform_users).
  if (u.role === 'donor') {
    await pool.query(
      `UPDATE donors
          SET mobile_verified = TRUE,
              mobile_verified_at = clock_timestamp()
        WHERE platform_user_id = $1
          AND mobile_verified = FALSE`,
      [u.id],
    );
  }

  const token = sign({ sub: u.id, role: u.role, sid: sessionId, inst: u.institution_id });
  res.json({
    token,
    role: u.role,
    user_id: u.id,
    institution_id: u.institution_id,
    session_id: sessionId,
  });
});

// ── POST /auth/institutional/login ───────────────────────────────────────
router.post('/institutional/login', institutionalLoginLimiter, async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    totp_code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const r = await pool.query(
    `SELECT pu.id, pu.role, pu.institution_id, pu.district_id, pu.password_hash,
            pu.totp_secret, pu.totp_enabled,
            pu.is_locked, pu.locked_until, pu.force_password_change,
            i.onboarding_status
       FROM platform_users pu
  LEFT JOIN institutions i ON i.id = pu.institution_id
      WHERE pu.email = $1`,
    [parsed.data.email.toLowerCase()],
  );
  if (r.rowCount === 0) return res.status(401).json({ error: 'invalid_credentials' });
  const u = r.rows[0];

  if (u.is_locked && !shouldUnlock(u)) {
    return res.status(429).json({ error: 'account_locked' });
  }
  if (!u.password_hash) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(parsed.data.password, u.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  // For staff roles, ensure their institution is ACTIVE. DHOs have no
  // institution (district_id binding instead), so the check is skipped for them.
  if (['hospital', 'blood_bank'].includes(u.role) && u.onboarding_status !== 'AC') {
    return res.status(403).json({ error: 'institution_not_active' });
  }

  if (u.totp_enabled) {
    if (!parsed.data.totp_code) return res.status(401).json({ error: 'totp_required' });
    const secret = encryption.decrypt(u.totp_secret);
    const valid = await totp.verifyCode(secret, parsed.data.totp_code);
    if (!valid) return res.status(401).json({ error: 'invalid_totp' });
  } else {
    // First login still allowed without TOTP, but we flag for setup
    logger.warn({ user_id: u.id }, 'Institutional login without TOTP — setup required');
  }

  const sessionId = newSessionId();
  await pool.query(`UPDATE platform_users SET last_login_at = clock_timestamp() WHERE id = $1`, [
    u.id,
  ]);
  const token = sign({
    sub: u.id,
    role: u.role,
    sid: sessionId,
    inst: u.institution_id,
    dist: u.district_id,
  });
  res.json({
    token,
    role: u.role,
    user_id: u.id,
    institution_id: u.institution_id,
    district_id: u.district_id,
    totp_required: !u.totp_enabled,
    force_password_change: u.force_password_change,
  });
});

// ── POST /auth/institutional/setup-totp ──────────────────────────────────
router.post('/institutional/setup-totp', verifyJWT, async (req, res) => {
  if (!['hospital', 'blood_bank', 'ngo_admin', 'super_admin', 'dho'].includes(req.user.role)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const r = await pool.query('SELECT email, totp_enabled FROM platform_users WHERE id = $1', [
    req.user.userId,
  ]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
  if (r.rows[0].totp_enabled) {
    return res.status(409).json({ error: 'totp_already_enabled' });
  }

  const secret = totp.newSecret();
  const encryptedSecret = encryption.encrypt(secret);
  await pool.query(
    `UPDATE platform_users SET totp_secret = $1, totp_enabled = FALSE WHERE id = $2`,
    [encryptedSecret, req.user.userId],
  );

  const otpauth = totp.buildUri({ accountName: r.rows[0].email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  res.json({
    otpauth_url: otpauth,
    qr_code_data_url: qrDataUrl,
    instructions:
      'Scan with Google Authenticator / Authy. Then POST the 6-digit code to /auth/institutional/confirm-totp.',
  });
});

// ── POST /auth/institutional/confirm-totp ────────────────────────────────
router.post('/institutional/confirm-totp', verifyJWT, async (req, res) => {
  const schema = z.object({ totp_code: z.string().regex(/^\d{6}$/) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const r = await pool.query(`SELECT totp_secret, totp_enabled FROM platform_users WHERE id = $1`, [
    req.user.userId,
  ]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
  if (r.rows[0].totp_enabled) return res.status(409).json({ error: 'totp_already_enabled' });
  if (!r.rows[0].totp_secret) return res.status(400).json({ error: 'totp_setup_first' });

  const secret = encryption.decrypt(r.rows[0].totp_secret);
  if (!(await totp.verifyCode(secret, parsed.data.totp_code))) {
    return res.status(401).json({ error: 'invalid_totp' });
  }

  await pool.query(
    `UPDATE platform_users SET totp_enabled = TRUE, totp_verified_at = NOW() WHERE id = $1`,
    [req.user.userId],
  );
  res.json({ status: 'totp_enabled' });
});

// ── POST /auth/institutional/reset-password ──────────────────────────────
router.post(
  '/institutional/reset-password',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin'),
  async (req, res) => {
    const schema = z.object({ email: z.string().email() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const r = await pool.query(
      `SELECT pu.id, pu.role, i.primary_contact_mobile
         FROM platform_users pu
    LEFT JOIN institutions i ON i.id = pu.institution_id
        WHERE pu.email = $1`,
      [parsed.data.email.toLowerCase()],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });

    const tempPassword = require('crypto')
      .randomBytes(9)
      .toString('base64url')
      .replace(/[^A-Za-z0-9]/g, '');
    const hash = await bcrypt.hash(tempPassword, 12);

    await pool.query(
      `UPDATE platform_users
          SET password_hash = $1, password_set_at = NOW(),
              force_password_change = TRUE,
              is_locked = FALSE, locked_until = NULL
        WHERE id = $2`,
      [hash, r.rows[0].id],
    );

    if (r.rows[0].primary_contact_mobile) {
      await sendNotification({
        recipientId: r.rows[0].primary_contact_mobile,
        templateType: 'CRED',
        variables: {
          email: parsed.data.email,
          temp_password: tempPassword,
          login_url: env.frontendUrl,
        },
        channel: 'WA',
        language: 'en',
      });
    }

    const devEcho = env.nodeEnv === 'development' ? { dev_temp_password: tempPassword } : {};
    res.json({ status: 'reset', ...devEcho });
  },
);

// ── POST /auth/logout ─────────────────────────────────────────────────────
// JWTs are stateless. A real session-blacklist would land in a Redis-backed
// store. For now, the API just acknowledges; the client must drop the token.
router.post('/logout', verifyJWT, async (req, res) => {
  logger.info({ user_id: req.user.userId, session_id: req.user.sessionId }, 'logout');
  res.json({ status: 'logged_out' });
});

module.exports = router;
