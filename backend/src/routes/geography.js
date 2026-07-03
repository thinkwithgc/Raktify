/**
 * Public geographic lookups for the onboarding form and other
 * unauthenticated UI. Returns only is_active=TRUE rows so the picker
 * can't surface unsupported districts yet.
 *
 *   GET /geography/states
 *   GET /geography/districts?state_id=27
 *   GET /geography/talukas?district_id=501
 *
 * These tables are world-readable per RLS (ref_read_all_*). The
 * endpoints use the unauthenticated pool with the `app_user` role.
 */
const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

router.get('/states', async (_req, res) => {
  const r = await pool.query(
    `SELECT id, name, name_hi, iso_code
       FROM states
      WHERE is_active = TRUE
      ORDER BY name`,
  );
  res.json({ states: r.rows });
});

router.get('/districts', async (req, res) => {
  const stateId = Number(req.query.state_id);
  if (!Number.isFinite(stateId)) return res.status(400).json({ error: 'state_id_required' });
  const r = await pool.query(
    `SELECT id, state_id, name, name_hi, district_code_short
       FROM districts
      WHERE state_id = $1 AND is_active = TRUE
      ORDER BY name`,
    [stateId],
  );
  res.json({ districts: r.rows });
});

router.get('/talukas', async (req, res) => {
  const districtId = Number(req.query.district_id);
  if (!Number.isFinite(districtId)) {
    return res.status(400).json({ error: 'district_id_required' });
  }
  const r = await pool.query(
    `SELECT id, district_id, name, name_hi
       FROM talukas
      WHERE district_id = $1
      ORDER BY name`,
    [districtId],
  );
  res.json({ talukas: r.rows });
});

// ── GET /geography/locality-search ──────────────────────────────────────────
// Typeahead for the donor "Where do you live?" field. Searches every leaf
// locality in the villages table — real villages, urban body catch-alls
// (Municipal Corporations / Councils / Nagar Panchayats), and Municipal
// Corporation wards — restricted to states + districts with is_active=TRUE
// (i.e. currently only Amravati). Uses the pg_trgm GIN index on villages.name
// so the query is O(millisecond) even against ~46k rows.
//
// Query params:
//   q               required, 2+ chars
//   district_id     optional — when set, restrict results to that district
//   limit           optional, default 20, max 50
//
// Response shape:
//   { localities: [{ id, name, name_hi, is_urban, is_pesa,
//                    taluka_id, taluka_name,
//                    district_id, district_name, district_code_short,
//                    state_id, state_name }, ...] }
router.get('/locality-search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'q_min_2_chars' });
  }
  const districtId = req.query.district_id ? Number(req.query.district_id) : null;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  const filters = [
    's.is_active = TRUE',
    'd.is_active = TRUE',
    '(v.name ILIKE $1 OR similarity(v.name, $2) > 0.3)',
  ];
  const params = [`%${q}%`, q];
  if (districtId && Number.isFinite(districtId)) {
    params.push(districtId);
    filters.push(`v.district_id = $${params.length}`);
  }
  params.push(limit);

  const r = await pool.query(
    // eslint-disable-next-line no-restricted-syntax
    `SELECT v.id, v.name, v.name_hi, v.is_urban, v.is_pesa,
            v.taluka_id, t.name AS taluka_name,
            v.district_id, d.name AS district_name, d.district_code_short,
            v.state_id, s.name AS state_name
       FROM villages v
       JOIN districts d ON d.id = v.district_id
       JOIN states s ON s.id = v.state_id
  LEFT JOIN talukas t ON t.id = v.taluka_id
      WHERE ${filters.join(' AND ')}
   ORDER BY
       CASE WHEN v.name ILIKE $2 || '%' THEN 0 ELSE 1 END,
       v.is_urban DESC,
       similarity(v.name, $2) DESC,
       v.name
      LIMIT $${params.length}`,
    params,
  );
  res.json({ localities: r.rows });
});

module.exports = router;
