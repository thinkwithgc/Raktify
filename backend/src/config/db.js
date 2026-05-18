const { Pool } = require('pg');
const env = require('./env');
const logger = require('./logger');

// Neon (and AWS RDS) issue real, publicly-trusted certs — verify them.
// pg's `?sslmode=require` is currently an alias for verify-full; explicit ssl options pin behavior across pg versions.
const useSsl = env.db.url.includes('sslmode=');
const pool = new Pool({
  connectionString: env.db.url,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'raktify-api',
});

pool.on('error', (err) => {
  logger.error({ err }, 'Postgres pool error');
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 500) logger.warn({ text, duration_ms: duration }, 'Slow query');
  return res;
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function shutdown() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, shutdown };
