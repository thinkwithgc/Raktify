#!/usr/bin/env node
/**
 * LGD geographic importer — Maharashtra + Delhi (state-wide).
 *
 * Reads the state-wide LGD Excel exports for both Maharashtra and Delhi.
 * Same 5 file types per state:
 *   1. districts        (districtofSpecificState*.xls)
 *   2. sub-districts    (subDistrictofSpecificState*.xls)
 *   3. villages         (villageofSpecificState*.xls)
 *   4. ULBs             (ulbSpecificState*.xls)                    — no parent district column
 *   5. ULB wards        (uLBWardforState*.xls)                     — has parent ULB code
 *
 * Header shape:
 *   districts / sub-districts / villages / ULBs → row idx 3 is column names,
 *     idx 4 has sub-labels "(In English)" / "(In Local)", real data from idx 5.
 *   wards → row idx 3 is header, real data from idx 4.
 *
 * Import policy (per user, 2026-07-03):
 *   • Seed data for both states so future activation is one flag flip.
 *   • Activate only Maharashtra state + Amravati district (LGD 27 / 490).
 *     Everything else stays is_active=FALSE.
 *
 * ULB → taluka resolution:
 *   The ULB file has no parent-district column. We name-match each ULB
 *   against the pool of talukas in the same state (case-insensitive, spaces
 *   + hyphens stripped). ~95% hit rate observed for Maharashtra; unmatched
 *   ULBs get logged and skipped (donor address flow doesn't rely on them).
 *
 * Ward → parent-ULB resolution:
 *   Each ward row carries Local Body Code. We look up the ULB in the freshly
 *   imported villages table and inherit its taluka_id + district_id +
 *   state_id.
 *
 * Preserve-on-upsert:
 *   villages.is_pesa is preserved with `villages.is_pesa OR EXCLUDED.is_pesa`
 *   because the state-wide village file dropped the PESA column, and we have
 *   280 Amravati PESA flags from the earlier Amravati-only import.
 *
 * Requires migration 294 (is_pesa + rto_codes_all).
 *
 * Config via env (all optional):
 *   LGD_XLSX_DIR    — path to the LGD Data folder
 *   DATABASE_URL    — target DB
 *
 * Usage:
 *   npm run lgd:import                        # everything
 *   npm run lgd:import -- --dry-run           # parse + report, no writes
 *   npm run lgd:import -- --only=districts,talukas,villages
 *   npm run lgd:import -- --state=MH          # skip Delhi
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
  : ['states', 'districts', 'talukas', 'villages', 'ulbs', 'wards'];
const STATE_FILTER = args.state ? String(args.state).split(',') : null;

const DEFAULT_XLSX_DIR =
  process.platform === 'win32'
    ? 'C:\\Users\\GauravChoudhari\\OneDrive - IBM\\03.Desktop\\04. Choudhari Foundation\\Raktify\\LGD Data'
    : path.resolve(__dirname, '../lgd-data');
const XLSX_DIR = process.env.LGD_XLSX_DIR || DEFAULT_XLSX_DIR;

// State-wide file batches. File names include a download timestamp; we key
// by that timestamp to route each state's 5 files together. If the user
// re-downloads, update the timestamp fragments here (or accept `--dir`).
const STATES = [
  {
    code: 27,
    name: 'Maharashtra',
    nameHi: 'महाराष्ट्र',
    iso: 'IN-MH',
    rtoPrefix: 'MH',
    files: {
      districts: 'districtofSpecificState2026_07_03_18_20_49_211.xls',
      talukas: 'subDistrictofSpecificState2026_07_03_18_20_49_269.xls',
      villages: 'villageofSpecificState2026_07_03_18_20_54_859.xls',
      ulbs: 'ulbSpecificState2026_07_03_18_20_57_871.xls',
      wards: 'uLBWardforState2026_07_03_18_20_58_777.xls',
    },
    activateDistrictNames: ['Amravati'],
  },
  {
    code: 7,
    name: 'NCT of Delhi',
    nameHi: 'दिल्ली',
    iso: 'IN-DL',
    rtoPrefix: 'DL',
    files: {
      districts: 'districtofSpecificState2026_07_03_18_35_01_749.xls',
      talukas: 'subDistrictofSpecificState2026_07_03_18_35_01_775.xls',
      villages: 'villageofSpecificState2026_07_03_18_35_01_835.xls',
      ulbs: 'ulbSpecificState2026_07_03_18_35_01_886.xls',
      wards: 'uLBWardforState2026_07_03_18_35_02_074.xls',
    },
    activateDistrictNames: [], // pilot doesn't activate Delhi yet
  },
];

// Districts whose district_code_short we set at import time — keyed by
// state_code → district NAME → RTO metadata. Name-keyed on purpose: LGD
// district codes have changed at least once between export versions (an
// earlier Amravati-only export had Amravati at id 490; the state-wide
// export has it at 468, and 490 is now Pune). Name-matching is stable.
// For Maharashtra, RTO per district is well-established public knowledge.
const RTO_MAPPING = {
  27: {
    // Maharashtra — only the pilot district is set for now.
    Amravati: { canonical: 'MH27', all: ['MH27', 'MH37'] }, // Amravati + Achalpur
  },
  7: {
    // Delhi RTO codes are zone-based, not district-aligned. Leave NULL.
  },
};

// Synthetic id range used by the previous Amravati-only import for urban body
// catch-alls. We nuke this range before the state-wide import so the real
// LGD-coded ULB rows can take over.
const SYNTHETIC_RANGE_MIN = 99_000_000;

// ── XLSX helpers ────────────────────────────────────────────────────────────

function loadSheetRaw(filename) {
  const full = path.join(XLSX_DIR, filename);
  if (!fs.existsSync(full)) {
    throw new Error(`LGD file missing: ${full}\nSet LGD_XLSX_DIR or drop the file at that path.`);
  }
  const wb = XLSX.readFile(full);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
}

function normaliseHeader(cell) {
  return String(cell || '').replace(/\s+/g, ' ').trim();
}

function detectHeaderRow(raw, firstColHint) {
  // The header row is the one whose first cell equals "S. No." or "S.No." etc.
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const cell = normaliseHeader(raw[i]?.[0] || '');
    if (/^s\.?\s*no\.?$/i.test(cell) && (!firstColHint || raw[i].some((c) => normaliseHeader(c).toLowerCase().includes(firstColHint.toLowerCase())))) {
      return i;
    }
  }
  return -1;
}

// Read one of the 4-column-family files (districts / talukas / villages / ULBs).
// Header on row idx H, sub-header on H+1, data from H+2. Returns array of
// objects keyed by normalised header names, resolving Local column collisions
// by suffixing "_local" on the second occurrence.
function loadTabularSheet(filename, headerHint) {
  const raw = loadSheetRaw(filename);
  const h = detectHeaderRow(raw, headerHint);
  if (h < 0) throw new Error(`Could not find header row in ${filename}`);
  const headerRow = raw[h].map(normaliseHeader);
  const subHeaderRow = (raw[h + 1] || []).map(normaliseHeader);
  // Determine data start: if any sub-header cell is "(In English)" / "(In Local)"
  // then data starts at h+2, else h+1.
  const hasSubHeader = subHeaderRow.some((c) => /\bIn (English|Local)\b/i.test(c));
  const dataStart = hasSubHeader ? h + 2 : h + 1;
  // Build column names — collapse "Foo (In English)" + "Foo (In Local)" into
  // Foo + Foo_local by appending _local to the second occurrence of duplicate
  // headers.
  const seen = new Map();
  const cols = headerRow.map((hd, i) => {
    let key = hd;
    if (hasSubHeader && /\bIn Local\b/i.test(subHeaderRow[i] || '')) {
      key = hd + '_local';
    }
    if (seen.has(key)) {
      key = key + '_2';
    }
    seen.set(key, i);
    return key;
  });
  // Convert data rows to objects.
  const out = [];
  for (let r = dataStart; r < raw.length; r++) {
    const row = raw[r];
    if (!row || row.every((c) => String(c).trim() === '')) continue;
    const obj = {};
    for (let c = 0; c < cols.length; c++) obj[cols[c]] = row[c];
    out.push(obj);
  }
  return out;
}

// The wards file only has a single header row (no sub-header). Cleaner path.
function loadWardsSheet(filename) {
  const raw = loadSheetRaw(filename);
  const h = detectHeaderRow(raw, 'Ward');
  if (h < 0) throw new Error(`Could not find header row in ${filename}`);
  const cols = raw[h].map(normaliseHeader);
  const out = [];
  for (let r = h + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!row || row.every((c) => String(c).trim() === '')) continue;
    const obj = {};
    for (let c = 0; c < cols.length; c++) obj[cols[c]] = row[c];
    out.push(obj);
  }
  return out;
}

function intOr(v, fallback = null) {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normaliseName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_.,()\[\]/]+/g, '');
}

// LGD ward names range from clean neighbourhood labels ("Shegaon-Rahatgaon")
// to noise like "Achalpur (M Ci) - Ward No. 10" that just repeats the parent
// ULB + type + ward number. Build a display name that keeps the ULB context,
// the ward number, and any real content that survives after we strip the
// redundant bits.
function friendlyWardName(ulbName, wardNumber, rawWardName) {
  let n = String(rawWardName || '').trim();
  if (n) {
    // Strip parent-ULB name (case-insensitive).
    const ulbEsc = String(ulbName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    n = n.replace(new RegExp(ulbEsc, 'gi'), '');
    // Strip common LGD annotations.
    n = n.replace(/\((?:m\s*ci|m\s*cl|np|nagar\s+panchayat|municipal\s+\w+)\)/gi, '');
    n = n.replace(/municipal\s+(?:corporation|council|committee)/gi, '');
    n = n.replace(/nagar\s+panchayat/gi, '');
    n = n.replace(/(?:^|\W)m\.?\s*(?:ci|cl)(?:\W|$)/gi, ' ');
    // Strip "Ward No. N" / "Ward N" / "WARD NO-N".
    n = n.replace(/ward\s*(?:no\.?|number)?\s*-?\s*\d+/gi, '');
    // Collapse punctuation + whitespace runs.
    n = n.replace(/[\s\-_.,]+/g, ' ').trim();
    n = n.replace(/^[\s\-–,]+|[\s\-–,]+$/g, '');
  }
  const base = `${ulbName} · Ward ${wardNumber}`;
  return n ? `${base} · ${n}` : base;
}

// ── Batched insert helper ───────────────────────────────────────────────────

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

// ── Per-state import steps ──────────────────────────────────────────────────

async function seedState(client, state) {
  if (DRY_RUN) return console.log(`▸ state (dry-run): ${state.name}`);
  const n = await batchInsert(
    client,
    'states',
    ['id', 'name', 'name_hi', 'iso_code', 'is_active'],
    [{
      id: state.code,
      name: state.name,
      name_hi: state.nameHi,
      iso_code: state.iso,
      is_active: state.code === 27,
    }],
    `(id) DO UPDATE SET
       name = EXCLUDED.name,
       name_hi = EXCLUDED.name_hi,
       iso_code = EXCLUDED.iso_code,
       is_active = states.is_active OR EXCLUDED.is_active`,
  );
  console.log(`▸ state ${state.name}: ${n} upserted`);
}

async function importDistricts(client, state) {
  const rows = loadTabularSheet(state.files.districts, 'District Code');
  console.log(`▸ [${state.rtoPrefix}] districts: ${rows.length} rows in xlsx`);
  const rtoMap = RTO_MAPPING[state.code] || {};
  const parsed = [];
  for (const r of rows) {
    const code = intOr(r['District Code']);
    const nameEn = String(r['District Name'] || '').trim();
    const nameLocal = String(r['District Name_local'] || '').trim() || null;
    if (!code || !nameEn) continue;
    const rto = rtoMap[nameEn];
    parsed.push({
      id: code,
      state_id: state.code,
      name: nameEn,
      name_hi: nameLocal,
      district_code_short: rto?.canonical || null,
      rto_codes_all: rto?.all || [],
      is_active: false, // activation is a separate step
      has_blood_centre: false,
    });
  }
  console.log(`  parsed: ${parsed.length}`);
  if (DRY_RUN) return;
  const n = await batchInsert(
    client,
    'districts',
    ['id', 'state_id', 'name', 'name_hi', 'district_code_short', 'rto_codes_all', 'is_active', 'has_blood_centre'],
    parsed,
    `(id) DO UPDATE SET
       state_id = EXCLUDED.state_id,
       name = EXCLUDED.name,
       name_hi = COALESCE(EXCLUDED.name_hi, districts.name_hi),
       district_code_short = COALESCE(EXCLUDED.district_code_short, districts.district_code_short),
       rto_codes_all = CASE
         WHEN cardinality(EXCLUDED.rto_codes_all) > 0 THEN EXCLUDED.rto_codes_all
         ELSE districts.rto_codes_all
       END`,
  );
  console.log(`  upserted ${n}`);
}

async function importTalukas(client, state) {
  const rows = loadTabularSheet(state.files.talukas, 'Subdistrict Code');
  console.log(`▸ [${state.rtoPrefix}] talukas: ${rows.length} rows in xlsx`);
  const parsed = [];
  for (const r of rows) {
    const code = intOr(r['Subdistrict Code']);
    const districtCode = intOr(r['District code']);
    const nameEn = String(r['Subdistrict Name'] || '').trim();
    const nameLocal = String(r['Subdistrict Name_local'] || '').trim() || null;
    if (!code || !districtCode || !nameEn) continue;
    parsed.push({ id: code, district_id: districtCode, name: nameEn, name_hi: nameLocal });
  }
  console.log(`  parsed: ${parsed.length}`);
  if (DRY_RUN) return;
  const n = await batchInsert(
    client,
    'talukas',
    ['id', 'district_id', 'name', 'name_hi'],
    parsed,
    `(id) DO UPDATE SET
       district_id = EXCLUDED.district_id,
       name = EXCLUDED.name,
       name_hi = COALESCE(EXCLUDED.name_hi, talukas.name_hi)`,
  );
  console.log(`  upserted ${n}`);
}

async function importVillages(client, state) {
  const rows = loadTabularSheet(state.files.villages, 'Village Code');
  console.log(`▸ [${state.rtoPrefix}] villages: ${rows.length} rows in xlsx`);
  const parsed = [];
  const skipped = [];
  for (const r of rows) {
    const code = intOr(r['Village Code']);
    const districtCode = intOr(r['District Code']);
    const talukaCode = intOr(r['Sub-District Code'] || r['Subdistrict Code']);
    const nameEn = String(r['Village Name'] || '').trim();
    const nameLocal = String(r['Village Name_local'] || '').trim() || null;
    if (!code || !districtCode || !talukaCode || !nameEn) {
      skipped.push({ code, reason: 'missing required cols' });
      continue;
    }
    parsed.push({
      id: code,
      taluka_id: talukaCode,
      district_id: districtCode,
      state_id: state.code,
      name: nameEn,
      name_hi: nameLocal,
      pincode: null,
      latitude: null,
      longitude: null,
      is_urban: false,
      // State-wide file has no Pesa column. Set FALSE; the upsert preserves
      // any existing TRUE (via OR merge).
      is_pesa: false,
    });
  }
  console.log(`  parsed: ${parsed.length} · skipped: ${skipped.length}`);
  if (DRY_RUN) return;
  const n = await batchInsert(
    client,
    'villages',
    ['id', 'taluka_id', 'district_id', 'state_id', 'name', 'name_hi', 'pincode', 'latitude', 'longitude', 'is_urban', 'is_pesa'],
    parsed,
    `(id) DO UPDATE SET
       taluka_id = EXCLUDED.taluka_id,
       district_id = EXCLUDED.district_id,
       state_id = EXCLUDED.state_id,
       name = EXCLUDED.name,
       name_hi = COALESCE(EXCLUDED.name_hi, villages.name_hi),
       is_urban = EXCLUDED.is_urban,
       is_pesa = villages.is_pesa OR EXCLUDED.is_pesa`,
  );
  console.log(`  upserted ${n}`);
}

async function importULBs(client, state) {
  const rows = loadTabularSheet(state.files.ulbs, 'Localbody Code');
  console.log(`▸ [${state.rtoPrefix}] ULBs: ${rows.length} rows in xlsx`);
  // Build taluka lookup: normalisedName → {taluka_id, district_id}, scoped to
  // this state.
  const tlk = await client.query(
    `SELECT t.id, t.name, t.district_id
       FROM talukas t
       JOIN districts d ON d.id = t.district_id
      WHERE d.state_id = $1`,
    [state.code],
  );
  const talukaByName = new Map();
  for (const r of tlk.rows) {
    talukaByName.set(normaliseName(r.name), { taluka_id: r.id, district_id: r.district_id });
  }
  const parsed = [];
  const skipped = [];
  for (const r of rows) {
    const code = intOr(r['Localbody Code']);
    const typeName = String(r['Localbody Type Name'] || '').trim();
    const nameEn = String(r['Local Body Name'] || '').trim();
    const nameLocal = String(r['Local Body Name_local'] || '').trim() || null;
    if (!code || !nameEn) continue;
    const match = talukaByName.get(normaliseName(nameEn));
    if (!match) {
      skipped.push({ code, name: nameEn, reason: 'no taluka match' });
      continue;
    }
    parsed.push({
      id: code,
      taluka_id: match.taluka_id,
      district_id: match.district_id,
      state_id: state.code,
      name: `${nameEn} (${typeName})`,
      name_hi: nameLocal,
      pincode: null,
      latitude: null,
      longitude: null,
      is_urban: true,
      is_pesa: false,
    });
  }
  console.log(`  matched: ${parsed.length} · skipped: ${skipped.length} (no taluka name match)`);
  if (skipped.length && skipped.length < 30) {
    for (const s of skipped) console.warn(`    - ${s.name} (LGD ${s.code})`);
  }
  if (DRY_RUN) return;
  const n = await batchInsert(
    client,
    'villages',
    ['id', 'taluka_id', 'district_id', 'state_id', 'name', 'name_hi', 'pincode', 'latitude', 'longitude', 'is_urban', 'is_pesa'],
    parsed,
    `(id) DO UPDATE SET
       taluka_id = EXCLUDED.taluka_id,
       district_id = EXCLUDED.district_id,
       state_id = EXCLUDED.state_id,
       name = EXCLUDED.name,
       name_hi = COALESCE(EXCLUDED.name_hi, villages.name_hi),
       is_urban = EXCLUDED.is_urban`,
  );
  console.log(`  upserted ${n}`);
}

async function importWards(client, state) {
  const rows = loadWardsSheet(state.files.wards);
  console.log(`▸ [${state.rtoPrefix}] wards: ${rows.length} rows in xlsx`);
  // ULB lookup — we imported ULBs into villages already. Match by LGD id.
  const ulbs = await client.query(
    `SELECT id, name, taluka_id, district_id, state_id
       FROM villages
      WHERE is_urban = TRUE
        AND state_id = $1`,
    [state.code],
  );
  const ulbById = new Map(ulbs.rows.map((r) => [r.id, r]));
  const parsed = [];
  const skipped = [];
  for (const r of rows) {
    const wardCode = intOr(r['Ward Code']);
    const ulbCode = intOr(r['Local Body Code']);
    const ulbName = String(r['Local Body Name'] || '').trim();
    const wardNumber = String(r['Ward Number'] || '').trim();
    const wardName = String(r['Ward Name'] || '').trim();
    if (!wardCode || !ulbCode) continue;
    const ulb = ulbById.get(ulbCode);
    if (!ulb) {
      skipped.push({ wardCode, ulbCode, ulbName, reason: 'parent ULB not imported' });
      continue;
    }
    parsed.push({
      id: wardCode,
      taluka_id: ulb.taluka_id,
      district_id: ulb.district_id,
      state_id: ulb.state_id,
      name: friendlyWardName(ulbName, wardNumber, wardName),
      name_hi: null,
      pincode: null,
      latitude: null,
      longitude: null,
      is_urban: true,
      is_pesa: false,
    });
  }
  console.log(`  matched: ${parsed.length} · skipped: ${skipped.length}`);
  if (DRY_RUN) return;
  const n = await batchInsert(
    client,
    'villages',
    ['id', 'taluka_id', 'district_id', 'state_id', 'name', 'name_hi', 'pincode', 'latitude', 'longitude', 'is_urban', 'is_pesa'],
    parsed,
    `(id) DO UPDATE SET
       taluka_id = EXCLUDED.taluka_id,
       district_id = EXCLUDED.district_id,
       state_id = EXCLUDED.state_id,
       name = EXCLUDED.name,
       is_urban = EXCLUDED.is_urban`,
  );
  console.log(`  upserted ${n}`);
}

async function purgeSyntheticCatchalls(client) {
  if (DRY_RUN) return;
  const r = await client.query(
    `DELETE FROM villages WHERE id >= $1 RETURNING id`,
    [SYNTHETIC_RANGE_MIN],
  );
  console.log(`▸ purged ${r.rowCount} synthetic catch-all rows (id >= ${SYNTHETIC_RANGE_MIN})`);
}

async function activatePilotScope(client) {
  if (DRY_RUN) return;
  for (const state of STATES) {
    if (state.activateDistrictNames?.length) {
      await client.query(`UPDATE states SET is_active = TRUE WHERE id = $1`, [state.code]);
    }
    for (const name of state.activateDistrictNames || []) {
      const r = await client.query(
        `UPDATE districts SET is_active = TRUE
          WHERE state_id = $1 AND name ILIKE $2
      RETURNING id, name, district_code_short`,
        [state.code, name],
      );
      if (r.rowCount) {
        console.log(
          `▸ activated: ${state.name} · ${r.rows[0].name} (LGD ${r.rows[0].id}, ${r.rows[0].district_code_short || 'no RTO'})`,
        );
      } else {
        console.warn(`▸ activation missed: no district named '${name}' in ${state.name}`);
      }
    }
  }
}

async function reportCounts(client) {
  const q = async (sql) => (await client.query(sql)).rows[0];
  const s = await q('SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE is_active)::int active FROM states');
  const d = await q('SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE is_active)::int active FROM districts');
  const t = await q('SELECT COUNT(*)::int n FROM talukas');
  const v = await q(
    'SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE is_urban)::int urban, COUNT(*) FILTER (WHERE is_pesa)::int pesa FROM villages',
  );
  console.log('\n──── DB counts ────');
  console.log(`  states:    ${s.n}  (active: ${s.active})`);
  console.log(`  districts: ${d.n}  (active: ${d.active})`);
  console.log(`  talukas:   ${t.n}`);
  console.log(`  villages:  ${v.total}  (rural: ${v.total - v.urban} · urban: ${v.urban} · PESA: ${v.pesa})`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const statesToRun = STATE_FILTER
    ? STATES.filter((s) => STATE_FILTER.includes(s.rtoPrefix))
    : STATES;
  console.log(
    `LGD import → dir="${XLSX_DIR}"  states=${statesToRun.map((s) => s.rtoPrefix).join(',')}  scope=${ONLY.join(',')}  ${DRY_RUN ? '(dry-run)' : ''}`,
  );

  if (DRY_RUN) {
    // Parse-only path — no DB.
    for (const state of statesToRun) {
      if (ONLY.includes('districts')) loadTabularSheet(state.files.districts, 'District Code');
      if (ONLY.includes('talukas')) loadTabularSheet(state.files.talukas, 'Subdistrict Code');
      if (ONLY.includes('villages')) {
        const rows = loadTabularSheet(state.files.villages, 'Village Code');
        console.log(`  [${state.rtoPrefix}] villages parsed: ${rows.length}`);
      }
      if (ONLY.includes('ulbs')) {
        const rows = loadTabularSheet(state.files.ulbs, 'Localbody Code');
        console.log(`  [${state.rtoPrefix}] ULBs parsed: ${rows.length}`);
      }
      if (ONLY.includes('wards')) {
        const rows = loadWardsSheet(state.files.wards);
        console.log(`  [${state.rtoPrefix}] wards parsed: ${rows.length}`);
      }
    }
    console.log('\n(dry-run) all files parsed — no DB writes.');
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
    if (ONLY.includes('ulbs') || ONLY.includes('wards')) {
      await purgeSyntheticCatchalls(client);
    }
    for (const state of statesToRun) {
      console.log(`\n══════ ${state.name} (${state.rtoPrefix}) ══════`);
      if (ONLY.includes('states')) await seedState(client, state);
      if (ONLY.includes('districts')) await importDistricts(client, state);
      if (ONLY.includes('talukas')) await importTalukas(client, state);
      if (ONLY.includes('villages')) await importVillages(client, state);
      if (ONLY.includes('ulbs')) await importULBs(client, state);
      if (ONLY.includes('wards')) await importWards(client, state);
    }
    await activatePilotScope(client);
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
