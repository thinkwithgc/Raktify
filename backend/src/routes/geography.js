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

module.exports = router;
