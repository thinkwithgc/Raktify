/**
 * Row-Level-Security context propagator.
 *
 * Every Postgres connection acquired by an authenticated request must have
 * the bloodconnect.* GUC variables set so that:
 *   - RLS policies (100/200_rls) can identify the actor
 *   - The audit_log trigger can record actor_user_id, role, institution_id
 *
 * Usage pattern (in route handlers):
 *
 *   await withRlsContext(req, async (client) => {
 *     await client.query('INSERT INTO ... ');
 *   });
 *
 * The helper opens a transaction, SETs the LOCAL bloodconnect.* GUCs from
 * req.user, runs the callback with the client, commits on success, rolls
 * back on throw, and releases the connection.
 *
 * Public (unauthenticated) routes that nonetheless need RLS context — e.g.
 * POST /onboarding/apply uses actor_role='onboarding' — should construct a
 * synthetic ctx and pass it directly via withRlsContextRaw.
 */
const { pool } = require('../config/db');

const GUC_KEYS = [
  'actor_user_id',
  'actor_role',
  'actor_institution_id',
  'actor_session_id',
  'actor_ip_address',
  'change_reason',
  'access_reason',
];

function buildContext(req, overrides = {}) {
  const u = req.user || {};
  return {
    actor_user_id: u.userId || null,
    actor_role: u.role || overrides.actor_role || null,
    actor_institution_id: u.institutionId || null,
    actor_session_id: u.sessionId || null,
    actor_ip_address: req.ip || req.headers?.['x-forwarded-for'] || null,
    change_reason: overrides.change_reason || req.headers?.['x-change-reason'] || null,
    access_reason: overrides.access_reason || req.headers?.['x-access-reason'] || null,
    ...overrides,
  };
}

async function applyContext(client, ctx) {
  for (const k of GUC_KEYS) {
    const v = ctx[k];
    if (v === undefined) continue;
    await client.query(`SELECT set_config('bloodconnect.${k}', $1, TRUE)`, [v ?? '']);
  }
}

async function withRlsContextRaw(ctx, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyContext(client, ctx);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function withRlsContext(req, fn, overrides = {}) {
  const ctx = buildContext(req, overrides);
  return withRlsContextRaw(ctx, fn);
}

module.exports = { withRlsContext, withRlsContextRaw, buildContext };
