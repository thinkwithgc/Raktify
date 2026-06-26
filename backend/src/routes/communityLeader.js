/**
 * Community-leader self-service endpoints.
 *
 *   GET    /community-leader/me                                       — own profile + summary stats
 *   GET    /community-leader/communities                              — my owned + co-led communities
 *   POST   /community-leader/communities                              — create (must include first co-leader)
 *   GET    /community-leader/communities/:id                          — single community detail
 *   POST   /community-leader/communities/:id/co-leaders               — add another co-leader (owner only)
 *   DELETE /community-leader/communities/:id/co-leaders/:moderatorId  — remove (owner only)
 *   GET    /community-leader/leaders/lookup?q=…                       — typeahead for picking co-leaders
 *   GET    /community-leader/communities/:id/donors                   — Phase 3: donor roster (limited PII)
 *   GET    /community-leader/communities/:id/referral                 — Phase 3: shareable URL + QR PNG
 *
 * Phase 4 will add: camp hosting wired to communities, plus per-donor
 * 1:1 mediated messaging (if we keep that scope after re-evaluation).
 */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const QRCode = require('qrcode');

const env = require('../config/env');
const { pool } = require('../config/db');
const logger = require('../config/logger');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { withRlsContext, withRlsContextRaw } = require('../middleware/rlsContext');
const { normaliseIndianMobile } = require('../utils/phone');

const router = express.Router();

// Helper — resolve the calling user's community_leaders.id.
async function resolveLeaderId(userId) {
  const r = await pool.query(
    `SELECT cl.id FROM community_leaders cl WHERE cl.platform_user_id = $1`,
    [userId],
  );
  return r.rowCount === 0 ? null : r.rows[0].id;
}

router.get('/me', verifyJWT, requireRole('community_leader'), async (req, res) => {
  // Pull the profile + the joined geo names + lookup-friendly counters.
  // RLS (migration 272) restricts community_leader to their own row.
  const r = await pool.query(
    `SELECT cl.id, cl.display_name, cl.full_name,
            cl.date_of_birth, cl.gender, cl.preferred_language,
            cl.email, cl.whatsapp_number,
            cl.id_proof_type, cl.id_proof_last4, cl.id_verified_at,
            cl.invitation_notes,
            cl.communities_count, cl.total_donor_count,
            cl.donations_facilitated, cl.camps_hosted,
            cl.joined_at, cl.is_active,
            cl.suspended_at, cl.suspension_reason,
            pu.mobile, pu.last_login_at,
            s.name AS state_name,
            d.name AS district_name
       FROM community_leaders cl
       JOIN platform_users pu ON pu.id = cl.platform_user_id
       LEFT JOIN states    s ON s.id = cl.state_id
       LEFT JOIN districts d ON d.id = cl.district_id
      WHERE cl.platform_user_id = $1`,
    [req.user.userId],
  );

  if (r.rowCount === 0) {
    // The JWT says they're a community_leader but no profile row exists.
    // Should not happen in production (the invite flow inserts both); could
    // happen mid-migration. 404 + clear message helps the user contact admin.
    return res.status(404).json({ error: 'profile_not_found' });
  }

  res.json({ profile: r.rows[0] });
});

// ── GET /community-leader/communities ────────────────────────────────────
// Lists communities owned by the calling leader UNION communities they
// co-lead. RLS in migration 278 ensures the calling actor only sees their
// own; we still scope explicitly so the response payload is predictable.
router.get('/communities', verifyJWT, requireRole('community_leader'), async (req, res) => {
  const leaderId = await resolveLeaderId(req.user.userId);
  if (!leaderId) return res.status(404).json({ error: 'profile_not_found' });

  const r = await withRlsContext(req, (c) =>
    c.query(
      `SELECT co.id, co.name, co.slug, co.description,
              co.is_public, co.is_active,
              co.donor_count, co.active_donor_count, co.donations_facilitated,
              co.wa_bridge_enabled, co.created_at,
              s.name AS state_name,
              d.name AS district_name,
              t.name AS taluka_name,
              (co.owner_community_leader_id = $1) AS is_owner
         FROM communities co
         LEFT JOIN states    s ON s.id = co.state_id
         LEFT JOIN districts d ON d.id = co.district_id
         LEFT JOIN talukas   t ON t.id = co.taluka_id
        WHERE co.owner_community_leader_id = $1
           OR co.id IN (
             SELECT community_id FROM community_moderators
              WHERE community_leader_id = $1
           )
        ORDER BY co.created_at DESC`,
      [leaderId],
    ),
  );
  res.json({ communities: r.rows, count: r.rowCount });
});

// ── POST /community-leader/communities ───────────────────────────────────
// Atomic create: community row + first co-leader (moderator) row in one
// transaction. The deferred constraint trigger from migration 277 fires at
// COMMIT and rolls back if no co-leader was inserted alongside.
const createCommunitySchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  description: z.string().max(2000).optional(),
  state_id: z.number().int().positive(),
  district_id: z.number().int().positive(),
  taluka_id: z.number().int().positive().optional(),
  wa_group_jid: z.string().max(64).optional(),
  wa_group_invite_link: z.string().url().max(500).optional(),
  wa_bridge_enabled: z.boolean().optional(),
  is_public: z.boolean().optional(),
  // The first co-leader is REQUIRED — community can't exist without one.
  co_leader_id: z.string().uuid(),
});

router.post('/communities', verifyJWT, requireRole('community_leader'), async (req, res) => {
  const parsed = createCommunitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  const data = parsed.data;

  const leaderId = await resolveLeaderId(req.user.userId);
  if (!leaderId) return res.status(404).json({ error: 'profile_not_found' });
  if (leaderId === data.co_leader_id) {
    return res.status(400).json({ error: 'owner_cannot_be_own_co_leader' });
  }

  // Verify the chosen co-leader exists + is active.
  const coCheck = await pool.query(
    `SELECT id FROM community_leaders WHERE id = $1 AND is_active = TRUE`,
    [data.co_leader_id],
  );
  if (coCheck.rowCount === 0) {
    return res.status(400).json({ error: 'co_leader_not_found_or_inactive' });
  }

  try {
    const result = await withRlsContext(
      req,
      async (c) => {
        // 1. Insert community (owner = self). Deferred trigger queued — fires at COMMIT.
        const comm = await c.query(
          `INSERT INTO communities
             (owner_community_leader_id, name, slug, description,
              state_id, district_id, taluka_id,
              wa_group_jid, wa_group_invite_link, wa_bridge_enabled,
              is_public)
           VALUES ($1,$2,$3,$4, $5,$6,$7, $8,$9,$10, $11)
           RETURNING id, slug`,
          [
            leaderId,
            data.name,
            data.slug,
            data.description || null,
            data.state_id,
            data.district_id,
            data.taluka_id || null,
            data.wa_group_jid || null,
            data.wa_group_invite_link || null,
            data.wa_bridge_enabled ?? false,
            data.is_public ?? true,
          ],
        );
        const communityId = comm.rows[0].id;

        // 2. Insert co-leader moderator row. Trigger sees this at commit + passes.
        await c.query(
          `INSERT INTO community_moderators (community_id, community_leader_id, added_by)
           VALUES ($1, $2, $3)`,
          [communityId, data.co_leader_id, req.user.userId],
        );
        return { community_id: communityId, slug: comm.rows[0].slug };
      },
      { change_reason: 'create community' },
    );
    res.status(201).json(result);
  } catch (err) {
    if (/unique constraint/i.test(err.message) && /slug/i.test(err.message)) {
      return res.status(409).json({ error: 'slug_taken' });
    }
    if (/community_must_have_co_leader/.test(err.message)) {
      return res.status(400).json({ error: 'community_must_have_co_leader' });
    }
    throw err;
  }
});

// ── PATCH /community-leader/communities/:id ──────────────────────────────
// Owner-only edit. Allowed fields: name, description, state_id, district_id,
// taluka_id. SLUG is intentionally NOT editable — printed posters, WhatsApp
// shares, and bookmarked /community/<slug> URLs would all become dead links
// the moment slug changes; the convenience of fixing one typo isn't worth
// that breakage. If a slug is really wrong, suspend the community and
// create a fresh one.
//
// Permission: only the owner can edit; co-leaders cannot. Enforced by the
// existing RLS communities_cl_update policy (migration 278) which checks
// owner_community_leader_id = self. We don't need extra application-side
// auth here — RLS will return 0 rows if a co-leader tries.
const editCommunitySchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  state_id: z.number().int().positive().optional(),
  district_id: z.number().int().positive().optional(),
  taluka_id: z.number().int().positive().nullable().optional(),
});

router.patch('/communities/:id', verifyJWT, requireRole('community_leader'), async (req, res) => {
  const parsed = editCommunitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
  }
  const data = parsed.data;
  const sets = [];
  const vals = [req.params.id];
  let i = 2;
  for (const k of ['name', 'description', 'state_id', 'district_id', 'taluka_id']) {
    if (Object.prototype.hasOwnProperty.call(data, k)) {
      sets.push(`${k} = $${i}`);
      vals.push(data[k]);
      i += 1;
    }
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }

  const r = await withRlsContext(
    req,
    (c) =>
      c.query(
        // Whitelisted column names assembled above — no user input in the
        // SET clause identifiers. UPDATE returns 0 rows for co-leaders
        // (RLS prevents the row from being matched).
        // eslint-disable-next-line no-restricted-syntax
        `UPDATE communities SET ${sets.join(', ')} WHERE id = $1 RETURNING id, name, description, state_id, district_id, taluka_id`,
        vals,
      ),
    { change_reason: 'edit community' },
  );
  if (r.rowCount === 0) {
    return res.status(404).json({ error: 'not_found_or_not_owner' });
  }
  res.json({ community: r.rows[0] });
});

// ── GET /community-leader/communities/:id ────────────────────────────────
router.get('/communities/:id', verifyJWT, requireRole('community_leader'), async (req, res) => {
  const leaderId = await resolveLeaderId(req.user.userId);
  if (!leaderId) return res.status(404).json({ error: 'profile_not_found' });

  const r = await withRlsContext(req, async (c) => {
    const community = await c.query(
      `SELECT co.id, co.name, co.slug, co.description,
                co.is_public, co.is_active,
                co.donor_count, co.active_donor_count, co.donations_facilitated,
                co.wa_group_jid, co.wa_group_invite_link, co.wa_bridge_enabled,
                co.created_at,
                s.name AS state_name, d.name AS district_name, t.name AS taluka_name,
                co.owner_community_leader_id,
                (co.owner_community_leader_id = $2) AS is_owner
           FROM communities co
           LEFT JOIN states    s ON s.id = co.state_id
           LEFT JOIN districts d ON d.id = co.district_id
           LEFT JOIN talukas   t ON t.id = co.taluka_id
          WHERE co.id = $1`,
      [req.params.id, leaderId],
    );
    if (community.rowCount === 0) return null;

    const moderators = await c.query(
      `SELECT cm.id AS moderator_row_id, cm.community_leader_id, cm.added_at,
                cl.display_name, cl.preferred_language,
                d.name AS district_name
           FROM community_moderators cm
           JOIN community_leaders cl ON cl.id = cm.community_leader_id
           LEFT JOIN districts d ON d.id = cl.district_id
          WHERE cm.community_id = $1
            AND cm.community_leader_id IS NOT NULL
          ORDER BY cm.added_at ASC`,
      [req.params.id],
    );
    return { community: community.rows[0], moderators: moderators.rows };
  });

  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json(r);
});

// ── POST /community-leader/communities/:id/co-leaders ────────────────────
// Owner adds another co-leader to the community. Co-leaders cannot add
// other co-leaders (RLS migration 278 restricts INSERT to owner-only).
router.post(
  '/communities/:id/co-leaders',
  verifyJWT,
  requireRole('community_leader'),
  async (req, res) => {
    const schema = z.object({ co_leader_id: z.string().uuid() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    try {
      const r = await withRlsContext(req, (c) =>
        c.query(
          `INSERT INTO community_moderators (community_id, community_leader_id, added_by)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [req.params.id, parsed.data.co_leader_id, req.user.userId],
        ),
      );
      res.status(201).json({ moderator_row_id: r.rows[0].id });
    } catch (err) {
      if (/idx_community_moderators_unique_leader/.test(err.message)) {
        return res.status(409).json({ error: 'already_a_co_leader' });
      }
      throw err;
    }
  },
);

// ── DELETE /community-leader/communities/:id/co-leaders/:moderatorId ─────
// Owner removes a co-leader. Trigger from mig 277 doesn't block this on
// DELETE-of-last-moderator (TODO Phase 3 if real users hit it). For now,
// the API checks "would this leave 0 moderators?" and refuses.
router.delete(
  '/communities/:id/co-leaders/:moderatorId',
  verifyJWT,
  requireRole('community_leader'),
  async (req, res) => {
    const result = await withRlsContext(req, async (c) => {
      const count = await c.query(
        `SELECT COUNT(*)::int AS n FROM community_moderators WHERE community_id = $1`,
        [req.params.id],
      );
      if (count.rows[0].n <= 1) {
        return { error: 'cannot_remove_last_co_leader' };
      }
      const del = await c.query(
        `DELETE FROM community_moderators
          WHERE id = $1 AND community_id = $2
          RETURNING id`,
        [req.params.moderatorId, req.params.id],
      );
      return del.rowCount === 0 ? { error: 'not_found' } : { ok: true };
    });
    if (result.error) {
      return res.status(result.error === 'not_found' ? 404 : 409).json(result);
    }
    res.json({ status: 'removed' });
  },
);

// ── GET /community-leader/leaders/lookup ─────────────────────────────────
// Typeahead for the co-leader picker. Returns id + display_name + region
// for active leaders matching the query string. Capped at 20 — UI shows a
// "type more to narrow" hint when the list is full.
router.get('/leaders/lookup', verifyJWT, requireRole('community_leader'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ leaders: [] });
  const myId = await resolveLeaderId(req.user.userId);

  // ILIKE on display_name + a join to platform_users.mobile (last-4 match)
  // so the operator can disambiguate by mobile suffix too. Self excluded.
  const r = await pool.query(
    `SELECT cl.id, cl.display_name, d.name AS district_name,
              s.name AS state_name
         FROM community_leaders cl
         JOIN platform_users pu ON pu.id = cl.platform_user_id
         LEFT JOIN districts d ON d.id = cl.district_id
         LEFT JOIN states    s ON s.id = cl.state_id
        WHERE cl.is_active = TRUE
          AND cl.id <> COALESCE($2, '00000000-0000-0000-0000-000000000000'::uuid)
          AND (cl.display_name ILIKE $1 OR pu.mobile LIKE $3)
        ORDER BY cl.display_name
        LIMIT 20`,
    [`%${q}%`, myId, `%${q.slice(-4)}`],
  );
  res.json({ leaders: r.rows });
});

// ── GET /community-leader/communities/:id/donors ────────────────────────
// Roster view — limited fields ONLY. We deliberately do NOT select
// mobile, address_line, abha_id, aadhaar_last4, deferral_reason, or any
// other PII outside the whitelist. RLS (migration 281) already restricts
// to donors whose community_id is in the leader's owned + co-led set;
// this query just enforces the column-level boundary.
//
// Returned per donor:
//   • display_name (full_name)        — needed to know who they are
//   • blood_group_verified / self     — that's the recruitment hook
//   • last_donation_date              — gives the leader a recency signal
//   • is_available                    — currently accepting alerts?
//   • total_donations                 — pride / recognition
//   • created_at                      — when they joined the community
router.get(
  '/communities/:id/donors',
  verifyJWT,
  requireRole('community_leader'),
  async (req, res) => {
    const r = await withRlsContext(req, async (c) => {
      // Verify access to this community (owner or co-leader) — the RLS
      // policy will silently filter anyway, but an explicit 404 is
      // friendlier than an empty list when the id is wrong.
      const access = await c.query(`SELECT 1 FROM communities WHERE id = $1`, [req.params.id]);
      if (access.rowCount === 0) return null;

      // Last donation date is on donation_history. LEFT JOIN + MAX so a
      // donor with zero donations gets NULL not row-dropped.
      const donors = await c.query(
        `SELECT d.id,
                d.full_name AS display_name,
                bg_v.display_name AS blood_group_verified,
                bg_s.display_name AS blood_group_self,
                d.total_donations,
                d.is_available,
                d.created_at,
                (SELECT MAX(dh.donation_date)
                   FROM donation_history dh
                  WHERE dh.donor_id = d.id) AS last_donation_date
           FROM donors d
           LEFT JOIN blood_groups bg_v ON bg_v.id = d.blood_group_verified
           LEFT JOIN blood_groups bg_s ON bg_s.id = d.blood_group_self_reported
          WHERE d.community_id = $1
          ORDER BY d.created_at DESC
          LIMIT 500`,
        [req.params.id],
      );
      return donors.rows;
    });
    if (r === null) return res.status(404).json({ error: 'not_found' });
    res.json({ donors: r, count: r.length });
  },
);

// ── GET /community-leader/communities/:id/referral ───────────────────────
// Returns the shareable URL + a base64-encoded QR PNG. The leader pastes
// the URL in their WhatsApp group OR shows the QR to a prospective donor
// in person.
//
// URL pattern: https://<frontend>/community/<slug>
// The public /community/:slug page leads to /register with attribution
// pre-filled.
router.get(
  '/communities/:id/referral',
  verifyJWT,
  requireRole('community_leader'),
  async (req, res) => {
    const r = await withRlsContext(req, (c) =>
      c.query(`SELECT id, slug, name FROM communities WHERE id = $1`, [req.params.id]),
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    const co = r.rows[0];
    const url = `${env.frontendUrl}/community/${co.slug}`;
    let qrDataUrl = null;
    try {
      qrDataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        scale: 8,
        errorCorrectionLevel: 'M',
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'QR generation failed — returning URL only');
    }
    res.json({
      community_id: co.id,
      slug: co.slug,
      name: co.name,
      url,
      qr_png_data_url: qrDataUrl,
    });
  },
);

// ── Camp hosting wired to communities (Phase 4b) ─────────────────────────
// A leader hosts a camp ATTACHED to one of their owned/co-led communities.
// We create the camp in donation_camps with status='PE' (pending NGO
// coord/admin review) + community_id set so it appears on the community
// detail page + bumps community_leaders.camps_hosted via the trigger from
// migration 284.

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const hostCampSchema = z.object({
  name: z.string().min(2).max(160),
  organiser_type: z.enum(['CC', 'CO', 'EI', 'EO', 'MC', 'OT']).default('CO'),
  organiser_name: z.string().min(2),
  state_id: z.number().int().positive(),
  district_id: z.number().int().positive(),
  taluka_id: z.number().int().positive().optional(),
  venue: z.string().min(2),
  address_line: z.string().min(5),
  pincode: z
    .string()
    .regex(/^[1-9]\d{5}$/)
    .optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  target_donor_count: z.number().int().positive().max(2000).optional(),
  organiser_contact_name: z.string().min(2).optional(),
  organiser_contact_mobile: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/communities/:id/camps',
  verifyJWT,
  requireRole('community_leader'),
  async (req, res) => {
    const parsed = hostCampSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.format() });
    }
    const data = parsed.data;
    const leaderId = await resolveLeaderId(req.user.userId);
    if (!leaderId) return res.status(404).json({ error: 'profile_not_found' });

    // Verify the leader owns or co-leads this community. RLS would also
    // hide the community row from a leader who isn't connected, but the
    // explicit check returns a clear 403 vs a confusing INSERT failure.
    const access = await pool.query(
      `SELECT 1 FROM communities
        WHERE id = $1
          AND (owner_community_leader_id = $2
               OR id IN (SELECT community_id FROM community_moderators WHERE community_leader_id = $2))`,
      [req.params.id, leaderId],
    );
    if (access.rowCount === 0) {
      return res.status(403).json({ error: 'not_owner_or_co_leader' });
    }

    const submitterMobile = data.organiser_contact_mobile
      ? normaliseIndianMobile(data.organiser_contact_mobile)
      : null;
    const slug = `${slugify(data.name)}-${Date.now().toString(36).slice(-5)}`;
    const qrToken = crypto.randomBytes(18).toString('base64url');

    // INSERT uses actor_role='onboarding' to satisfy the existing
    // camp_create RLS policy (which admits onboarding + status='PE');
    // this mirrors how the public /camps/apply route does it. The
    // ownership-of-community check above ensures the caller is
    // actually entitled to create a camp for this community.
    const created = await withRlsContextRaw(
      {
        actor_user_id: req.user.userId,
        actor_role: 'onboarding',
        change_reason: 'community_leader hosts camp',
      },
      async (c) => {
        const r = await c.query(
          `INSERT INTO donation_camps (
             name, slug, qr_code_token, community_id,
             state_id, district_id, taluka_id,
             venue, address_line, pincode,
             scheduled_date, start_time, end_time,
             organiser_type, organiser_name,
             target_donor_count, status,
             submitted_by_name, submitted_by_mobile,
             organiser_contact_name, organiser_contact_mobile,
             review_notes,
             created_by_user_id)
           VALUES (
             $1, $2, $3, $4,
             $5, $6, $7,
             $8, $9, $10,
             $11, $12, $13,
             $14, $15,
             $16, 'PE',
             $17, $18,
             $19, $20,
             $21,
             $22)
           RETURNING id, name, slug, scheduled_date, status`,
          [
            data.name,
            slug,
            qrToken,
            req.params.id,
            data.state_id,
            data.district_id,
            data.taluka_id || null,
            data.venue,
            data.address_line,
            data.pincode || null,
            data.scheduled_date,
            data.start_time,
            data.end_time,
            data.organiser_type,
            data.organiser_name,
            data.target_donor_count || null,
            data.organiser_contact_name || null,
            submitterMobile,
            data.organiser_contact_name || null,
            submitterMobile,
            data.notes || null,
            req.user.userId,
          ],
        );
        return r.rows[0];
      },
      { change_reason: 'community_leader hosts camp' },
    );

    res.status(201).json({
      camp: created,
      next_step:
        'The camp is in PE (pending review). An NGO coordinator will verify and approve it. Once approved (status PL), donors can RSVP via the public camp page.',
    });
  },
);

// ── GET /community-leader/communities/:id/camps ──────────────────────────
// Camps tied to this community, regardless of status (so the leader sees
// PE pending → PL planned → LV live → CO completed lifecycle).
router.get(
  '/communities/:id/camps',
  verifyJWT,
  requireRole('community_leader'),
  async (req, res) => {
    const r = await withRlsContext(req, (c) =>
      c.query(
        `SELECT dc.id, dc.name, dc.slug, dc.scheduled_date,
                dc.start_time, dc.end_time, dc.venue,
                dc.status, dc.registered_donor_count, dc.attended_donor_count,
                dc.units_collected, dc.target_donor_count,
                dc.created_at
           FROM donation_camps dc
          WHERE dc.community_id = $1
          ORDER BY dc.scheduled_date DESC`,
        [req.params.id],
      ),
    );
    res.json({ camps: r.rows, count: r.rowCount });
  },
);

// ── GET /community/:slug (PUBLIC) ────────────────────────────────────────
// Public community profile — visible to anyone. Drives donor recruitment:
// shows community name + region + donor count + owner display name + a
// "Join as a donor" CTA that points to /register?community=<slug>.
//
// PII discipline: nothing here exposes donor mobiles/names. Owner's
// display_name is intentionally shown (the leader chose it as public when
// they signed up).
//
// Mounted under /community-leader for code locality but PUBLIC (no auth
// middleware). The route is a sibling of leader-side endpoints; the
// path prefix differs by an `s`. App-level mounting handles the routing.
const publicRouter = express.Router();
publicRouter.get('/:slug', async (req, res) => {
  // Use a system-actor RLS context so the public page can read communities
  // even though the bearer has no JWT / no actor_user_id.
  const r = await withRlsContext(
    { user: {} },
    (c) =>
      c.query(
        `SELECT co.id, co.slug, co.name, co.description,
              co.donor_count, co.active_donor_count, co.donations_facilitated,
              co.created_at,
              s.name AS state_name,
              d.name AS district_name,
              t.name AS taluka_name,
              cl.display_name AS owner_display_name
         FROM communities co
         LEFT JOIN states    s  ON s.id  = co.state_id
         LEFT JOIN districts d  ON d.id  = co.district_id
         LEFT JOIN talukas   t  ON t.id  = co.taluka_id
         LEFT JOIN community_leaders cl ON cl.id = co.owner_community_leader_id
        WHERE co.slug = $1 AND co.is_public = TRUE AND co.is_active = TRUE`,
        [req.params.slug],
      ),
    { actor_role: 'system', change_reason: 'public community page' },
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ community: r.rows[0] });
});

module.exports = router;
module.exports.publicRouter = publicRouter;
