#!/usr/bin/env node
/**
 * Seed runner. Applies SQL files from /database/seeds in lexical order,
 * skipping any that have already been applied (tracked in seed_history).
 *
 * Usage:
 *   node scripts/run_seeds.js
 *   node scripts/run_seeds.js --include-drafts   include _DRAFT_PENDING_REVIEW files
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SEEDS_DIR = path.resolve(__dirname, '../database/seeds');
const includeDrafts = process.argv.includes('--include-drafts');

const useSsl = process.env.DATABASE_URL.includes('sslmode=');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  application_name: 'raktify-seeder',
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS seed_history (
        name        TEXT PRIMARY KEY,
        checksum    CHAR(64) NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = fs
      .readdirSync(SEEDS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => includeDrafts || !/_DRAFT_PENDING_REVIEW/.test(f))
      .sort();

    if (files.length === 0) {
      console.log('No seeds to apply (set --include-drafts to load DRAFT seeds).');
      return;
    }

    const { rows: applied } = await client.query('SELECT name FROM seed_history');
    const appliedSet = new Set(applied.map((r) => r.name));

    for (const f of files) {
      if (appliedSet.has(f)) {
        console.log(`  [skip]  ${f} (already applied)`);
        continue;
      }
      const content = fs.readFileSync(path.join(SEEDS_DIR, f), 'utf8');
      const sum = crypto.createHash('sha256').update(content).digest('hex');
      console.log(`▸ seeding ${f} ...`);
      await client.query('BEGIN');
      try {
        await client.query(content);
        await client.query('INSERT INTO seed_history (name, checksum) VALUES ($1, $2)', [f, sum]);
        await client.query('COMMIT');
        console.log(`  ✓ ${f}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${f}: ${err.message}`);
        throw err;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
