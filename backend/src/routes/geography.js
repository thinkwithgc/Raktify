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
// Typeahead for the donor "Your village or area" field. Searches every leaf
// locality in the villages table — real villages, urban body catch-alls,
// and Municipal Corporation wards — restricted to states + districts with
// is_active = TRUE (currently only Amravati).
//
// Matching rules (word-prefix — strict enough to avoid noise, loose enough
// to find compound names):
//
//   1. Word-prefix match on village / ULB / ward name (case-insensitive).
//      The typed text must match the START OF A WORD in the name — either the
//      whole name or any word after a space. So "achal" matches "Achalpur",
//      and — crucially — "sant gadgebaba" matches
//      "Amravati · Ward 3 · Shri Sant Gadgebaba" (the ward name lives in the
//      middle of the LGD label). It still does NOT match "Aajangaon" for a
//      typed "anjangaon", because that's not a word-prefix.
//
//   2. If the typed text prefix-matches a taluka name, ALL villages in that
//      taluka surface too — so typing "anjangaon" shows every village in
//      Anjangaon Surji taluka, not just those with "anjangaon" in the name.
//
//   3. No trigram / similarity fallback. Zero hits returns an empty list
//      rather than surfacing "close-ish" villages that merely share a suffix
//      like -alpur or -gaon.
//
// Query params:
//   q               required, 2+ chars
//   district_id     optional — restrict results to that district
//   limit           optional, default 20, max 50
router.get('/locality-search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'q_min_2_chars' });
  }
  const districtId =
    req.query.district_id && Number.isFinite(Number(req.query.district_id))
      ? Number(req.query.district_id)
      : null;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));
  // Two ILIKE patterns: `startsWith` = name begins with q; `wordStart` = q
  // begins a later word (appears right after a space). Together they mean
  // "q is the prefix of some word in the name".
  const startsWith = `${q}%`;
  const wordStart = `% ${q}%`;

  // Step 1 — does q prefix-match any taluka in an active district? (taluka
  // names are short + unambiguous, so prefix-only is fine here.)
  const talukaParams = [startsWith];
  let talukaExtra = '';
  if (districtId) {
    talukaParams.push(districtId);
    talukaExtra = 'AND t.district_id = $2';
  }
  const talukaMatches = await pool.query(
    // `talukaExtra` is one of two hardcoded fragments (`''` or
    // `'AND t.district_id = $2'`) selected by whether the caller passed a
    // district_id filter. Never contains user input; district_id itself is
    // parameterised via $2.
    // eslint-disable-next-line no-restricted-syntax
    `SELECT t.id
       FROM talukas t
       JOIN districts d ON d.id = t.district_id
       JOIN states s ON s.id = d.state_id
      WHERE s.is_active AND d.is_active
        AND t.name ILIKE $1
        ${talukaExtra}
      ORDER BY LENGTH(t.name), t.name
      LIMIT 5`,
    talukaParams,
  );
  const talukaIds = talukaMatches.rows.map((r) => r.id);

  // Step 2 — search villages. Word-prefix match on the village name always
  //          ($1 = starts-with, $2 = starts a later word). If any taluka
  //          matched, additionally include all villages in those talukas.
  const params = [startsWith, wordStart];
  const nameMatch = '(v.name ILIKE $1 OR v.name ILIKE $2)';
  const filters = ['s.is_active = TRUE', 'd.is_active = TRUE'];
  if (talukaIds.length > 0) {
    params.push(talukaIds);
    filters.push(`(${nameMatch} OR v.taluka_id = ANY($${params.length}::int[]))`);
  } else {
    filters.push(nameMatch);
  }
  if (districtId) {
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
       CASE WHEN v.name ILIKE $1 THEN 0 ELSE 1 END,
       v.is_urban DESC,
       LENGTH(v.name),
       v.name
      LIMIT $${params.length}`,
    params,
  );
  res.json({ localities: r.rows });
});

module.exports = router;
