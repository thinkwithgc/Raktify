# Claude / coding-agent instructions

This is a **life-critical** healthcare system. Read this whole file before touching code.

> **Product name:** the platform is **Raktify**. The Postgres GUC namespace is
> `raktify.*` (e.g. `raktify.actor_role`); the Tailwind/CSS design-system prefix
> is `rk-*` / `.rk-*`. Use these consistently — no other brand prefix exists.

## Phase status

| Phase | Status | Smoke test | Notes |
|-------|--------|------------|-------|
| 0 — Infrastructure | ✅ done | `node scripts/smoke_test.js` | commit `1a8ee3e` |
| 1 — DB foundation  | ✅ done (18/18) | `node scripts/smoke_test_phase1_full.js` | 30 migrations, 34 tables, 100 triggers, 71 RLS policies — commit `1a8ee3e` |
| 2 — Auth + onboarding | ✅ done (21/21) | `node scripts/smoke_test_phase2.js` | OTP, TOTP, MoU eSign — commit `c3b758c` |
| 3 — Donor reg + passport | ✅ scaffold (18/18) | `node scripts/smoke_test_phase3.js` | See **Phase 3 handoff** below |
| 4 — Inventory + TTI | ✅ core (17/17) | `node scripts/smoke_test_phase4.js` | See **Phase 4 status** below |
| 5 — Request engine + matching | ✅ core (20/20) | `node scripts/smoke_test_phase5.js` | See **Phase 5 status** below |
| 6 — Notifications + WhatsApp + Lookback | ✅ core (19/19) | `node scripts/smoke_test_phase6.js` | See **Phase 6 status** below |
| 7 — Frontend (React PWA) | ✅ core | `npm run smoke:frontend` (vite build) | See **Phase 7 status** below |
| 8 — Admin + reporting + deploy | ✅ core (code-complete) | `npm run lint && npm run smoke:frontend` | See **Phase 8 status** below |

## Phase 3 handoff (where the scaffold leaves off)

**Working in Phase 3 today:**
- `GET  /donors/eligibility/questions` — returns DRAFT bank
- `POST /donors/register` — web flow, validates, runs duplicate detection, creates donor + platform_user
- `POST /donors/:id/consent` — donor-self only (DB trigger enforces)
- `POST /donors/:id/availability` — donor-self only
- `POST /donors/:id/blood-group/verify` — `blood_bank` role only; writes the only field used in matching
- `GET  /donors/:id/passport` — assembles profile + donations + clearance verdict (no field-level TTI)
- `GET  /donors/me` — convenience self-passport
- `POST /donors/merge` — returns 501 (stubbed)

**TODO before Phase 3 is "done":**
1. **WhatsApp bot registration** (`registration_source='WAB'`) — needs MSG91 DLT templates + bot conversation state machine. Defer to Phase 6 (notifications) since both depend on MSG91.
2. **QR-code camp registration** (`registration_source='QRC'`) — wire `registration_camp_id` → look up camp + pre-fill location. Schema is already there, only the route handler is missing.
3. **Donor merge** (`POST /donors/merge`) — `services/donors/merge.js` documents the design. Blocked on medical-advisor confirmation of deferral merge semantics (worst-case vs strictest deferral_until).
4. **Pre-screening enforcement** — `services/donors/eligibility.js` has the DRAFT bank but `/donors/register` only soft-checks. Wire into the live decline path AFTER medical advisor signs off the question text + temporary deferral days.
5. ~~**Donor mobile re-verification**~~ — ✅ done in `auth.js` POST /auth/otp/verify (Phase 4 batch).

## Phase 4 status (core done, deferrable items remain)

**Working today:**
- `POST /donations` — blood_bank only; runs `validateDonation()` (deferral, gap, Hb/gender, blood-group-verified) before INSERT; trigger creates QA bag.
- `GET  /donations/:id` — full donation+screening+bag join
- `POST /donations/:id/screening` — TTI panel; sets `verification_required=TRUE` when any RR
- `POST /donations/:id/screening/verify` — 4-eyes (different user from `entered_by`); flips clearance to CL or IN; cascades trigger lookback + bag recall
- `GET  /inventory` — bag list, blood_bank-scoped or admin
- `GET  /inventory/availability` — district-scoped counts (hospitals + coordinators see counts, never bag IDs)
- `POST /inventory/:id/recall` — manual recall by blood_bank or admin
- `POST /inventory/opening-stock` — legacy WB stock entry (currently rides on a seed donation; see TODO)

**Deferrable items for Phase 4 wrap-up:**
1. **Synthetic legacy donor** — opening-stock currently piggybacks on the BB's first verified donation_id. A clean implementation creates a per-institution synthetic donor (mobile `+91-LEGACY-<inst>`, hidden from matching, `is_legacy_synthetic` flag). Schema needs a boolean column on donors or a tag on donation_history.
2. **Scheduled jobs** (spec §6 jobs table): `expiry_alert_job`, `auto_expire_job`, `o_negative_conservation`, `stale_reservation_release`, `eligibility_reminder_job`, `planned_request_upgrade`, `dho_alert_job`, `annual_donor_checkup`. Need a cron runner — `node-cron` or external scheduler. Defer to Phase 6 (notifications) since most of these emit notifications.
3. **WhatsApp opening-stock parser** — depends on MSG91 + DLT (Phase 6).
4. **Volunteer-guided screening UI** — Phase 7 (frontend).

## Phase 5 status (core done)

**Working today:**
- `POST /requests`              Tier 1 OH — auto-assigns coordinator, runs matching synchronously, returns matched bag count + fallback flag.
- `POST /requests/guest`        Tier 2 GH — coordinator on behalf of non-onboarded hospital. Same auto-assign + match flow.
- `POST /requests/community`    Tier 3 CR — gated; max URGENT; awaits coordinator verify before donor activation.
- `POST /requests/citizen`      Tier 4 CI — donor self-service. Same gating as Tier 3.
- `POST /requests/:id/match`    Re-trigger match (coordinator/admin). 409 if Tier 3/4 unverified.
- `POST /requests/:id/cancel`   Releases reservations and marks CA.
- `GET  /coordinator/requests`  District-scoped queue, ordered by urgency.
- `POST /coordinator/requests/:id/accept|claim|verify|noshow|close`
- `POST /coordinator/requests/:id/thread` + `GET /coordinator/requests/:id/thread`

**Matching engine (`services/matching`):**
- compatibility lookup pulls allowed donor groups from `compatibility_matrix` (DRAFT until medical advisor signs off — see Phase 1)
- inventory selection: same-group preferred → fallback group → FIFO by expiry
- bag reservation under `RE` status with `reserved_for_request_id`
- donor alert creation when inventory insufficient AND `donor_activation_required=TRUE`
- ring-1 escalation_log row stamped on every match attempt
- the whole orchestrator runs under elevated `system` actor_role so audit_log records the system as the side-effect actor (RLS migration 220/221 permits)

**Escalation engine (`services/escalation`):**
- ring 2/3/4/5 widening logic implemented; the SCHEDULED job that calls escalateRequest() lands in Phase 6 (cron)
- ring 4 DHO contact + ring 5 ngo_admin voice call rely on MSG91 (deferred)

**Deferrable for Phase 5 wrap-up:**
1. **Adjacent-states table** — `services/escalation/index.js` ring 3 currently approximates "adjacent" by union of all active states. Needs a real adjacency table or a polygon-based query for production.
2. **NMC registry check** — Tier 2 GH stores `guest_nmc_check_status='PE'`. Wire async NMC API check in Phase 6.
3. **Distance-based donor sort** — `findActivatableDonors` sorts by reliability_score; spec calls for `ST_Distance` when both donor and hospital have lat/lng. Add when PostGIS is enabled (post-go-live decision).
4. **Hospital-self-service crossmatch flow** — POST /requests/:id/confirm-crossmatch from hospital role (currently bundled into coordinator close).

## Phase 6 status (core done)

**Working today:**
- `GET  /lookback`                       open-cases queue (ngo_admin)
- `GET  /lookback/donor/:donor_id`       all rows for a donor
- `GET  /lookback/:id`                   detail
- `POST /lookback/:id/contact-hospital`  records hospital contact
- `POST /lookback/:id/dho-notify`        records DHO notification (mandatory for HIV/HBsAg)
- `POST /lookback/:id/close`             closure with outcome notes; HIV/HBsAg blocked w/o DHO notify
- `POST /webhooks/msg91/delivery`        delivery-status webhook → updates `notification_log.delivery_status`; `delivery_status='OP'` propagates to `donors.{whatsapp,sms}_opted_in` via the existing trigger
- `POST /webhooks/whatsapp/incoming`     bot dispatcher (registration state machine + BB inventory parser)
- `GET  /admin/jobs`                     list registered scheduler jobs
- `POST /admin/jobs/run`                 super_admin manual trigger

**Notification chokepoint** (`services/notifications/index.js`):
- now persists ONE `notification_log` row per send (real bug fixed mid-Phase-6 — outbox-only previously)
- resolves recipientId (UUID or +91 mobile) to `recipient_donor_id` / `recipient_user_id` / `recipient_institution_id` / `recipient_external_mobile`
- elevates to `system` actor_role for the log INSERT so RLS permits

**Scheduler** (`services/scheduler/`):
- `node-cron` registration; `SCHEDULER_ENABLED=true` to enable in dev (default off so smoke tests don't fight a parallel tick)
- 6 jobs implemented: `auto_expire`, `stale_reservation_release`, `planned_request_upgrade`, `eligibility_reminder`, `escalate_overdue`, `bot_session_cleanup`
- Manual run via `POST /admin/jobs/run` (super_admin) for ops + tests

**WhatsApp bot** (`services/whatsapp/bot.js`):
- registration state machine: IDLE → NAME → DOB → GENDER → VILLAGE → CONSENT → COMPLETE
- BB staff: parses `UPDATE B+ 4 O+ 2` messages (intent only — does not auto-apply WB stock yet; replies with admin link)
- session state in `bot_sessions` table (1h TTL, cleanup job included)

**Migrations added:** 230 (bot_sessions), 240 (RLS allows `system` to SELECT donors+platform_users for delivery routing).

**Deferrable for Phase 6 wrap-up:**
1. **MSG91 provider live wiring** — DLT auth key + templates pending. Console provider works for dev/CI; flipping `NOTIFICATIONS_PROVIDER=msg91` is a one-env change.
2. **Opt-in / DND enforcement** — chokepoint accepts `emergencyOverride` and writes `was_dnd_overridden`, but doesn't yet check `donors.{whatsapp,sms}_opted_in` or DND hours window. Wire when MSG91 lands.
3. **Fallback chain** (WA → SM → CA on Critical) — schema + parent_notification_id column ready; logic deferred.
4. **WhatsApp bot WB inventory auto-apply** — currently logs intent + replies with admin-confirm link. Auto-apply needs the synthetic-legacy-donor work from Phase 4 deferrables.
5. **DHO contact** (ring 4 escalation) — `escalate_overdue` job stamps the row but the WhatsApp+voice send is deferred to MSG91 wiring.
6. **Annual donor checkup** + **expiry alert** + **o_negative conservation** + **dho_alert** jobs — schemas exist, jobs not implemented yet (mostly notification-emitting; defer with MSG91).

## Phase 7 status (core complete — design + WebSocket + S3 upload deferred)

**Stack:** Vite 5 + React 18 + Tailwind 3 + React Query 5 + react-router-dom 6 + axios + zod + vite-plugin-pwa. Plain JS (no TS) to match backend conventions. Run `npm run dev:frontend` (Vite proxy forwards `/auth`, `/donors`, `/coordinator`, `/requests`, etc. to `http://localhost:3000`); `npm run smoke:frontend` compiles a production bundle and emits the service worker (~389 KiB precached).

**Working today:**
- `frontend/src/lib/api.js` — axios client with JWT interceptor; 401 dispatches `rk:auth-expired` and AuthContext clears the token.
- `frontend/src/lib/outbox.js` + `useOutbox.js` — IndexedDB-backed outbox; FIFO replay on `online` event + on hook mount; React Query keys re-invalidated after a successful flush.
- `frontend/src/lib/schemas.js` — shared client Zod schemas mirroring backend `requestSchema`, `donationSchema`, `openingStockSchema`. Hospital + BB forms validate against these before POST and surface field-level errors inline.
- `frontend/src/auth/AuthContext.jsx` + `RequireAuth.jsx` — token persisted in `localStorage` (`bc.jwt`, `bc.role`, `bc.user_id`); guards routes by role.
- `frontend/src/i18n/strings.js` — Marathi (default) / Hindi / English string bank with `useT()` hook + browser-detect + persisted preference (spec §7.1). `tFor` supports `{n}`-style placeholders. Tab labels + outbox banner + role-pick land in MR/HI; deep clinical copy intentionally still English (translation needs medical-advisor review).
- **Donor:** `/login` (mobile → OTP → JWT). `/register` (4-step wizard: pre-screening → details → temporary deferral notice → consent. Chains `POST /donors/register` → `POST /auth/otp/{send,verify}` → `POST /donors/:id/consent` end-to-end). `/donor` (large availability toggle, blood-group badge, next-eligible, donation history). **Availability toggle is offline-capable**: optimistic update + IDB outbox replay on reconnect. A pending-changes banner surfaces the queue and offers a manual Retry.
- **Staff:** `/staff/login` (email + password + TOTP via `POST /auth/institutional/login`).
- **Coordinator:** `/coordinator` (queue, urgency colour-coding, accept, 15s refetch). `/coordinator/requests/:id` (detail panel: clinical card, action bar (accept / claim / verify / re-trigger match / close-with-bag-IDs), cross-role thread with visibility-scope picker; 20s refetch).
- **Hospital:** `/hospital` (2 tabs: **My requests** with `GET /requests/mine` list + per-request **Confirm crossmatch** CTA → `POST /requests/:id/confirm-crossmatch`; **Raise new** form posts `/requests` and validates against `requestSchema` first).
- **Blood bank:** `/bb` (4 tabs).
  - **Inventory** — `GET /inventory` with status filter; expiry colour: >7d green / 2–7d amber / <48h red.
  - **Record donation** — donor mobile lookup (`GET /donors/lookup?mobile=…`, see backend note below) auto-fills donor id + previews verified blood group + deferral state; rest of form validates against `donationSchema` then posts `/donations`.
  - **TTI screening** — opens any donation_id, accordion HIV/HBsAg/HCV/Syphilis/Malaria with NR/RR/PE/ID pills, posts `/donations/:id/screening`; 4-eyes verify button posts `/screening/verify` (backend rejects same-user verify).
  - **Opening stock** — repeating-row form posts `/inventory/opening-stock` (per-row blood_group × component × units × volume). Validates against `openingStockSchema`.

**Backend additions in Phase 7 wrap-up:**
- `GET /donors/lookup?mobile=` (blood_bank, ngo_admin, super_admin) — donor lookup by mobile for BB donation recording. Runs under elevated `system` actor (migration 240 permits) so first-time donors at a new BB are visible; the existing `donors_self` blood_bank policy only sees donors with prior donation_history at this BB. The route only exposes id + name + verified blood group + deferral/eligibility flags — never returns mobile or address.
- `GET /requests/mine` (hospital) — list of the authenticated hospital's own requests (matched BB, coordinator, status, fulfilled/required, crossmatch_confirmed). Declared **before** `GET /:id` so Express doesn't bind `'mine'` to the `:id` param.
- `POST /requests/:id/confirm-crossmatch` (hospital) — sets `crossmatch_confirmed=TRUE` and flips status `FU → CL` if applicable. Hospital-side close (spec §7); coordinator close still owns bag-state writes.

**Deferrable for the next pass:**
1. **WebSocket / Socket.io live queue** (spec §7.10) — coordinator queue + request detail still poll (15s + 20s). Blocked on backend Socket.io server.
2. **Document upload via S3 presigned URL** — pending Phase 8 storage abstraction wire-up; backend route still emits local-disk URLs in dev. Request detail panel surfaces no document UI today.
3. **Blood-bank incoming-request alerts** — "Raise Hand" panel that shows open requests matching this BB's available inventory (spec §7). Needs a new endpoint that joins `blood_requests` against `blood_inventory.blood_bank_id = me`.
4. **Workbox `BackgroundSyncPlugin`** — the IDB outbox replays on `online` + on hook mount, but doesn't yet leverage the SW's BackgroundSync API (which can wake the SW even when no tab is open). Current implementation degrades gracefully — replay just waits until the user reopens the tab.
5. **i18n widening** — clinical copy + form labels in coord/hospital/BB tabs are English. Translate after medical-advisor review of the donor-facing copy lands.
6. **Design pass** — Tailwind utilities only, single brand colour, system font. A Devanagari-friendly font (`Noto Sans Devanagari`), proper type scale, spacing tokens, and motion/microinteractions are intentionally deferred until full screen inventory exists (post Phase 8).

## Phase 8 status (code-complete — AWS infra + external accounts deferred)

**What landed in this pass:**

### Security hardening (`backend/src/app.js` + `middleware/sanitize.js` + `eslint.config.js`)
- **Helmet CSP** tightened: `default-src 'none'; frame-ancestors 'none'`. We're an API, not an HTML server.
- **CORS whitelist** — `FRONTEND_URL` + `ALLOWED_ORIGINS` (comma-separated) only; no wildcard. Origin-less requests (curl, same-origin) still allowed.
- **Global rate limit** — 100 req/IP/min on every route; `/health` exempt. Stacks under the OTP (3/h/mobile) and institutional-login (10/15min/IP) per-route limits already in `routes/auth.js`.
- **`sanitizeInput` middleware** — recursively strips ASCII control chars + script/iframe/object/embed bookends + caps string fields at 8 KiB. Type coercion stays with Zod; SQL escaping stays with parameterised queries.
- **ESLint `no-restricted-syntax`** rule blocks any `c.query(\`... ${userInput} ...\`)`. Five existing dynamic-SQL sites where the interpolation is a Zod-validated whitelist or constant fragment carry justified `eslint-disable-next-line` comments. Two sites (rlsContext, auth lockout interval) were rewritten to use parameter placeholders instead.
- `app.set('trust proxy', 1)` so `req.ip` keys correctly behind ALB.

### Backend admin endpoints (`routes/admin.js`)
- `GET /admin/coordinators?status=pending|active|suspended` — derived from `id_verified_at`, `is_active`, `suspended_at` (no synthetic status column needed).
- `POST /admin/coordinators/:id/verify` — sets `id_verified_at` + `id_verified_by` + flips `is_active=TRUE`.
- `POST /admin/coordinators/:id/suspend` — sets `suspended_at` + clears `is_active`/`on_duty`.
- `GET /admin/duplicates` — pairs from `donors.suspected_duplicate_of` JOIN canonical row.
- `POST /admin/duplicates/:id/clear` — clear false-positive flag.
- `POST /admin/duplicates/:id/merge` — **501** stub. See `services/donors/merge.js` design notes; blocked on medical-advisor sign-off.
- `GET /admin/referrals` — funnel summary (`institution_referrals.funnel_status`) + recent rows + conversion rate (onboarded / total).
- `GET /admin/audit` — filterable read of `audit_log_safe` view (`table_name`, `actor_user_id`, `event_type`, `since`, `until`, `limit`).
- `GET /admin/audit/integrity?limit=N` — pulls last N audit rows in event-time order, recomputes hash chain, reports any breaks. **Requires** `audit_reader` membership to SELECT `audit_log` directly (only `audit_log_safe` is granted today) — currently returns 500 with a clear "audit_read_denied" message until a small grant migration lands.

### Backend DHO + hemovigilance reports (`routes/reports.js`)
- `GET /reports/district/:district_id/summary?month=YYYY-MM` — requests raised/fulfilled/expired, avg response/match seconds, shortages by blood group, donor pool, camps, wastage. Coord/admin only.
- `GET /reports/hemovigilance?month=YYYY-MM` — lookback opened/closed, reactive TTI counts (HIV/HBsAg/HCV/syphilis/malaria/NAT), donation source breakdown. ngo_admin/super_admin only. Adverse-reaction count returns 0 with `note: 'adverse_reaction_table_pending'` (post-launch table).
- `GET /reports/blood-bank/:id/performance?month=YYYY-MM` — inventory accuracy %, fulfilment counts, avg TTI entry latency. BB users restricted to their own institution.
- All reports support `?format=json` (default) and `?format=csv` (RFC4180-quoted, multi-section). PDF generation deferred (needs Puppeteer/wkhtmltopdf).

### Frontend NGO admin dashboard (`/admin`)
- `pages/admin/AdminDashboard.jsx` — tabbed shell, ngo_admin / super_admin only.
- **Coordinators** tab — filter pill bar (Pending / Active / Suspended / All), one-click Verify, Suspend with reason prompt.
- **Duplicates** tab — paired suspected/canonical cards with Clear-flag and Merge buttons (Merge surfaces the 501 message).
- **Referrals** tab — 6-column funnel grid with conversion %, recent referrals table.
- **Lookback** tab — open investigations queue with red highlight for cases >14 days (spec §10).
- **Audit** tab — filter form (table, actor UUID, event type, since/until, limit) + on-demand "Run hash-chain integrity check" button.
- **Jobs** tab — scheduler view with super_admin-only "Run now" button.

### Frontend reports viewer (`/admin/reports`)
- Month picker, three report tabs (district / hemovigilance / BB performance), JSON-driven stat blocks + tables, "Download CSV" button that fetches `?format=csv` with the JWT.
- Linked from the AdminDashboard nav so admins/coordinators don't have to remember the URL.

### Routing + redirects
- `App.jsx` `HomeRedirect` now sends `ngo_admin` / `super_admin` to `/admin`.
- `StaffLogin` routes those roles to `/admin` instead of `/coordinator`.

### Deployment doc (`docs/DEPLOYMENT.md`)
- AWS RDS PostgreSQL recipe (Multi-AZ, KMS at rest, IAM auth, automated backups + PITR).
- EC2 + ALB + ACM backend stack with PM2 cluster mode and CloudWatch wiring.
- S3 + CloudFront frontend hosting with cache headers per asset type.
- Production `.env` template covering all provider switches (`ENCRYPTION_PROVIDER=kms`, `STORAGE_PROVIDER=s3`, `NOTIFICATIONS_PROVIDER=msg91`, `MAIL_PROVIDER=workspace`).
- Monitoring matrix (CloudWatch, Better Uptime, Sentry).
- Security-hardening verification checklist matching the spec §10 items.
- Excerpted go-live checklist; full version stays in the Master Prompt.

**What's deferred (out of scope for code work):**
1. **AWS provisioning** — RDS instance, EC2/ALB, S3 bucket, CloudFront distribution, IAM roles, KMS keys. Pure infra work, no code change. Recipe in `docs/DEPLOYMENT.md`.
2. **External accounts + keys** — MSG91 DLT templates, LeegAlly e-sign, Google Workspace admin, Sentry, Better Uptime / UptimeRobot. Each is a vendor signup with KYC.
3. **PDF generation** for DHO submission — `routes/reports.js` returns CSV; PDF needs Puppeteer or wkhtmltopdf wired into the storage abstraction. CSV is acceptable for hemovigilance interim filings.
4. **`audit_reader` SELECT grant on `audit_log`** for the integrity check — currently the role only has SELECT on `audit_log_safe` (which masks `row_hash` / `previous_row_hash`). One-line migration: `GRANT SELECT (id, event_time, table_name, record_id, row_hash, previous_row_hash) ON audit_log TO audit_reader;`. Endpoint already returns a clear diagnostic 500 in the meantime.
5. **Adverse transfusion reactions table** — referenced in spec §10 hemovigilance; not in the schema yet. Hemovigilance report returns `{ reported: 0, note: 'adverse_reaction_table_pending' }` so the DHO PDF template can render the section.
6. **Merge endpoint** for duplicate donors — still 501; design notes in `services/donors/merge.js`. Blocked on medical-advisor confirmation of deferral merge semantics (worst-case vs strictest `deferral_until`).
7. **WebSocket live queue** + **Workbox BackgroundSync** + **Devanagari design pass** — carried over from Phase 7 deferrables.
8. **Medical-advisor + legal-advisor sign-offs** — clinical reference data still `_DRAFT_PENDING_REVIEW`; MoU template still pending legal review.

## Source of truth
The single, complete spec is `docs/Raktify_Master_Prompt.md`. The 8 phases (0 → 8) are independent specs. **Each phase is meant to be executed in a fresh agent session.** Do not skip phases. Do not invent fields, tables, statuses, or workflow steps that are not in the spec — if you find a gap, surface it; do not paper over it.

## Hard rules

1. **Patient-safety rules live in the database.** CHECK constraints, triggers, and RLS — not application code. Application code has bugs; constraints do not. Never move a clinical rule from a trigger into application logic without explicit user approval.
2. **`audit_log` is INSERT-only.** Only the `audit_writer` Postgres role can write to it. No application role gets UPDATE or DELETE on `audit_log` ever. Do not add an "easy" admin override — there is no override.
3. **Donor PII is masked from hospitals.** Mobile numbers are never returned to the hospital role. All donor↔hospital comms are mediated by the platform.
4. **Self-reported blood group is never used in matching.** `donors.blood_group_self_reported` is display-only with an "Unverified" badge. Only `donors.blood_group_verified` (writable solely by `blood_bank` role) is queried during matching.
5. **Migrations are immutable once applied.** The runner refuses to re-apply a migration whose checksum has changed. To alter a previous migration, write a new one.
6. **Clinical reference data (compatibility matrix, TTI deferrals, component shelf life, eligibility) is `_DRAFT_PENDING_REVIEW` until the haematologist signs off.** Never seed real values from anywhere except the medical advisor's signed document.

## Repository structure

```
backend/src/
  config/          env, logger, db pool
  routes/          Express routers (one file per resource)
  middleware/      auth, RLS-session, error handler
  services/        domain services + provider abstractions
    encryption/    local | kms (swap via ENCRYPTION_PROVIDER env)
    notifications/ console | msg91 (swap via NOTIFICATIONS_PROVIDER env)
    storage/       local | s3 (swap via STORAGE_PROVIDER env)
  utils/           pure helpers

database/
  migrations/      NNN_name.sql, sequential, immutable, with --ROLLBACK comment block
  seeds/           Reference data (immutable; locked via REVOKE after seeding)
  triggers/        One trigger function per file
  rls/             One file per role-table policy bundle

scripts/           Migration runner, LGD importer, RLS test harness
```

## Provider abstractions

External services that aren't yet provisioned are stubbed with **local providers** that satisfy the same contract:

| Service | Local provider | Real provider | Activates when |
|---------|----------------|---------------|----------------|
| Encryption | AES-256-GCM with env key | AWS KMS | `ENCRYPTION_PROVIDER=kms` + `KMS_*_KEY_ARN` set |
| File storage | Local disk under `LOCAL_STORAGE_DIR` | AWS S3 | `STORAGE_PROVIDER=s3` |
| Notifications | JSON files in `LOCAL_OUTBOX_DIR` | MSG91 (DLT-registered) | `NOTIFICATIONS_PROVIDER=msg91` |
| Mail | Console / file outbox | Google Workspace API | `MAIL_PROVIDER=workspace` |

When implementing new features, **always** call the abstraction (`require('../services/encryption')`), never call AWS/MSG91 SDKs directly from a route handler.

## Migration numbering — divergence from spec

The Master Prompt assigns numbers 001–025 to schema migrations. To avoid colliding with already-applied infrastructure migrations on the dev DB, we use the following mapping. **Use spec numbers in conversations and CLAUDE.md references; use the file numbers in the repo.**

| Spec | This repo | Table |
|------|-----------|-------|
| 001 | 001 | geographic |
| 002 | 002 | reference (blood_groups, components, compatibility_matrix) |
| 003 | 003 | platform_users |
| 004 | 004 | institutions |
| 005 | 005 | mou_versions |
| 006 | 006 | coordinators |
| 007 | 007 | communities (+ community_moderators) |
| 008 | 008 | donors |
| 009 | 009 | institution_referrals |
| 010 | **020** | donation_history (010 reserved for grant_helper_roles) |
| 011 | **021** | donor_screening (011 reserved for grant_schema_to_helpers) |
| 012 | **022** | screening_audit_log |
| 013 | **023** | blood_inventory |
| 014 | **024** | thalassemia_patients |
| 015 | **026** | rare_blood_registry |
| 016 | **027** | blood_requests |
| 017 | **028** | request_assignments |
| 018 | **029** | request_documents |
| 019 | **030** | donor_alerts |
| 020 | **031** | escalation_log |
| 021 | **032** | request_threads |
| 022 | **033** | donation_camps |
| 023 | **034** | notification_log |
| 024 | **035** | lookback_registry |
| 025 | 025 | audit_log (placed early so feature triggers can attach via 099) |

Internal-only repo migrations: `010_grant_helper_roles`, `011_grant_schema_to_helpers`, `099_attach_audit_triggers`, `100_rls_phase1`, `200_rls_phase1_extra`. Patches: `210`, `211`, `212`.

## Encryption policy (resolved 2026-05-01)

The spec's `// encrypted` comments on `CHAR` columns are misleading. Decision after design review:

**Hybrid encryption strategy.** Two distinct mechanisms apply to two distinct column-shape categories:

| Column shape | Examples | Mechanism |
|--------------|----------|-----------|
| Fixed-width identifiers (`CHAR(N)`) | `donors.mobile`, `donors.abha_id`, `donors.aadhaar_last4`, all `*_contact_mobile`, `*.guardian_mobile` | Storage-level: AWS RDS + KMS encrypts the volume. Access enforced by RLS + column-level GRANTs. **Plaintext in the column.** |
| Free-text PII (`TEXT`) | `full_name`, `address_line`, `deferral_reason`, `recall_reason`, `donor_screening.*_method`, `donor_screening.notes`, `lookback_registry.hospital_response`, `outcome_notes`, `notification_log.template_variables` (where appropriate), all encrypted-method columns | Column-level: AES-256-GCM via `backend/src/services/encryption`. Ciphertext format `v1:<provider>:<keyKind>:<base64url>`. |

**Why CHAR columns can't be column-encrypted:**
- Lookup by mobile (OTP login, duplicate detection) needs equality match. AES-GCM uses random IVs → same plaintext yields different ciphertexts → no equality match.
- Length: ciphertext is much wider than the original 13/17 chars; widening to `TEXT` would cascade through the entire schema.

**Why two KMS keys (per spec §1.3):**
- `KMS_MAIN_KEY_ARN`: encrypts general PII text fields (name, address, etc.)
- `KMS_SCREENING_KEY_ARN`: encrypts TTI screening data only — every method/notes column on `donor_screening` and any field on `screening_audit_log` whose name implies sensitive content.
- A compromised app server with main-key access cannot read screening data without separately compromising the screening key. The screening API endpoint is the only path that uses the screening provider; everything else must use main.

**What the API code must do:**
- Mobile / ABHA / aadhaar_last4 columns: store plaintext, lookups work.
- TEXT PII columns: pass through `encryption.encrypt(value, { keyKind: 'main' | 'screening' })` before INSERT/UPDATE; pass through `decrypt()` before returning to the client.
- Never log a plaintext or ciphertext PII value. The pino redact list in `backend/src/config/logger.js` already covers known-sensitive paths; extend it when adding fields.

**Hospital-facing API rule (spec §1.2):**
Hospital role NEVER sees donor mobile in API responses, even though it's plaintext in the DB. Mask in the API layer: `+91XXXXX1234` (last 4 only).



## Migration discipline

- One concept per migration. Do not bundle.
- Every migration ends with a commented-out `-- ROLLBACK` block describing how to revert.
- Tables created in earlier migrations may be referenced as foreign keys; the order in `database/migrations/` is the source of truth.
- After seeding immutable reference data (blood groups, components, compatibility matrix), the seed file ends with `REVOKE INSERT, UPDATE, DELETE … FROM app_user`.
- Triggers are defined in `database/triggers/<name>.sql` and `\i`-included from the migration that owns the table.

## Sensitive data handling

- Real secrets only ever live in `.env` (gitignored). Never in code, never in commits, never in logs (logger has redaction rules; extend them when you add new fields).
- Mobile numbers, full names, addresses, ABHA IDs, IP addresses, and TTI results are encrypted at rest. The encryption module returns ciphertext strings prefixed `v1:<provider>:<keyKind>:<payload>`.
- TTI / screening data uses the **separate** `screening` key kind, backed by a different KMS key in production.

## What "done" means for a phase

Each phase has explicit acceptance criteria in the Master Prompt. A phase is complete when:
- Every acceptance criterion ticks
- All migrations apply cleanly to a fresh Neon DB
- Lint + format checks pass
- The relevant integration test or smoke test (per phase) passes
- The phase's RLS policies have been exercised by `scripts/test_rls.sql`
