#!/usr/bin/env node
/**
 * BloodConnect migration runner.
 *
 * Usage:
 *   node scripts/run_migrations.js up         apply all pending migrations
 *   node scripts/run_migrations.js status     show applied / pending
 *   node scripts/run_migrations.js dry-run    parse + check; do not execute
 *
 * Migration files live in /database/migrations and are numbered NNN_name.sql.
 * Each file is executed inside a single transaction. The runner tracks applied
 * migrations in the schema_migrations table.
 *
 * Migrations are applied in lexical order — file naming is the source of truth.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const MIGRATIONS_DIR = path.resolve(__dirname, '../database/migrations');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Check .env');
  process.exit(1);
}

const useSsl = process.env.DATABASE_URL.includes('sslmode=');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  application_name: 'bloodconnect-migrator',
});

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version       TEXT PRIMARY KEY,
      checksum      CHAR(64) NOT NULL,
      applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_by    TEXT NOT NULL DEFAULT current_user,
      execution_ms  INTEGER NOT NULL
    );
  `);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function status() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows: applied } = await client.query(
      'SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version',
    );
    const appliedMap = new Map(applied.map((r) => [r.version, r]));
    const files = listMigrationFiles();

    console.log('Migration status:');
    console.log('─'.repeat(78));
    if (files.length === 0) {
      console.log('  (no migrations yet)');
      return;
    }
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const sum = checksum(content);
      const a = appliedMap.get(version);
      if (!a) {
        console.log(`  [PENDING]  ${version}`);
      } else if (a.checksum !== sum) {
        console.log(`  [DRIFT!]   ${version}  applied checksum mismatch — file changed after apply`);
      } else {
        console.log(`  [APPLIED]  ${version}  ${a.applied_at.toISOString()}`);
      }
    }
  } finally {
    client.release();
  }
}

async function dryRun() {
  const files = listMigrationFiles();
  console.log(`Dry-run: ${files.length} migration file(s) found.`);
  let bad = 0;
  for (const file of files) {
    const full = path.join(MIGRATIONS_DIR, file);
    const content = fs.readFileSync(full, 'utf8');
    if (!content.trim()) {
      console.log(`  [empty]    ${file}`);
      bad++;
      continue;
    }
    if (!/--\s*ROLLBACK/i.test(content)) {
      console.log(`  [warn]     ${file} — no ROLLBACK section comment`);
    }
    console.log(`  [ok]       ${file} (${content.length} bytes)`);
  }
  if (bad > 0) process.exit(1);
}

async function up() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows: applied } = await client.query('SELECT version, checksum FROM schema_migrations');
    const appliedMap = new Map(applied.map((r) => [r.version, r.checksum]));
    const files = listMigrationFiles();

    let appliedCount = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const full = path.join(MIGRATIONS_DIR, file);
      const content = fs.readFileSync(full, 'utf8');
      const sum = checksum(content);

      if (appliedMap.has(version)) {
        if (appliedMap.get(version) !== sum) {
          console.error(
            `Migration ${version} has been modified after being applied. ` +
              'Refusing to continue — create a new migration to alter prior changes.',
          );
          process.exit(2);
        }
        continue;
      }

      console.log(`▸ applying ${version} ...`);
      const start = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(content);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum, execution_ms) VALUES ($1, $2, $3)',
          [version, sum, Date.now() - start],
        );
        await client.query('COMMIT');
        console.log(`  ✓ ${version} (${Date.now() - start}ms)`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${version} failed: ${err.message}`);
        throw err;
      }
    }
    console.log(`Done. Applied ${appliedCount} migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const cmd = process.argv[2] || 'status';
  try {
    switch (cmd) {
      case 'up':
        await up();
        break;
      case 'status':
        await status();
        break;
      case 'dry-run':
        await dryRun();
        break;
      default:
        console.error(`Unknown command: ${cmd}. Use: up | status | dry-run`);
        process.exit(1);
    }
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
