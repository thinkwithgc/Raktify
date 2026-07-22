/**
 * Donor Alert routes (V2 spec — donor-BB routing).
 *
 *   GET  /donor-alerts/mine                    donor's active alerts
 *   GET  /donor-alerts/:id                     one alert + BB routing options
 *   POST /donor-alerts/:id/accept-with-bb      donor commits + picks BB
 *   POST /donor-alerts/:id/decline             donor says "not this time"
 *
 * BB routing list: given donor's current lat/lng (browser Geolocation), we
 * return all BBs in the request's district that:
 *   - Have compatible AV stock in the request's blood group + component
 *     (they're able to receive walk-in donors — see spec §5 refinement 2)
 *   - Are NOT declined with NC/ND for this request (capacity block).
 *
 * BBs declined with NS (no stock) stay in the list — they can still accept
 * fresh donations. Distances calculated server-side via Haversine.
 *
 * Rural gaps of 50+ km exist (Chikhaldara etc.); we do NOT filter by radius.
 * Donor decides what they can travel.
 */
const express = require('express');
const { z } = require('zod');

const { withRlsContext, withRlsContextRaw } = require('../middleware/rlsContext');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { mintDonorAlertToken, verifyDonorAlertToken } = require('../services/donor-alert-tokens');
const { open, openRow } = require('../services/pii');

const router = express.Router();

// One-tap public flow: donor clicks WhatsApp button → lands on /alert/:token
// on the frontend → this route family serves that page. No JWT required —
// the URL token is the auth primitive.
function loadTokenOr401(req, res) {
  const result = verifyDonorAlertToken(req.params.token);
  if (!result.ok) {
    res.status(401).json({ error: result.error });
    return null;
  }
  return result;
}

// ── Public (token-authenticated) routes ──────────────────────────────────
// These endpoints do NOT require donor JWT. The URL token is verified per
// request. Used by the WhatsApp deep-link → /alert/:token frontend page so
// donors can respond one-tap without OTP.

// ── GET /donor-alerts/public/:token ──────────────────────────────────────
// Alert context + BB routing options. Accepts optional ?lat=&lng= query
// params to compute distances server-side.
router.get('/public/:token', async (req, res) => {
  const auth = loadTokenOr401(req, res);
  if (!auth) return;
  const donorLat = req.query.lat ? Number(req.query.lat) : null;
  const donorLng = req.query.lng ? Number(req.query.lng) : null;

  const result = await withRlsContextRaw(
    { actor_role: 'system', change_reason: 'donor_alert_public_view' },
    async (c) => {
      const alertRow = (
        await c.query(
          `SELECT da.id, da.request_id, da.donor_id, da.arrival_committed_at,
                  da.donor_response,
                  br.request_number, br.urgency_tier, br.units_required,
                  br.status AS request_status,
                  br.requesting_hospital_district_id,
                  br.component_id, br.patient_blood_group_id,
                  bg.code AS blood_group, bc.code AS component,
                  d.name AS district_name,
                  COALESCE(rh.display_name, br.guest_hospital_name) AS hospital_name,
                  dnr.full_name AS donor_name,
                  dnr.preferred_language AS donor_language
             FROM donor_alerts da
             JOIN blood_requests br ON br.id = da.request_id
             JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
             JOIN blood_components bc ON bc.id = br.component_id
             JOIN donors dnr ON dnr.id = da.donor_id
        LEFT JOIN districts d ON d.id = br.requesting_hospital_district_id
        LEFT JOIN institutions rh ON rh.id = br.requesting_institution_id
            WHERE da.id = $1 AND da.donor_id = $2`,
          [auth.alertId, auth.donorId],
        )
      ).rows[0];
      if (!alertRow) {
        throw Object.assign(new Error('alert_not_found'), { status: 404 });
      }

      const bbs = (
        await c.query(
          `WITH declined_out AS (
             SELECT blood_bank_id
               FROM open_request_bb_declines
              WHERE request_id = $1
                AND reason IN ('NC','ND')
                AND expires_at > NOW()
           )
           SELECT DISTINCT i.id AS blood_bank_id,
                  i.display_name AS bb_name,
                  i.latitude, i.longitude,
                  COALESCE(i.address_line, '') AS address,
                  CASE
                    WHEN $2::numeric IS NULL OR $3::numeric IS NULL
                      OR i.latitude IS NULL OR i.longitude IS NULL
                    THEN NULL
                    ELSE 6371 * acos(
                      LEAST(1.0, GREATEST(-1.0,
                        cos(radians($2::numeric)) * cos(radians(i.latitude))
                        * cos(radians(i.longitude) - radians($3::numeric))
                        + sin(radians($2::numeric)) * sin(radians(i.latitude))
                      ))
                    )
                  END::numeric(6,2) AS distance_km
             FROM blood_inventory bi
             JOIN institutions i ON i.id = bi.blood_bank_id
             JOIN compatibility_matrix cm
               ON cm.component_id = bi.component_id
              AND cm.donor_group_id = bi.blood_group_id
              AND cm.recipient_group_id = $4
              AND cm.is_compatible = TRUE
            WHERE i.district_id = $5
              AND bi.component_id = $6
              AND bi.status = 'AV'
              AND bi.is_recalled = FALSE
              AND bi.expiry_date > CURRENT_DATE
              AND i.id NOT IN (SELECT blood_bank_id FROM declined_out)
         ORDER BY distance_km ASC NULLS LAST, bb_name ASC
            LIMIT 50`,
          [
            alertRow.request_id,
            donorLat,
            donorLng,
            alertRow.patient_blood_group_id,
            alertRow.requesting_hospital_district_id,
            alertRow.component_id,
          ],
        )
      ).rows;

      openRow(alertRow, ['donor_name']); // donor name is column-encrypted at rest
      return { alert: alertRow, blood_bank_options: bbs };
    },
  );
  res.json(result);
});

// ── POST /donor-alerts/public/:token/accept-with-bb ─────────────────────
const publicAcceptSchema = z.object({
  chosen_blood_bank_id: z.string().uuid(),
  donor_lat: z.number().finite().optional(),
  donor_lng: z.number().finite().optional(),
  distance_to_bb_km: z.number().finite().optional(),
  expected_arrival_at: z.string().optional(),
});

router.post('/public/:token/accept-with-bb', async (req, res) => {
  const auth = loadTokenOr401(req, res);
  if (!auth) return;
  const parsed = publicAcceptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  const data = parsed.data;

  const result = await withRlsContextRaw(
    { actor_role: 'system', change_reason: 'donor_alert_public_accept' },
    async (c) => {
      const alertRow = (
        await c.query(`SELECT id, request_id FROM donor_alerts WHERE id = $1 AND donor_id = $2`, [
          auth.alertId,
          auth.donorId,
        ])
      ).rows[0];
      if (!alertRow) {
        throw Object.assign(new Error('alert_not_found'), { status: 404 });
      }

      await c.query(
        `UPDATE donor_alerts
            SET donor_response = 'YE',
                responded_at = clock_timestamp(),
                arrival_committed_at = clock_timestamp()
          WHERE id = $1`,
        [auth.alertId],
      );

      const choice = (
        await c.query(
          `INSERT INTO donor_alert_choices (
             donor_alert_id, donor_id, request_id, chosen_blood_bank_id,
             donor_lat, donor_lng, distance_to_bb_km, expected_arrival_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (donor_id, request_id) DO UPDATE
             SET donor_alert_id = EXCLUDED.donor_alert_id,
                 chosen_blood_bank_id = EXCLUDED.chosen_blood_bank_id,
                 donor_lat = EXCLUDED.donor_lat,
                 donor_lng = EXCLUDED.donor_lng,
                 distance_to_bb_km = EXCLUDED.distance_to_bb_km,
                 expected_arrival_at = EXCLUDED.expected_arrival_at,
                 accepted_at = clock_timestamp(),
                 status = CASE WHEN donor_alert_choices.status IN ('CN','NS')
                              THEN 'PE' ELSE donor_alert_choices.status END,
                 cancelled_at = NULL,
                 cancelled_reason = NULL,
                 deadline_at = clock_timestamp() + INTERVAL '48 hours'
        RETURNING id, chosen_blood_bank_id, deadline_at, status`,
          [
            auth.alertId,
            auth.donorId,
            alertRow.request_id,
            data.chosen_blood_bank_id,
            data.donor_lat ?? null,
            data.donor_lng ?? null,
            data.distance_to_bb_km ?? null,
            data.expected_arrival_at || null,
          ],
        )
      ).rows[0];

      return {
        choice_id: choice.id,
        chosen_bb_id: choice.chosen_blood_bank_id,
        deadline_at: choice.deadline_at,
        status: choice.status,
        request_id: alertRow.request_id,
      };
    },
  );

  // Notify the chosen BB that a donor is inbound. Done AFTER the DB write
  // commits — the BB's Incoming Donors tab reads from donor_alert_choices,
  // so the notification tells staff to open it. No-ops silently when the
  // WHATSAPP_TEMPLATE_BB_DONOR_INCOMING env var isn't set yet.
  //
  // Fire-and-forget: a failed WA send must NOT roll back the donor's
  // acceptance. Errors go to the log.
  notifyBBOfIncomingDonor({
    bbId: result.chosen_bb_id,
    donorId: auth.donorId,
    requestId: result.request_id,
    alertId: auth.alertId,
    expectedArrivalAt: data.expected_arrival_at || null,
  }).catch((err) => {
    require('../config/logger').error(
      { err: err.message, alert_id: auth.alertId, bb_id: result.chosen_bb_id },
      'bb_donor_incoming dispatch failed',
    );
  });

  res.status(201).json({
    choice_id: result.choice_id,
    chosen_bb_id: result.chosen_bb_id,
    deadline_at: result.deadline_at,
    status: result.status,
  });
});

// Fire the bb_donor_incoming WhatsApp to the BB's primary contact. Runs
// AFTER the accept transaction commits, in its own actor_role='system'
// context so RLS lets us read donor + institution.
async function notifyBBOfIncomingDonor({ bbId, donorId, requestId, alertId, expectedArrivalAt }) {
  if (!bbId) return;
  const { sendNotification } = require('../services/notifications');
  await withRlsContextRaw(
    { actor_role: 'system', change_reason: 'bb_donor_incoming' },
    async (c) => {
      const row = (
        await c.query(
          `SELECT d.full_name AS donor_name,
                  bg.code AS donor_blood_group,
                  br.request_number,
                  i.primary_contact_mobile AS bb_mobile
             FROM donors d
             JOIN blood_groups bg ON bg.id = d.blood_group_verified
             JOIN blood_requests br ON br.id = $2
             JOIN institutions i ON i.id = $3
            WHERE d.id = $1`,
          [donorId, requestId, bbId],
        )
      ).rows[0];
      if (!row || !row.bb_mobile) return;
      row.donor_name = open(row.donor_name); // decrypt before it goes into the WA template

      const arrivalWindow = expectedArrivalAt
        ? new Date(expectedArrivalAt).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'within the next 2 hours';

      await sendNotification({
        recipientId: bbId,
        templateType: 'BB_DONOR_INCOMING',
        variables: {
          donor_display_name: row.donor_name || 'Donor',
          donor_blood_group: row.donor_blood_group || '',
          request_short_code: row.request_number || String(requestId).slice(0, 8),
          arrival_window: arrivalWindow,
          donor_id: donorId,
        },
        channel: 'WA',
        language: 'en',
        relatedRequestId: requestId,
        relatedAlertId: alertId,
      });
    },
  );
}

// ── POST /donor-alerts/public/:token/decline ─────────────────────────────
router.post('/public/:token/decline', async (req, res) => {
  const auth = loadTokenOr401(req, res);
  if (!auth) return;

  await withRlsContextRaw(
    { actor_role: 'system', change_reason: 'donor_alert_public_decline' },
    async (c) => {
      await c.query(
        `UPDATE donor_alerts
            SET donor_response = 'NO', responded_at = clock_timestamp()
          WHERE id = $1 AND donor_id = $2`,
        [auth.alertId, auth.donorId],
      );
      await c.query(
        `UPDATE donor_alert_choices
            SET status = 'CN',
                cancelled_at = clock_timestamp(),
                cancelled_reason = 'donor_declined_after_accepting'
          WHERE donor_alert_id = $1
            AND donor_id = $2
            AND status IN ('PE','AR')`,
        [auth.alertId, auth.donorId],
      );
    },
  );
  res.json({ declined: true });
});

// Admin-only utility: mint a test token so we can verify the flow before
// WhatsApp templates land. Never call from public code; behind requireRole.
router.post(
  '/:id/mint-token',
  verifyJWT,
  requireRole('ngo_admin', 'super_admin', 'coordinator'),
  async (req, res) => {
    const result = await withRlsContext(req, async (c) => {
      const r = (
        await c.query(
          `SELECT da.id AS alert_id, da.donor_id, br.urgency_tier
             FROM donor_alerts da
             JOIN blood_requests br ON br.id = da.request_id
            WHERE da.id = $1`,
          [req.params.id],
        )
      ).rows[0];
      if (!r) throw Object.assign(new Error('alert_not_found'), { status: 404 });
      return {
        token: mintDonorAlertToken({
          alertId: r.alert_id,
          donorId: r.donor_id,
          urgencyTier: r.urgency_tier,
        }),
      };
    });
    res.json(result);
  },
);

// ── GET /donor-alerts/mine ───────────────────────────────────────────────
router.get('/mine', verifyJWT, requireRole('donor'), async (req, res) => {
  const rows = await withRlsContext(req, async (c) => {
    const me = (
      await c.query(`SELECT id FROM donors WHERE platform_user_id = $1 LIMIT 1`, [req.user.userId])
    ).rows[0];
    if (!me) throw Object.assign(new Error('donor_profile_missing'), { status: 404 });

    const r = await c.query(
      `SELECT da.id, da.request_id, da.match_reason, da.alerted_at,
              da.donor_response, da.responded_at, da.arrival_committed_at,
              br.request_number, br.urgency_tier, br.units_required,
              br.status AS request_status,
              bg.code AS blood_group, bc.code AS component,
              dac.id AS choice_id, dac.chosen_blood_bank_id, dac.status AS choice_status,
              dac.deadline_at,
              i.display_name AS chosen_bb_name
         FROM donor_alerts da
         JOIN blood_requests br ON br.id = da.request_id
         JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
         JOIN blood_components bc ON bc.id = br.component_id
    LEFT JOIN donor_alert_choices dac
           ON dac.donor_alert_id = da.id AND dac.donor_id = da.donor_id
    LEFT JOIN institutions i ON i.id = dac.chosen_blood_bank_id
        WHERE da.donor_id = $1
     ORDER BY CASE br.urgency_tier WHEN 'CR' THEN 0 WHEN 'UR' THEN 1 ELSE 2 END,
              da.alerted_at DESC
        LIMIT 20`,
      [me.id],
    );
    return r.rows;
  });
  res.json({ alerts: rows });
});

// ── GET /donor-alerts/:id ────────────────────────────────────────────────
// One alert + BB routing options (given donor's current lat/lng)
router.get('/:id', verifyJWT, requireRole('donor'), async (req, res) => {
  const alertId = req.params.id;
  const donorLat = req.query.lat ? Number(req.query.lat) : null;
  const donorLng = req.query.lng ? Number(req.query.lng) : null;

  const result = await withRlsContext(req, async (c) => {
    const me = (
      await c.query(`SELECT id FROM donors WHERE platform_user_id = $1 LIMIT 1`, [req.user.userId])
    ).rows[0];
    if (!me) throw Object.assign(new Error('donor_profile_missing'), { status: 404 });

    // The alert + request context (already scope-checked via RLS)
    const alertRow = (
      await c.query(
        `SELECT da.id, da.request_id, da.donor_id, da.arrival_committed_at,
                da.donor_response,
                br.request_number, br.urgency_tier, br.units_required,
                br.status AS request_status,
                br.requesting_hospital_district_id,
                br.component_id, br.patient_blood_group_id,
                bg.code AS blood_group, bc.code AS component,
                d.name AS district_name,
                COALESCE(rh.display_name, br.guest_hospital_name) AS hospital_name
           FROM donor_alerts da
           JOIN blood_requests br ON br.id = da.request_id
           JOIN blood_groups bg ON bg.id = br.patient_blood_group_id
           JOIN blood_components bc ON bc.id = br.component_id
      LEFT JOIN districts d ON d.id = br.requesting_hospital_district_id
      LEFT JOIN institutions rh ON rh.id = br.requesting_institution_id
          WHERE da.id = $1 AND da.donor_id = $2`,
        [alertId, me.id],
      )
    ).rows[0];
    if (!alertRow) throw Object.assign(new Error('alert_not_found'), { status: 404 });

    // BB routing list. Includes BBs with compatible AV stock; excludes those
    // that declined with NC/ND (capacity block).
    //
    // Distance via Haversine (6371 km earth radius). If donor lat/lng not
    // provided, distances come back NULL and sort order falls back to name.
    const bbs = (
      await c.query(
        `WITH declined_out AS (
           SELECT blood_bank_id
             FROM open_request_bb_declines
            WHERE request_id = $1
              AND reason IN ('NC','ND')
              AND expires_at > NOW()
         )
         SELECT DISTINCT i.id AS blood_bank_id,
                i.display_name AS bb_name,
                i.latitude, i.longitude,
                COALESCE(i.address_line, '') AS address,
                CASE
                  WHEN $2::numeric IS NULL OR $3::numeric IS NULL
                    OR i.latitude IS NULL OR i.longitude IS NULL
                  THEN NULL
                  ELSE 6371 * acos(
                    LEAST(1.0, GREATEST(-1.0,
                      cos(radians($2::numeric)) * cos(radians(i.latitude))
                      * cos(radians(i.longitude) - radians($3::numeric))
                      + sin(radians($2::numeric)) * sin(radians(i.latitude))
                    ))
                  )
                END::numeric(6,2) AS distance_km
           FROM blood_inventory bi
           JOIN institutions i ON i.id = bi.blood_bank_id
           JOIN compatibility_matrix cm
             ON cm.component_id = bi.component_id
            AND cm.donor_group_id = bi.blood_group_id
            AND cm.recipient_group_id = $4
            AND cm.is_compatible = TRUE
          WHERE i.district_id = $5
            AND bi.component_id = $6
            AND bi.status = 'AV'
            AND bi.is_recalled = FALSE
            AND bi.expiry_date > CURRENT_DATE
            AND i.id NOT IN (SELECT blood_bank_id FROM declined_out)
       ORDER BY distance_km ASC NULLS LAST, bb_name ASC
          LIMIT 50`,
        [
          alertRow.request_id,
          donorLat,
          donorLng,
          alertRow.patient_blood_group_id,
          alertRow.requesting_hospital_district_id,
          alertRow.component_id,
        ],
      )
    ).rows;

    return { alert: alertRow, blood_bank_options: bbs };
  });
  res.json(result);
});

// ── POST /donor-alerts/:id/accept-with-bb ────────────────────────────────
const acceptSchema = z.object({
  chosen_blood_bank_id: z.string().uuid(),
  donor_lat: z.number().finite().optional(),
  donor_lng: z.number().finite().optional(),
  distance_to_bb_km: z.number().finite().optional(),
  expected_arrival_at: z.string().optional(),
});

router.post('/:id/accept-with-bb', verifyJWT, requireRole('donor'), async (req, res) => {
  const alertId = req.params.id;
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  const data = parsed.data;

  const result = await withRlsContext(
    req,
    async (c) => {
      const me = (
        await c.query(`SELECT id FROM donors WHERE platform_user_id = $1 LIMIT 1`, [
          req.user.userId,
        ])
      ).rows[0];
      if (!me) throw Object.assign(new Error('donor_profile_missing'), { status: 404 });

      const alertRow = (
        await c.query(`SELECT id, request_id FROM donor_alerts WHERE id = $1 AND donor_id = $2`, [
          alertId,
          me.id,
        ])
      ).rows[0];
      if (!alertRow) throw Object.assign(new Error('alert_not_found'), { status: 404 });

      // Update the alert
      await c.query(
        `UPDATE donor_alerts
            SET donor_response = 'YE',
                responded_at = clock_timestamp(),
                arrival_committed_at = clock_timestamp()
          WHERE id = $1`,
        [alertId],
      );

      // Create/update the choice row
      const choice = (
        await c.query(
          `INSERT INTO donor_alert_choices (
             donor_alert_id, donor_id, request_id, chosen_blood_bank_id,
             donor_lat, donor_lng, distance_to_bb_km, expected_arrival_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (donor_id, request_id) DO UPDATE
             SET donor_alert_id = EXCLUDED.donor_alert_id,
                 chosen_blood_bank_id = EXCLUDED.chosen_blood_bank_id,
                 donor_lat = EXCLUDED.donor_lat,
                 donor_lng = EXCLUDED.donor_lng,
                 distance_to_bb_km = EXCLUDED.distance_to_bb_km,
                 expected_arrival_at = EXCLUDED.expected_arrival_at,
                 accepted_at = clock_timestamp(),
                 status = CASE WHEN donor_alert_choices.status IN ('CN','NS')
                              THEN 'PE' ELSE donor_alert_choices.status END,
                 cancelled_at = NULL,
                 cancelled_reason = NULL,
                 deadline_at = clock_timestamp() + INTERVAL '48 hours'
        RETURNING id, chosen_blood_bank_id, deadline_at, status`,
          [
            alertId,
            me.id,
            alertRow.request_id,
            data.chosen_blood_bank_id,
            data.donor_lat ?? null,
            data.donor_lng ?? null,
            data.distance_to_bb_km ?? null,
            data.expected_arrival_at || null,
          ],
        )
      ).rows[0];

      return {
        choice_id: choice.id,
        chosen_bb_id: choice.chosen_blood_bank_id,
        deadline_at: choice.deadline_at,
        status: choice.status,
      };
    },
    { change_reason: 'donor accepts alert + picks BB' },
  );
  res.status(201).json(result);
});

// ── POST /donor-alerts/:id/decline ───────────────────────────────────────
router.post('/:id/decline', verifyJWT, requireRole('donor'), async (req, res) => {
  const alertId = req.params.id;

  await withRlsContext(
    req,
    async (c) => {
      const me = (
        await c.query(`SELECT id FROM donors WHERE platform_user_id = $1 LIMIT 1`, [
          req.user.userId,
        ])
      ).rows[0];
      if (!me) throw Object.assign(new Error('donor_profile_missing'), { status: 404 });

      const row = await c.query(
        `UPDATE donor_alerts
            SET donor_response = 'NO',
                responded_at = clock_timestamp()
          WHERE id = $1 AND donor_id = $2
      RETURNING id`,
        [alertId, me.id],
      );
      if (row.rowCount === 0) {
        throw Object.assign(new Error('alert_not_found'), { status: 404 });
      }

      // If donor previously accepted, cancel the choice
      await c.query(
        `UPDATE donor_alert_choices
            SET status = 'CN',
                cancelled_at = clock_timestamp(),
                cancelled_reason = 'donor_declined_after_accepting'
          WHERE donor_alert_id = $1
            AND donor_id = $2
            AND status IN ('PE', 'AR')`,
        [alertId, me.id],
      );
    },
    { change_reason: 'donor declines alert' },
  );
  res.json({ declined: true });
});

module.exports = router;
