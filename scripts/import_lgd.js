#!/usr/bin/env node
/**
 * LGD geographic importer — Amravati pilot.
 *
 * Reads three LGD Excel exports:
 *   1. `LGD - Local Government Directory ... _subdistrictCode_taluka.xlsx`
 *        → 14 talukas of Amravati district
 *   2. `LGD - Local Government Directory ... _Villagecode.xlsx`
 *        → 2,027 rural villages (with PESA Status column preserved)
 *   3. `LGD - Local Government Directory ... _wardcode_amravati.xlsx`
 *        → 34 wards of Amravati Municipal Corporation
 *
 * Plus in-script seed for:
 *   • 1 state (Maharashtra, LGD 27, RTO prefix MH)
 *   • 1 district (Amravati, LGD 490, canonical RTO code MH27, alternates
 *     ['MH27','MH37'] — MH37 is the Achalpur RTO)
 *   • 14 urban-body "catch-all" locality rows so city donors who don't
 *     know their ward can still pick a locality. These get synthetic
 *     integer IDs in the 99_000_000+ range so they can't collide with
 *     real LGD numbering.
 *
 * Rows are inserted with is_active = FALSE where applicable. The launch
 * scope (Maharashtra state + Amravati district) is activated at the end.
 *
 * Requires migration 294 (is_pesa + rto_codes_all) to be applied first.
 *
 * Config via env (all optional):
 *   LGD_XLSX_DIR    — path to the LGD Data folder (default: user's known dir)
 *   DATABASE_URL    — target DB (required)
 *
 * Usage:
 *   npm run lgd:import                        # everything
 *   npm run lgd:import -- --dry-run           # parse + report counts, no writes
 *   npm run lgd:import -- --only=talukas,villages
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const argv = process.argv.slice(2);
const args = Object.fromEntries(
  argv.map((a) => {
    const m = a.match(/^--([\w-]+)(?:=(.+))?$/);
    return m ? [m[1], m[2] ?? true] : [null, null];
  }),
);
const DRY_RUN = Boolean(args['dry-run']);
const ONLY = args.only
  ? String(args.only).split(',')
  : ['states', 'districts', 'talukas', 'villages', 'urban_bodies', 'wards'];

const DEFAULT_XLSX_DIR =
  process.platform === 'win32'
    ? 'C:\\Users\\GauravChoudhari\\OneDrive - IBM\\03.Desktop\\04. Choudhari Foundation\\Raktify\\LGD Data'
    : path.resolve(__dirname, '../lgd-data');
const XLSX_DIR = process.env.LGD_XLSX_DIR || DEFAULT_XLSX_DIR;

const FILE = {
  talukas:
    'LGD - Local Government Directory, Government of India_subdistrictCode_taluka.xlsx',
  villages: 'LGD - Local Government Directory, Government of India_Villagecode.xlsx',
  wards_amravati:
    'LGD - Local Government Directory, Government of India_wardcode_amravati.xlsx',
};

// LGD codes for the pilot ────────────────────────────────────────────────────
const MAHARASHTRA_LGD = 27;
const AMRAVATI_LGD = 490;
const AMRAVATI_RTO_CANONICAL = 'MH27';
const AMRAVATI_RTO_ALL = ['MH27', 'MH37']; // MH37 = Achalpur

// Synthetic ID space for urban-body catch-alls. Real LGD codes stay well
// below 10M today; 99_XXX_YYY keeps a clear separation.
const URBAN_CATCHALL_BASE = 99_000_000;

// Amravati district's Urban Local Bodies (name + type + host taluka).
// The host_taluka_name matches an entry in the LGD taluka XLSX so we can
// look up the taluka_id at insert time.
const AMRAVATI_URBAN_BODIES = [
  { name: 'Amravati', name_hi: 'अमरावती', type: 'MC', host_taluka_name: 'Amravati' },
  { name: 'Achalpur', name_hi: 'अचलपूर', type: 'M Cl', host_taluka_name: 'Achalpur' },
  {
    name: 'Anjangaon Surji',
    name_hi: 'अंजनगाव सुर्जी',
    type: 'M Cl',
    host_taluka_name: 'Anjangaon Surji',
  },
  { name: 'Warud', name_hi: 'वरुड', type: 'M Cl', host_taluka_name: 'Warud' },
  {
    name: 'Chandur Bazar',
    name_hi: 'चांदूर बाजार',
    type: 'M Cl',
    host_taluka_name: 'Chandurbazar', // LGD spells it as one word
  },
  {
    name: 'Chandur Railway',
    name_hi: 'चांदूर रेल्वे',
    type: 'M Cl',
    host_taluka_name: 'Chandur Railway',
  },
  { name: 'Dharni', name_hi: 'धारणी', type: 'M Cl', host_taluka_name: 'Dharni' },
  { name: 'Morshi', name_hi: 'मोर्शी', type: 'M Cl', host_taluka_name: 'Morshi' },
  {
    name: 'Chikhaldara',
    name_hi: 'चिखलदरा',
    type: 'M Cl',
    host_taluka_name: 'Chikhaldara',
  },
  { name: 'Daryapur', name_hi: 'दर्यापूर', type: 'M Cl', host_taluka_name: 'Daryapur' },
  {
    name: 'Dhamangaon Railway',
    name_hi: 'धामणगाव रेल्वे',
    type: 'M Cl',
    host_taluka_name: 'Dhamangaon Railway',
  },
  // The three Nagar Panchayats — best-effort taluka mapping from public sources.
  {
    name: 'Shendurjana Ghat',
    name_hi: 'शेंदुर्जना घाट',
    type: 'NP',
    host_taluka_name: 'Morshi',
  },
  {
    name: 'Nandgaon Khandeshwar',
    name_hi: 'नांदगाव खंडेश्वर',
    type: 'NP',
    host_taluka_name: 'Nandgaon-Khandeshwar', // LGD uses hyphen
  },
  { name: 'Bhatkuli', name_hi: 'भातकुली', type: 'NP', host_taluka_name: 'Bhatkuli' },
];

function bodyDisplayName({ name, type }) {
  const suffix = { MC: 'Municipal Corporation', 'M Cl': 'Municipal Council', NP: 'Nagar Panchayat' }[type];
  return `${name} (${suffix})`;
}

// ── XLSX loading helpers ────────────────────────────────────────────────────

function loadSheet(filename) {
  const full = path.join(XLSX_DIR, filename);
  if (!fs.existsSync(full)) {
    throw new Error(`LGD xlsx missing: ${full}\nSet LGD_XLSX_DIR or drop the file at that path.`);
  }
  const wb = XLSX.readFile(full);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
}

// LGD taluka file hierarchy = "Amravati(District) / Maharashtra(State)"
function parseTalukaHierarchy(hier) {
  const m = String(hier || '').match(/^([^()]+)\(District\)\s*\/\s*([^()]+)\(State\)$/);
  return m ? { districtName: m[1].trim(), stateName: m[2].trim() } : null;
}

// LGD village file hierarchy = "<Taluka>(Sub-District) / <District>(District) / <State>(State)"
function parseVillageHierarchy(hier) {
  const m = String(hier || '').match(
    /^([^()]+)\(Sub-District\)\s*\/\s*([^()]+)\(District\)\s*\/\s*([^()]+)\(State\)$/,
  );
  return m
    ? { talukaName: m[1].trim(), districtName: m[2].trim(), stateName: m[3].trim() }
    : null;
}

// Parse "Amravati (M Ci) - Ward No. 3" or "Ward No. 3 (Tapovan)" etc.
// The Amravati ward file has columns S No / Ward Code / Ward Number / Ward Name (In English).
function friendlyWardName(row) {
  const num = String(row['Ward Number'] || '').trim();
  const raw = String(row['Ward Name (In English)'] || '').trim();
  // Strip the "Amravati (M Ci) - Ward No. N" prefix if present so the ward name is short.
  const cleaned = raw.replace(/^.*Ward No\.\s*\d+\s*[-:]*\s*/i, '').trim();
  const label = cleaned || raw || `Ward ${num}`;
  return `Amravati M Corp · Ward ${num}${cleaned ? ` · ${cleaned}` : ''}`.replace(
    /·\s*·/,
    '·',
  );
}

// ── Batched insert helper ──────────────────────────────────────────────────

async function batchInsert(client, table, columns, rows, conflict = '(id) DO NOTHING') {
  if (rows.length === 0) return 0;
  const BATCH = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const placeholders = chunk
      .map(
        (_, r) =>
          `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(',')})`,
      )
      .join(',');
    const values = chunk.flatMap((row) => columns.map((c) => row[c] ?? null));
    // eslint-disable-next-line no-restricted-syntax
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders} ON CONFLICT ${conflict}`;
    const r = await client.query(sql, values);
    total += r.rowCount;
  }
  return total;
}

// ── Steps ──────────────────────────────────────────────────────────────────

async function seedState(client) {
  if (DRY_RUN) return console.log('▸ state (dry-run): Maharashtra');
  const n = await batchInsert(
    client,
    'states',
    ['id', 'name', 'name_hi', 'iso_code', 'is_active'],
    [
      {
        id: MAHARASHTRA_LGD,
        name: 'Maharashtra',
        name_hi: 'महाराष्ट्र',
        iso_code: 'IN-MH',
        is_active: false,
      },
    ],
  );
  console.log(`▸ state: ${n} inserted (Maharashtra)`);
}

async function seedDistrict(client) {
  if (DRY_RUN) return console.log('▸ district (dry-run): Amravati');
  // Upsert — an existing Amravati row (from seed_demo.js with district_code_short='AMRV')
  // has its short code + rto_codes_all + Marathi name refreshed to the LGD truth.
  const n = await batchInsert(
    client,
    'districts',
    [
      'id',
      'state_id',
      'name',
      'name_hi',
      'district_code_short',
      'rto_codes_all',
      'is_active',
      'has_blood_centre',
    ],
    [
      {
        id: AMRAVATI_LGD,
        state_id: MAHARASHTRA_LGD,
        name: 'Amravati',
        name_hi: 'अमरावती',
        district_code_short: AMRAVATI_RTO_CANONICAL,
        rto_codes_all: AMRAVATI_RTO_ALL,
        is_active: false,
        has_blood_centre: false,
      },
    ],
    `(id) DO UPDATE SET
       name = EXCLUDED.name,
       name_hi = EXCLUDED.name_hi,
       district_code_short = EXCLUDED.district_code_short,
       rto_codes_all = EXCLUDED.rto_codes_all`,
  );
  console.log(`▸ district: ${n} upserted (Amravati, MH27)`);
}

async function importTalukas(client) {
  const rows = loadSheet(FILE.talukas);
  console.log(`▸ talukas: ${rows.length} rows in xlsx`);
  const parsed = [];
  for (const r of rows) {
    const code = parseInt(String(r['Sub-District LGD Code']).replace(/[^\d]/g, ''), 10);
    const name = String(r['Sub-District Name (In English)'] || '').trim();
    const nameHi = String(r['Sub-District Name (In Local language)'] || '').trim() || null;
    const hier = parseTalukaHierarchy(r['Hierarchy']);
    if (!code || !name || !hier) {
      console.warn(`  skip: bad row ${JSON.stringify(r).slice(0, 100)}`);
      continue;
    }
    if (hier.districtName.toLowerCase() !== 'amravati') {
      console.warn(`  skip: taluka ${name} not in Amravati (${hier.districtName})`);
      continue;
    }
    parsed.push({
      id: code,
      district_id: AMRAVATI_LGD,
      name,
      name_hi: nameHi,
    });
  }
  if (DRY_RUN) return console.log(`  would insert ${parsed.length} talukas`);
  const n = await batchInsert(
    client,
    'talukas',
    ['id', 'district_id', 'name', 'name_hi'],
    parsed,
  );
  console.log(`  inserted ${n}/${parsed.length} talukas`);
}

async function importVillages(client) {
  const rows = loadSheet(FILE.villages);
  console.log(`▸ villages: ${rows.length} rows in xlsx`);
  const parsed = [];
  const skipped = [];
  const talukaCodeByName = await talukaLookup(client);
  for (const r of rows) {
    const code = parseInt(String(r['Village LGD Code']).replace(/[^\d]/g, ''), 10);
    const name = String(r['Village Name (In English)'] || '').trim();
    const nameHi = String(r['Village Name (In Local language)'] || '').trim() || null;
    const hier = parseVillageHierarchy(r['Hierarchy']);
    // LGD PESA status codes: N = Not covered, F = Fully covered, P = Partially
    // covered (per LGD data dictionary). Treat F or P as PESA-flagged. Empty
    // string = data not populated → treat as not covered.
    const pesaCode = String(r['Pesa Status'] || '').trim().toUpperCase();
    const isPesa = pesaCode === 'F' || pesaCode === 'P';
    if (!code || !name || !hier) {
      skipped.push({ code, name, reason: 'bad row' });
      continue;
    }
    const talukaId = talukaCodeByName.get(normaliseTalukaName(hier.talukaName));
    if (!talukaId) {
      skipped.push({ code, name, reason: `taluka not found: ${hier.talukaName}` });
      continue;
    }
    parsed.push({
      id: code,
      taluka_id: talukaId,
      district_id: AMRAVATI_LGD,
      state_id: MAHARASHTRA_LGD,
      name,
      name_hi: nameHi,
      pincode: null,
      latitude: null,
      longitude: null,
      is_urban: false,
      is_pesa: isPesa,
    });
  }
  const pesaCount = parsed.filter((v) => v.is_pesa).length;
  console.log(
    `  parsed: ${parsed.length} (${pesaCount} PESA) · skipped: ${skipped.length}`,
  );
  if (skipped.length) {
    console.warn(`  first 5 skipped: ${JSON.stringify(skipped.slice(0, 5))}`);
  }
  if (DRY_RUN) return;
  // Upsert on villages — pre-existing rows from seed_demo.js have their
  // name / name_hi / is_pesa refreshed to LGD truth. is_urban is intentionally
  // written from EXCLUDED because a fresh import should reflect LGD's shape.
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
      'is_pesa',
    ],
    parsed,
    `(id) DO UPDATE SET
       taluka_id = EXCLUDED.taluka_id,
       district_id = EXCLUDED.district_id,
       state_id = EXCLUDED.state_id,
       name = EXCLUDED.name,
       name_hi = COALESCE(EXCLUDED.name_hi, villages.name_hi),
       is_urban = EXCLUDED.is_urban,
       is_pesa = EXCLUDED.is_pesa`,
  );
  console.log(`  upserted ${n}/${parsed.length} villages`);
}

// In-memory taluka map used by dry-run (no DB connection) + as a cache to
// avoid re-querying between the villages / urban-bodies / wards steps.
let DRY_TALUKA_MAP = null;

async function talukaLookup(client) {
  if (DRY_RUN) {
    if (!DRY_TALUKA_MAP) {
      DRY_TALUKA_MAP = new Map();
      for (const r of loadSheet(FILE.talukas)) {
        const code = parseInt(String(r['Sub-District LGD Code']).replace(/[^\d]/g, ''), 10);
        const name = String(r['Sub-District Name (In English)'] || '').trim();
        if (code && name) DRY_TALUKA_MAP.set(normaliseTalukaName(name), code);
      }
    }
    return DRY_TALUKA_MAP;
  }
  const r = await client.query(
    `SELECT id, name FROM talukas WHERE district_id = $1`,
    [AMRAVATI_LGD],
  );
  const m = new Map();
  for (const row of r.rows) m.set(normaliseTalukaName(row.name), row.id);
  return m;
}

function normaliseTalukaName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function importUrbanBodies(client) {
  const talukaMap = await talukaLookup(client);
  const parsed = [];
  const skipped = [];
  let idx = 0;
  for (const ub of AMRAVATI_URBAN_BODIES) {
    idx += 1;
    const talukaId = talukaMap.get(normaliseTalukaName(ub.host_taluka_name));
    if (!talukaId) {
      skipped.push(ub);
      continue;
    }
    parsed.push({
      id: URBAN_CATCHALL_BASE + idx * 100 + AMRAVATI_LGD, // e.g. 99000590, 99000690 ...
      taluka_id: talukaId,
      district_id: AMRAVATI_LGD,
      state_id: MAHARASHTRA_LGD,
      name: bodyDisplayName(ub),
      name_hi: ub.name_hi,
      pincode: null,
      latitude: null,
      longitude: null,
      is_urban: true,
      is_pesa: false,
    });
  }
  if (skipped.length) {
    console.warn(
      `▸ urban body catch-alls: ${skipped.length} skipped (taluka not found — likely a Nagar Panchayat whose host taluka name doesn't match LGD)`,
    );
    for (const s of skipped) console.warn(`    - ${s.name} (${s.type}, host: ${s.host_taluka_name})`);
  }
  console.log(`▸ urban body catch-alls: ${parsed.length} to insert`);
  if (DRY_RUN) return;
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
      'is_pesa',
    ],
    parsed,
  );
  console.log(`  inserted ${n}/${parsed.length} urban body catch-alls`);
}

async function importAmravatiWards(client) {
  const rows = loadSheet(FILE.wards_amravati);
  const talukaMap = await talukaLookup(client);
  const amravatiTaluka = talukaMap.get('amravati');
  if (!amravatiTaluka && !DRY_RUN) {
    throw new Error('Amravati taluka not found — import talukas first.');
  }
  const parsed = [];
  for (const r of rows) {
    const code = parseInt(String(r['Ward Code']).replace(/[^\d]/g, ''), 10);
    if (!code) continue;
    parsed.push({
      id: code,
      taluka_id: amravatiTaluka,
      district_id: AMRAVATI_LGD,
      state_id: MAHARASHTRA_LGD,
      name: friendlyWardName(r),
      name_hi: null,
      pincode: null,
      latitude: null,
      longitude: null,
      is_urban: true,
      is_pesa: false,
    });
  }
  console.log(`▸ Amravati M Corp wards: ${parsed.length} to insert`);
  if (DRY_RUN) return;
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
      'is_pesa',
    ],
    parsed,
  );
  console.log(`  inserted ${n}/${parsed.length} wards`);
}

async function activateLaunchScope(client) {
  if (DRY_RUN) return console.log('▸ activation (dry-run)');
  await client.query(`UPDATE states SET is_active = TRUE WHERE id = $1`, [MAHARASHTRA_LGD]);
  const r = await client.query(
    `UPDATE districts SET is_active = TRUE WHERE id = $1 RETURNING name, district_code_short`,
    [AMRAVATI_LGD],
  );
  if (r.rowCount) {
    console.log(`▸ activated: ${r.rows[0].name} (${r.rows[0].district_code_short})`);
  } else {
    console.warn('▸ activation: Amravati district row missing');
  }
}

async function reportCounts(client) {
  const q = async (sql) => (await client.query(sql)).rows[0];
  const s = await q('SELECT COUNT(*)::int n FROM states');
  const d = await q('SELECT COUNT(*)::int n FROM districts');
  const t = await q('SELECT COUNT(*)::int n FROM talukas');
  const v = await q(
    'SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE is_urban)::int urban, COUNT(*) FILTER (WHERE is_pesa)::int pesa FROM villages',
  );
  console.log('\n──── DB counts after import ────');
  console.log(`  states:   ${s.n}`);
  console.log(`  districts: ${d.n}`);
  console.log(`  talukas:  ${t.n}`);
  console.log(`  villages (total): ${v.total}`);
  console.log(`      rural: ${v.total - v.urban} · urban: ${v.urban} · PESA: ${v.pesa}`);
}

async function main() {
  console.log(
    `LGD xlsx import → dir="${XLSX_DIR}"  scope=${ONLY.join(',')}  ${DRY_RUN ? '(dry-run)' : ''}`,
  );

  // Dry-run does not touch the DB — just parse + report.
  if (DRY_RUN) {
    if (ONLY.includes('states')) await seedState(null);
    if (ONLY.includes('districts')) await seedDistrict(null);
    if (ONLY.includes('talukas')) await importTalukas(null);
    if (ONLY.includes('villages')) await importVillages(null);
    if (ONLY.includes('urban_bodies')) await importUrbanBodies(null);
    if (ONLY.includes('wards')) await importAmravatiWards(null);
    console.log('\n(dry-run) parsed all files successfully — no DB writes.');
    return;
  }

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
  const client = await pool.connect();
  try {
    if (ONLY.includes('states')) await seedState(client);
    if (ONLY.includes('districts')) await seedDistrict(client);
    if (ONLY.includes('talukas')) await importTalukas(client);
    if (ONLY.includes('villages')) await importVillages(client);
    if (ONLY.includes('urban_bodies')) await importUrbanBodies(client);
    if (ONLY.includes('wards')) await importAmravatiWards(client);
    await activateLaunchScope(client);
    await reportCounts(client);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
