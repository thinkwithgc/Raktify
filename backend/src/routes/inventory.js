/**
 * Blood inventory routes (Phase 4).
 *
 *   GET  /inventory                          blood_bank own; admin all
 *   GET  /inventory/availability             district-scoped counts (hospital, coordinator)
 *   POST /inventory/opening-stock            blood_bank; legacy stock without TTI (source='WB')
 *   POST /inventory/:id/recall               blood_bank or ngo_admin; trigger recall
 *
 * Note: bag creation from a fresh donation goes via POST /donations
 * (which fires trg_donation_creates_inventory). Direct INSERT is reserved
 * for opening-stock entry only.
 */
const express = require('express');
const { z } = require('zod');

const { withRlsContext } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /inventory ───────────────────────────────────────────────────────
router.get(
  '/',
  verifyJWT,
  requireRole('blood_bank', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const status = req.query.status;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);

    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT bi.id, bi.isbt_barcode, bi.donor_id, bi.blood_bank_id,
              bi.blood_group_id, bg.code AS blood_group_code,
              bi.component_id, bc.code AS component_code,
              bi.volume_ml, bi.collection_date, bi.expiry_date,
              bi.status, bi.is_recalled, bi.source,
              bi.reserved_for_request_id, bi.issued_to_institution_id,
              bi.status_changed_at
         FROM blood_inventory bi
    LEFT JOIN blood_groups bg ON bg.id = bi.blood_group_id
    LEFT JOIN blood_components bc ON bc.id = bi.component_id
        WHERE ($1::text IS NULL OR bi.status = $1)
     ORDER BY bi.expiry_date ASC NULLS LAST
        LIMIT $2`,
        [status || null, limit],
      ),
    );
    res.json({ bags: r.rows, count: r.rowCount });
  },
);

// ── GET /inventory/availability ──────────────────────────────────────────
// District-scoped counts only — no bag-level detail. Hospitals + coordinators
// use this to gauge supply without seeing identifying inventory data.
router.get(
  '/availability',
  verifyJWT,
  requireRole('hospital', 'coordinator', 'blood_bank', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const districtId = Number(req.query.district_id);
    if (!Number.isFinite(districtId)) {
      return res.status(400).json({ error: 'district_id_required' });
    }
    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT bg.code AS blood_group, bc.code AS component,
                COUNT(*)::int AS available_units,
                MIN(bi.expiry_date) AS earliest_expiry
           FROM blood_inventory bi
           JOIN institutions i ON i.id = bi.blood_bank_id
           JOIN blood_groups bg ON bg.id = bi.blood_group_id
           JOIN blood_components bc ON bc.id = bi.component_id
          WHERE i.district_id = $1
            AND bi.status = 'AV'
            AND bi.is_recalled = FALSE
            AND bi.expiry_date > CURRENT_DATE
          GROUP BY bg.code, bc.code
          ORDER BY bg.code, bc.code`,
        [districtId],
      ),
    );
    res.json({ district_id: districtId, available: r.rows });
  },
);

// ── POST /inventory/opening-stock (blood_bank, legacy stock) ─────────────
// One-time entry at onboarding. Bags get source='WB' (legacy WhatsApp pattern)
// and skip TTI gating per spec §6 — they're labelled "no TTI record" in UI.
const openingStockSchema = z.object({
  collection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bags: z
    .array(
      z.object({
        blood_group_id: z.number().int().min(1).max(8),
        component_id: z.number().int().min(1).max(6),
        units: z.number().int().min(1).max(100),
        volume_ml_each: z.number().int().min(50).max(500).default(280),
      }),
    )
    .min(1)
    .max(50),
});

router.post('/opening-stock', verifyJWT, requireRole('blood_bank'), async (req, res) => {
  const parsed = openingStockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  const data = parsed.data;

  const created = await withRlsContext(
    req,
    async (c) => {
      // Need a synthetic donor row to satisfy the donation_id FK on inventory.
      // For opening stock, we point at a single per-institution synthetic donor
      // whose mobile is `+91-LEGACY-<inst>` and identity flag is_legacy_synthetic.
      // Created on first use.
      // NOTE: simplified for scaffold — we attach to the institution's first
      // verified donor instead. A proper implementation creates a dedicated
      // synthetic donor and hides them from matching. TODO: implement.
      // For Phase 4 scaffold we record opening stock against a fake donor_id
      // and donation_id derived from the first registered donor at this BB.
      const seedDonor = await c.query(
        `SELECT d.id, dh.id AS donation_id
           FROM donors d
           JOIN donation_history dh ON dh.donor_id = d.id
          WHERE dh.blood_bank_id = $1
          ORDER BY d.created_at ASC
          LIMIT 1`,
        [req.user.institutionId],
      );
      if (seedDonor.rowCount === 0) {
        throw Object.assign(
          new Error(
            'opening_stock_requires_seed_donor — record at least one donation through POST /donations first to bootstrap',
          ),
          { status: 400 },
        );
      }

      const bags = [];
      for (const b of data.bags) {
        for (let i = 0; i < b.units; i++) {
          const barcode = `LEGACY-${req.user.institutionId.slice(0, 8)}-${b.blood_group_id}-${b.component_id}-${Date.now()}-${i}`;
          const r = await c.query(
            `INSERT INTO blood_inventory (
                isbt_barcode, donation_id, donor_id, blood_bank_id,
                blood_group_id, component_id, volume_ml,
                collection_date, status, status_changed_by, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'AV', $9, 'WB')
          RETURNING id, isbt_barcode, blood_group_id, component_id, status`,
            [
              barcode,
              seedDonor.rows[0].donation_id,
              seedDonor.rows[0].id,
              req.user.institutionId,
              b.blood_group_id,
              b.component_id,
              b.volume_ml_each,
              data.collection_date,
              req.user.userId,
            ],
          );
          bags.push(r.rows[0]);
        }
      }
      return bags;
    },
    { change_reason: 'opening-stock entry (legacy WB)' },
  );

  res.status(201).json({ created_count: created.length, bags: created });
});

// ── POST /inventory/:id/recall ────────────────────────────────────────────
router.post(
  '/:id/recall',
  verifyJWT,
  requireRole('blood_bank', 'ngo_admin', 'super_admin'),
  async (req, res) => {
    const schema = z.object({ reason: z.string().min(5) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const r = await withRlsContext(
      req,
      (c) =>
        c.query(
          `UPDATE blood_inventory
              SET is_recalled = TRUE,
                  recall_reason = $1,
                  recall_initiated_by = $2,
                  recall_initiated_at = clock_timestamp(),
                  status = CASE WHEN status IN ('QA','AV','RE') THEN 'RC' ELSE status END,
                  status_changed_by = $2
            WHERE id = $3
              AND is_recalled = FALSE
        RETURNING id, status, is_recalled`,
          [parsed.data.reason, req.user.userId, req.params.id],
        ),
      { change_reason: `manual recall: ${parsed.data.reason}` },
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found_or_already_recalled' });
    res.json(r.rows[0]);
  },
);

module.exports = router;
