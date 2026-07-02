#!/usr/bin/env node
/**
 * Bootstrap an institutional admin account (super_admin / ngo_admin / dho)
 * directly into the production DB, then send the same WhatsApp activation
 * link the regular institution onboarding flow uses.
 *
 * Use this ONCE per environment to seed the very first super_admin —
 * everything afterwards (hospital/blood-bank admins, additional ngo_admins)
 * should go through /admin's onboarding UI which uses the same primitives.
 *
 * What it does (atomic, single transaction):
 *   1. INSERT INTO platform_users (role, username, mobile, password_hash placeholder, email?)
 *   2. generateSetupToken() → 32-byte random, SHA-256 stored, plaintext returned
 *   3. sendNotification SETUP_LINK via whatsapp_cloud
 *   4. Print the activation URL (in case WhatsApp delivery is flaky)
 *
 * Usage (loads creds from Key Vault):
 *   node scripts/bootstrap_admin.js \
 *     --role super_admin \
 *     --username gaurav \
 *     --mobile +919850541412 \
 *     --email gaurav@choudhari.ngo     # optional
 *
 * Idempotent: re-running with the same username refreshes the password
 * placeholder + issues a new setup token (lets you re-send the activation
 * link if the previous WhatsApp didn't arrive).
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const role = arg('--role', 'super_admin');
const username = arg('--username');
const mobile = arg('--mobile');
const email = arg('--email', null);

if (!username || !mobile) {
  console.error('Usage: --role <super_admin|ngo_admin|dho> --username <name> --mobile +91XXXXXXXXXX [--email …]');
  process.exit(1);
}
if (!/^[a-z][a-z0-9_-]{2,31}$/.test(username)) {
  console.error('Invalid username — must match ^[a-z][a-z0-9_-]{2,31}$ (e.g. "gaurav", "foundation_admin")');
  process.exit(1);
}
if (!/^\+91\d{10}$/.test(mobile)) {
  console.error('Invalid mobile — must be +91XXXXXXXXXX (Indian, 13 chars, leading +91)');
  process.exit(1);
}
if (!['super_admin', 'ngo_admin', 'dho'].includes(role)) {
  console.error(`Refusing role "${role}" — bootstrap only supports super_admin / ngo_admin / dho. ` +
                'Hospital/blood-bank admins must go through /admin onboarding.');
  process.exit(1);
}

const requiredEnv = ['DATABASE_URL', 'JWT_SECRET'];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error('Missing env: ' + missing.join(', '));
  console.error('Source secrets from Key Vault first:');
  console.error("  export DATABASE_URL=$(az keyvault secret show --vault-name raktify-kv --name database-url --query value -o tsv)");
  console.error('  + the whatsapp + jwt + encryption keys (see backend/src/config/env.js)');
  process.exit(1);
}

// Work from the backend dir so its package.json + node_modules resolve.
process.chdir(path.resolve(__dirname, '..', 'backend'));
const { pool } = require(path.resolve(process.cwd(), 'src/config/db'));
const { withRlsContextRaw } = require(path.resolve(process.cwd(), 'src/middleware/rlsContext'));
const setupSvc = require(path.resolve(process.cwd(), 'src/services/users/setup'));
const { sendNotification } = require(path.resolve(process.cwd(), 'src/services/notifications'));
const env = require(path.resolve(process.cwd(), 'src/config/env'));

(async () => {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' Bootstrap admin account');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  role     :', role);
  console.log('  username :', username);
  console.log('  mobile   :', mobile);
  console.log('  email    :', email || '(not provided)');
  console.log('  notif    :', env.providers.notifications);
  console.log('');

  const placeholderHash = await setupSvc.unusablePasswordHash();

  const result = await withRlsContextRaw(
    { actor_role: 'onboarding', change_reason: 'bootstrap admin' },
    async (c) => {
      const existing = await c.query(
        'SELECT id FROM platform_users WHERE username = $1',
        [username],
      );

      let userId;
      let action;
      if (existing.rowCount === 0) {
        const r = await c.query(
          `INSERT INTO platform_users
             (role, username, mobile, email, password_hash, password_set_at,
              force_password_change)
           VALUES ($1, $2, $3, $4, $5, NOW(), TRUE)
           RETURNING id`,
          [role, username, mobile, email, placeholderHash],
        );
        userId = r.rows[0].id;
        action = 'inserted';
      } else {
        userId = existing.rows[0].id;
        await c.query(
          `UPDATE platform_users
              SET role = $1, mobile = $2, email = COALESCE($3, email),
                  password_hash = $4, password_set_at = NOW(),
                  force_password_change = TRUE,
                  is_locked = FALSE, locked_until = NULL
            WHERE id = $5`,
          [role, mobile, email, placeholderHash, userId],
        );
        action = 're-issued (existing user — password reset to a fresh placeholder)';
      }

      const { token: setupToken, expiresAt } = await setupSvc.generateSetupToken(c, userId);
      return { userId, action, setupToken, expiresAt };
    },
  );

  console.log(`✓ Row ${result.action}`);
  console.log('  user_id   :', result.userId);
  console.log('  expires_at:', result.expiresAt);
  console.log('');

  const activationUrl = `${env.frontendUrl}/activate/${result.setupToken}`;
  console.log('Activation URL (in case WhatsApp delivery fails):');
  console.log('  ' + activationUrl);
  console.log('');

  // Send WhatsApp activation message (`institution_link` Meta-approved template).
  console.log('▸ Sending WhatsApp activation link …');
  const sendResult = await sendNotification({
    recipientId: mobile,
    templateType: 'SETUP_LINK',
    variables: {
      signatory_name: username,
      institution_name: role === 'super_admin' ? 'Choudhari Foundation' : 'Raktify',
      setup_token: result.setupToken,
    },
    channel: 'WA',
    language: 'en',
  });

  if (sendResult?.delivery_status === 'SE' || sendResult?.success) {
    console.log('✓ WhatsApp accepted by Meta. Check ' + mobile + ' for the message.');
    if (sendResult.message_id || sendResult.messageId) {
      console.log('  wamid: ' + (sendResult.message_id || sendResult.messageId));
    }
  } else {
    console.error('⚠  WhatsApp send did not succeed cleanly:', sendResult);
    console.error('   Use the activation URL above as a fallback.');
  }

  await pool.end();
})().catch((err) => {
  console.error('✗ bootstrap failed:', err.message);
  if (err.detail) console.error('   detail:', err.detail);
  if (err.constraint) console.error('   constraint:', err.constraint);
  process.exit(1);
});
