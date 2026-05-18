#!/usr/bin/env node
/**
 * LGD geographic importer.
 *
 * Loads states / districts / talukas / villages from the Local Government
 * Directory (Ministry of Panchayati Raj). Two source modes:
 *   --source=api   — fetch live from LGD API (LGD_API_BASE in .env)
 *   --source=csv   — read CSVs from LGD_CSV_DIR (filenames listed below)
 *
 * Default mode comes from LGD_USE_API env. CLI flag wins if provided.
 *
 * After import, activates Maharashtra (state 27) and Amravati district (per
 * spec §1.4 launch scope). All other states/districts remain is_active=FALSE.
 *
 * Usage:
 *   node scripts/import_lgd.js [--source=api|csv] [--only=states,districts]
 *   node scripts/import_lgd.js --states-only        # quick test
 *
 * CSV filenames expected in LGD_CSV_DIR:
 *   states.csv       columns: state_code, state_name, state_name_hi
 *   districts.csv    columns: district_code, state_code, district_name, district_name_hi
 *   talukas.csv      columns: subdistrict_code, district_code, subdistrict_name, subdistrict_name_hi
 *   villages.csv     columns: village_code, subdistrict_code, district_code, state_code,
 *                             village_name, village_name_hi, pincode, latitude, longitude, is_urban
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const args = parseArgs(process.argv.slice(2));
const SOURCE = args.source || (process.env.LGD_USE_API === 'true' ? 'api' : 'csv');
const ONLY = (args.only || 'states,districts,talukas,villages').split(',');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const useSsl = process.env.DATABASE_URL.includes('sslmode=');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  application_name: 'raktify-lgd-import',
});

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([\w-]+)(?:=(.+))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

async function loadFromCsv(name) {
  const file = path.resolve(process.env.LGD_CSV_DIR || './data/lgd', `${name}.csv`);
  if (!fs.existsSync(file)) {
    throw new Error(`CSV not found: ${file}. Download from lgdirectory.gov.in or set LGD_USE_API=true.`);
  }
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(',').map((s) => s.trim());
  return lines.map((line) => {
    const cols = parseCsvLine(line);
    return Object.fromEntries(header.map((h, i) => [h, cols[i]]));
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => (s === '' ? null : s));
}

async function loadFromApi(endpoint) {
  const url = `${process.env.LGD_API_BASE.replace(/\/$/, '')}/${endpoint}`;
  const headers = process.env.LGD_API_KEY ? { Authorization: `Bearer ${process.env.LGD_API_KEY}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`LGD API ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

async function batchInsert(client, table, columns, rows, conflict = 'id') {
  if (rows.length === 0) return 0;
  const BATCH = 1000;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const placeholders = chunk
      .map((_, r) => `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(',')})`)
      .join(',');
    const values = chunk.flatMap((row) => columns.map((c) => row[c]));
    const sql = `
      INSERT INTO ${table} (${columns.join(',')})
      VALUES ${placeholders}
      ON CONFLICT (${conflict}) DO NOTHING
    `;
    const r = await client.query(sql, values);
    total += r.rowCount;
  }
  return total;
}

async function importStates(client) {
  console.log('▸ states ...');
  const data =
    SOURCE === 'api'
      ? await loadFromApi('states')
      : await loadFromCsv('states');
  const rows = data.map((r) => ({
    id: parseInt(r.state_code ?? r.id, 10),
    name: r.state_name ?? r.name,
    name_hi: r.state_name_hi ?? r.name_hi ?? null,
    iso_code: r.iso_code ?? null,
    is_active: false,
  }));
  const n = await batchInsert(client, 'states', ['id', 'name', 'name_hi', 'iso_code', 'is_active'], rows);
  console.log(`  inserted ${n} state(s)`);
}

async function importDistricts(client) {
  console.log('▸ districts ...');
  const data =
    SOURCE === 'api'
      ? await loadFromApi('districts')
      : await loadFromCsv('districts');
  const rows = data.map((r) => ({
    id: parseInt(r.district_code ?? r.id, 10),
    state_id: parseInt(r.state_code ?? r.state_id, 10),
    name: r.district_name ?? r.name,
    name_hi: r.district_name_hi ?? r.name_hi ?? null,
    district_code_short: (r.district_code_short ?? null)?.slice(0, 4) ?? null,
    is_active: false,
    has_blood_centre: false,
  }));
  const n = await batchInsert(
    client,
    'districts',
    ['id', 'state_id', 'name', 'name_hi', 'district_code_short', 'is_active', 'has_blood_centre'],
    rows,
  );
  console.log(`  inserted ${n} district(s)`);
}

async function importTalukas(client) {
  console.log('▸ talukas (subdistricts) ...');
  const data =
    SOURCE === 'api'
      ? await loadFromApi('subdistricts')
      : await loadFromCsv('talukas');
  const rows = data.map((r) => ({
    id: parseInt(r.subdistrict_code ?? r.id, 10),
    district_id: parseInt(r.district_code ?? r.district_id, 10),
    name: r.subdistrict_name ?? r.name,
    name_hi: r.subdistrict_name_hi ?? r.name_hi ?? null,
  }));
  const n = await batchInsert(client, 'talukas', ['id', 'district_id', 'name', 'name_hi'], rows);
  console.log(`  inserted ${n} taluka(s)`);
}

async function importVillages(client) {
  console.log('▸ villages ...');
  const data =
    SOURCE === 'api'
      ? await loadFromApi('villages')
      : await loadFromCsv('villages');
  const rows = data.map((r) => ({
    id: parseInt(r.village_code ?? r.id, 10),
    taluka_id: parseInt(r.subdistrict_code ?? r.taluka_id, 10),
    district_id: parseInt(r.district_code ?? r.district_id, 10),
    state_id: parseInt(r.state_code ?? r.state_id, 10),
    name: r.village_name ?? r.name,
    name_hi: r.village_name_hi ?? r.name_hi ?? null,
    pincode: r.pincode ?? null,
    latitude: r.latitude ? Number(r.latitude) : null,
    longitude: r.longitude ? Number(r.longitude) : null,
    is_urban: r.is_urban === '1' || r.is_urban === 'true' || r.is_urban === true,
  }));
  const n = await batchInsert(
    client,
    'villages',
    [
      'id',
      'taluka_id',
      'district_id',
      'state_id',
      'name',
      'name_hi',
      'pincode',
      'latitude',
      'longitude',
      'is_urban',
    ],
    rows,
  );
  console.log(`  inserted ${n} village(s)`);
}

async function activateLaunchScope(client) {
  console.log('▸ activating launch scope (Maharashtra + Amravati) ...');
  await client.query(`UPDATE states SET is_active = TRUE WHERE id = 27`);
  // Amravati district code per LGD = 491. Confirm with district list before relying on this in prod.
  const r = await client.query(
    `UPDATE districts SET is_active = TRUE WHERE name ILIKE 'amravati' AND state_id = 27 RETURNING id, name`,
  );
  if (r.rowCount === 0) {
    console.warn('  ⚠ Amravati district not matched by name. Activate manually after confirming district code.');
  } else {
    console.log(`  activated district id=${r.rows[0].id} (${r.rows[0].name})`);
  }
}

async function main() {
  console.log(`LGD import → source=${SOURCE}, scope=${ONLY.join(',')}`);
  const client = await pool.connect();
  try {
    if (ONLY.includes('states')) await importStates(client);
    if (ONLY.includes('districts')) await importDistricts(client);
    if (ONLY.includes('talukas')) await importTalukas(client);
    if (ONLY.includes('villages')) await importVillages(client);
    await activateLaunchScope(client);
  } finally {
    client.release();
    await pool.end();
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
