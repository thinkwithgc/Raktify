# Claude / coding-agent instructions

This is a **life-critical** healthcare system. Read this whole file before touching code.

> **Product name:** the platform is **Raktify**. The Postgres GUC namespace is
> `raktify.*` (e.g. `raktify.actor_role`); the Tailwind/CSS design-system prefix
> is `rk-*` / `.rk-*`. Use these consistently — no other brand prefix exists.

## Where things stand (updated 2026-10-02) — READ THIS FIRST

This section is the resume point: branch state, schema head, the gates, what is
live, and what is genuinely blocked. Trust it over any older section it
contradicts. Post-mortem *reasoning* is deliberately not here — the **Lessons
index** below carries one invariant per lesson and points at the full write-up.

**Branch / deploy.** Working branch `feat/paper-mou-onboarding`; deploy is
`git -c credential.helper='!gh auth git-credential' push origin feat/paper-mou-onboarding:main`
(**two github.com accounts are configured** - if a push 403s with "denied to
gururcp", the wrong one is active: `gh auth switch --hostname github.com --user
thinkwithgc`, and confirm with `gh api repos/thinkwithgc/Raktify --jq .permissions`)
(fast-forward → fans out to CI + `raktify-api` + `raktify-web` **and
auto-applies migrations to prod**). **`git log origin/main..HEAD` is the truth
about what is unshipped** — when it is empty, every commit is in prod, whatever
any paragraph in this file says. `git log --oneline -30` for the history; the ten
most recent, and what each one bought:

| Commit | What |
|---|---|
| `4a84670` | **Related reading between articles, a Knowledge Center section on the home page, and print-ready review packs for the three clinical drafts.** The home page hardcodes three slugs because `build_learn.js` runs *after* `vite build`; the coupling is gated - a draft slug fails the build (proven, exit 1) |
| `d0ec55c` | **`/learn` was an orphan** - `grep -rn '/learn' frontend/src` returned nothing, so Google could only reach it via the sitemap, and reported it "unknown" while `/learn/faq` was indexed the same day. Footer (21 pages) + the `<noscript>` block. Also breadcrumbs on `/help/community-leader` |
| `de11f35` | **Per-route heads, the Knowledge Center, and a real 404.** Every URL used to return byte-identical HTML canonicalised to `/`. Plus `WebSite` JSON-LD, `sameAs`, non-blocking fonts, and the entry chunk 1.09 MB -> 590 kB by splitting at `RequireAuth` |
| `26d32bf` | **Every magic-link route joins the service-worker denylist** — an invitee tapped Activate and got the password field alone, because the handset ran a precached shell older than `a11192b`. Same bug as `7d1def8`, second membership rule: `/setup/` `/activate/` `/consent/` `/camp/` `/alert/`. Confirmed fixed on the invitee's handset after one reload |
| `a1d94b9` | **The post-mortems leave CLAUDE.md** for `docs/Raktify_Engineering_Lessons.md` + `docs/Raktify_Phase_History.md`; this file keeps one invariant each. 2374 → 517 lines. Move, don't lose: 0 dangling anchors, 3 homeless facts written to the doc first |
| `0efa2f1` | The **host institution's own name on the printed QR sheets** — a hospital lending a corridor wall should read as the owner of the sheet. Blank field prints the old sheet exactly; a long name shrinks itself, never the 130mm code |
| `a11192b` | **Staff pick their OWN username at setup** — activation and invitation are one seam. A failed rename must not burn the token, which holds only because those routes run with no open transaction |
| `2a969a4` | The **downloaded poster carries a QR** — an image has no hyperlink, so a forwarded card had no path to RSVP. `?poster=1` is one boolean on the same renderer, composite cache key |
| `7d1def8` | `/c/*` joins the service-worker **navigation-fallback denylist** — a returning handset was running an older build's shell and never reached the function |
| `c2362a4` | A shared camp URL **previews as the camp card**: per-route CORP override, 3-channel PNG, no blank band. None of the three defects was the renderer |

**Schema head.** **99 migration files, latest `320_default_language_english`;
the next new migration is `321`.** Everything `≤320` is immutable (hard rule 5).
319 and 320 are both applied in prod and `/health` answers 200 `db: ok`.
**`npm run migrate:status` is the source of truth — the numbered table in
`docs/Raktify_Phase_History.md` is incomplete.**

**Gates, with their real assertion counts** (the phase table in
**`docs/Raktify_Phase_History.md`** understates two of them):

| Command | Count | Notes |
|---|---|---|
| `npm run smoke:camps` | **156** | The camp gate. Attendance derivation + capacity + `bb_response` + the PII scoping + the branding approval gate + the hard-delete guards + the per-camp OG card. **TWO assertions are dev-state-dependent — see below** |
| `node scripts/smoke_test_phase4.js` | 17 | **Required regression** for anything touching `donation_history` / `donor_screening` |
| `node scripts/smoke_test_phase2.js` | **186** | Institution onboarding / paper MoU / staff-login editing / the two-404 split / the portal's own-name banner |
| `node scripts/check_whatsapp_templates.js` | 0 fail, 1 warn | Every `templateType` in `backend/src` must have a handler **and** an env key |
| `npm run lint && npm run format:check` | — | `format:check` is a hard CI gate in all three workflows, **backend only** |
| `npm run smoke:frontend` | — | Vite build **plus `build_learn.js` and `prerender.js`**. Frontend has no ESLint config, so this is its only gate. **Run from the repo root** |
| `node scripts/smoke_test_phase3/5/6.js` | — | **Do not run.** Pre-268 staff-auth drift; they fail for unrelated reasons |

**`npm run smoke:frontend` carries FOUR build-failing gates that are easy to
delete by accident**, all of them in `frontend/scripts/`. `prerender.js` asserts
seven things per route (canonical injected, no root canonical surviving, exactly
one `<title>` / canonical / description, the build-date stamped, the module script
intact). `build_learn.js` refuses to publish a `clinical: true` article with no
named reviewer (hard rule 6), refuses a `LEARN_FEATURED` slug on the home page
that is not published, and refuses a Related-reading link to an unpublished
article. Each one exists because its failure mode is silent and site-wide.

**`smoke:camps` reports 154/2 on a well-used Neon dev DB and NEITHER failure is a
regression.** Both are freshly-seeded rows sorting off the end of a `LIMIT`ed list
because the dev district is full of previous smoke runs, and the `collectable` one
is **intermittent** - 38 camps tie on both `ORDER BY` keys, so whether the fixture
lands in the first 20 is a coin flip. **Count the competitors; never re-run until
it passes.** Both counts only grow, so both drift *toward* failing. `smoke:camps`
is **not in CI**, so this misleads a developer at the terminal but can never flake
a deploy. Both LIMITs are logged, deliberately not fixed. Measurements and the
counting SQL:
**[smoke:camps' two standing LIMIT failures](docs/Raktify_Engineering_Lessons.md#smokecamps-two-standing-limit-failures)**.

### Deploy skew: the SPA goes live ~1 minute before the API

One push, three workflows, and they do not land together - `raktify-web` finishes
in ~2m30s, `raktify-api` in ~3m30s. **Every release therefore has a ~60-90 second
window where the new SPA runs against the old API**, so a button shipped in that
release calls a route prod does not have yet and the user gets a 404 from the
Express catch-all.

**When a 404 is reported right after a deploy, suspect skew before reading any
handler.** `gh run list --branch main --limit 3` for timings, then probe prod:
`{"error":"missing_token"}` = the route **exists** (not skew);
`route_not_found` = **not deployed yet**; `not_found` = a handler ran and the
**row** is missing; a `route_not_found` that answers 200 minutes later with no
redeploy = the App Service was **restarting**.

**Never give "endpoint missing" and "row missing" the same code again** -
`app.js`'s catch-all answers `route_not_found`, `institutionErrorText` gives the
three cases three distinct sentences, and `smoke_test_phase2.js` section 22
asserts they differ. Full post-mortem, including the day it cost hours:
**[Deploy skew](docs/Raktify_Engineering_Lessons.md#deploy-skew-the-spa-goes-live-1-minute-before-the-api)**.

**Live in prod, code-complete, nothing outstanding:** everything in the phase
table in **`docs/Raktify_Phase_History.md`**, plus per-day BB camp capacity
publishing, per-camp `bb_response` accept/decline, the BB **Camps** tab (calendar
/ requests / brief), the post-camp results worklist, the
`GET /camps/:id/registrations` institution-scoping fix, `<DateOfBirthInput>` and
bounded native date inputs, the server-side logo resize, per-camp OG, and
self-chosen staff usernames (walked by a real invitee on a real handset,
2026-09-09). The camp share path **has been exercised end-to-end in prod**
(2026-09-03, camp `annual-camp-v4x5u`, `status=PL`, `branding_status=AP`).

**Shipped 2026-10-02: the SEO / Knowledge Center batch** (`de11f35`, `d0ec55c`,
`4a84670`). Every URL used to return byte-identical HTML canonicalised to the site
root, so six of ten sitemap URLs described themselves as the home page. Now live
and verified in prod: **per-route heads** (`frontend/scripts/prerender.js`), the
**Knowledge Center at `/learn`** (`frontend/scripts/build_learn.js`, 6 published +
3 clinical drafts), **related reading** between articles, a **home-page Knowledge
Center section**, a real **404 page** replacing the silent redirect to home, the
`sameAs` profile URLs, and the **entry chunk down from 1.09 MB to 590 kB**
(286 to 183 kB gzip) by code-splitting at `RequireAuth`.

Two things that matter more than the feature list. **Search Console reported all
inspected URLs as "Submitted and indexed" even before the fix**, so the duplicate
canonical was costing snippet quality and page identity, not inclusion - do not
repeat the claim that those pages "could not rank". And the **pre-deploy baseline
is unrepeatable**: it is archived in
**`docs/seo/Search_Console_Baseline_2026-10-02.md`** (15 clicks / 150 impressions
over 90 days, and **not one blood-donation query**), which also records that the
real bottleneck is content and backlinks, not plumbing. Head/metadata rationale is
in **`docs/seo/Raktify_Head_And_Metadata.md`**; the `gsc` MCP server setup is in
**`docs/seo/Google_Search_Console_Setup.md`**.

**Blocked on other people, not on code:**
1. **Medical review of the three clinical Knowledge Center articles** -
   `who-can-donate-blood`, `how-often-can-you-donate-blood`,
   `blood-group-compatibility` are written, gated and held at `status: draft`.
   `build_learn.js` **fails the build** if a `clinical: true` article is published
   with no named reviewer (hard rule 6), and no reviewing haematologist is named
   anywhere in the repo. Print-ready review packs with sign-off sheets are in
   **`docs/medical-review/pending/`** (regenerate with
   `node frontend/scripts/build_learn.js --review-pack <dir>`, never hand-edit the
   PDF). The sharpest open question is in `who-can-donate-blood`: **no minimum
   donor weight is stated anywhere in this platform**, so the article prints none.
2. **MR / HI review for the four new camp templates** - the only Meta-side wait
   left on camps, and **it blocks nothing today**. All **24**
   `WHATSAPP_TEMPLATE_*` appsettings are populated on `raktify-api`, the four
   previously-absent camp templates are **APPROVED in `en`**, and every camp send
   site passes `language: 'en'` **explicitly** (`camps.js:1353`, `:2261`, `:2284`,
   `:2454`) - so the `en` approval *is* the whole requirement.
3. **Legal review of the MoU template** - the last sign-off before onboarding
   institutions at scale. Medical sign-off is done (10-Jul-2026).
4. **Manual prod walk-through of the BB-capacity half of the camp lifecycle**,
   which has still never been exercised in prod: host against a full day (blocked,
   alternatives) and against an open day -> accept in the BB tab and confirm the
   organiser's mobile appears only then -> record two donations and enter TTI from
   the worklist without seeing a UUID -> decline after NGO verify and confirm the
   admin sees the reason and the organiser sees the neutral line.

**Deferred by decision (not blocked):** institution-users Stage 2 (staff
capabilities) - starts at migration **321**; `BOT_REPLY` free-form
session-message path (6 sites in `services/whatsapp/bot.js`) - needs a
non-template send, not a template; the **`sameAs` array is live but the home-page
`/learn` cards' Marathi and Hindi copy was written by the agent and wants a native
speaker's eye**; plus the standing list in **Post-Phase-8 deferred items** in
`docs/Raktify_Phase_History.md`.

## Design system — LOCKED (read before touching any visual surface)

Full reference: `docs/Raktify_Design_System.md`. Canonical code:
`frontend/tailwind.config.js`, `frontend/src/index.css`,
`frontend/src/components/Wordmark.jsx`, `frontend/public/icon.svg`.
**Do not introduce new colours, fonts, icon variants, or wordmark treatments
without the founder's explicit sign-off.** Pull tokens from those files; never
invent a value. Repeated design churn = wasted commit/deploy cycles.

- **Accent is `rk-700` = `#b8231a`** (warm red). Palette is the single `rk-50…900`
  scale + `cream #fdf8f4` + `sand #f5ece4`, with warm `stone-*` text on marketing
  surfaces. No blue/green/purple as brand colours — those are status-only
  (green=ok, amber=warning, red=danger).
- **Typography: Inter + Noto Sans Devanagari fallback, ONE family.** No serif, no
  second display font. Weight and size make hierarchy.
- **Wordmark: "Rakt" RED, "ify" BLACK — never reversed, and ALWAYS THE VECTOR.**
  Two sources, byte-identical: `frontend/public/wordmark-tm.svg` (outside React)
  and `frontend/src/components/Wordmark.jsx`. **Never re-type it as text** — not a
  styled `<b>`, not in an email, a doc, an OG image or a print sheet: an
  approximation drifts with whatever font the renderer has, and `docs/*.html` is
  opened **offline at a print shop** where the Google Fonts link fails silently
  and the mark renders in Times.
  - **React → `<Wordmark/>`**, never anything else.
  - **Static HTML → one `<symbol id="rk-wordmark" viewBox="57 107 1185 378">`**
    with the paths copied **verbatim** from `wordmark-tm.svg`, then
    `<svg><use href="#rk-wordmark" /></svg>` at every brand position. Same-document
    `<use>` prints as it screens; an external `<use href="file.svg#id">` does not,
    and nor does an `<img src>` once the file is emailed on. Worked examples:
    `docs/Raktify_QR_Posters.html` (18 positions, one sprite) and
    `docs/medical-review/pending/*.html`.
  - Ratio **1185 × 378 = 3.135 : 1** — size by height and derive the width (16mm
    tall → 50.2mm wide). Cap height lands ≈ 0.58 of the box.
  - **The wordmark stands ALONE.** It already carries the droplet as the `i`
    tittle, so never pair it with the icon square. Do not build a lockup.
  - *(`docs/trademark/`, cited by this file and `Wordmark.jsx`, **does not exist** —
    stale reference, ignore it.)*
- **™, never ® — and the glyph is the whole announcement.** The mark is filed and
  **PENDING**; printing ® is a §107 offence. `<Wordmark tm/>` on public + marketing
  surfaces and the landing hero, not authenticated portal chrome. **"trade mark",
  never "registered".** Never enlarge or restyle the ™ on one surface — that forks
  the mark, which is the defect the rule exists to prevent. A public print artefact
  carries an owner note that is **FINE PRINT, not a claim** (founder, 30-Aug-2026:
  *"dont put trademark notice like we are screamng… even the TM mark give the hint
  that its already trademarked."*): one muted line, the sheet's **last** element,
  below the footer rule, **smaller than the footer** (7pt vs 8.5pt), in `--ink-3`,
  **no ink-black bold on "Raktify™" and no prohibition clause** — *"Raktify™ · a
  trade mark of Choudhari EduHealth India Foundation (application pending)"*. Two
  regressions to avoid: matching the footer's size (it then reads as a peer claim),
  and sitting directly above a footer that already bolds the entity name.
- **Icon (unified 16-Jul-2026): ONE flat brand-red square + white
  wordmark-droplet + red cell-dot**, identical in `icon.svg` + `app-icon.svg`.
  **Flat only** — no gradient/rings/gloss, no letters or monogram. Edit
  `app-icon.svg` then `npm run og:build`; never hand-edit the PNG. Favicons point
  at `/icon.svg`. **`app-icon.png` / `social-avatar.png` keep alpha on purpose; an
  OG card must be 3-channel** — see the lessons index.
- Reuse `.rk-button*` / `.rk-card` / `.rk-input` / `.rk-label` / `.rk-legal` —
  don't restyle from scratch. Shadows `shadow-soft` / `shadow-lift` (warm-tinted).

## Lessons index — one invariant each, full reasoning ON DEMAND

The post-mortems these lines compress live in
**`docs/Raktify_Engineering_Lessons.md`**; phase status and the migration-numbering
table live in **`docs/Raktify_Phase_History.md`**. Both were moved out of this file on
2026-09-08, because this file is loaded into *every* agent session and they are read
perhaps once each. **Anywhere in this file a `See **X**` pointer names one of the titles
below, it means that doc — not a section further down.** Read the invariant here first;
open the doc when you are about to touch the thing it guards.

- **[Marathi i18n — Host a camp + the BB portal](docs/Raktify_Engineering_Lessons.md#marathi-i18n--host-a-camp--the-bb-portal-shipped-2026-08-30-d657d8a)** — `useT()` reads a context (`i18n/LangProvider.jsx`), never per-call-site state; the packs spread into `strings.js` **first** so an existing literal wins a collision. **No Hindi keys in the camp/BB packs, and English clinical terms, are DECISIONS - do not "complete" either.** Month names are pack arrays, never `Intl`.
- **[A blank page is a render throw, and nothing gates it](docs/Raktify_Engineering_Lessons.md#a-blank-page-is-a-render-throw-and-nothing-gates-it-fixed-2026-08-30-b422787)** — A blank SPA page is a **throw**, never a missing i18n key (`tFor` falls back silently). Every component calls `useT()` **itself**; `t` is never inherited from a sibling's scope. The frontend has **no ESLint config** - verify with the throwaway `no-undef` pass, not the Vite build.
- **[OTP delivery failures are reported, not swallowed](docs/Raktify_Engineering_Lessons.md#otp-delivery-failures-are-reported-now-not-swallowed-shipped-2026-08-30-d5f518b)** — Meta has **no pre-check** for whether a number is on WhatsApp, so a rejected send is the only signal: only recipient-side codes (`131026`, legacy `1013`) may mean `no_whatsapp`, `131050` means `opted_out`. **Never widen that set** - an outage would tell a working donor they cannot register. Donor copy goes through `lib/otpError.js`.
- **[A staff portal never knows its own institution](docs/Raktify_Engineering_Lessons.md#a-staff-portal-never-knows-its-own-institution-shipped-2026-08-30-156eee0)** — Self-identity is the session-addressed `GET /institutions/me`, declared **before `GET /:id`** or Express binds `id='me'` and Postgres throws `22P02`. It returns **identity only** (it fires on every portal load). `institutions.kind` is `CHAR(2)` - `'HO'`/`'BB'`, never the long names.
- **[Camp branding — the organiser's own logo + tagline](docs/Raktify_Engineering_Lessons.md#camp-branding--the-organisers-own-logo--tagline-shipped-2026-09-01-19e3ee3)** — The logo is a `data:` URI, not a storage key. `camp_branding_logo` is deliberately **unaudited** and deliberately has **no `id` column** - that absence is a tripwire, do not "fix" it. The public gate is expressed **in SQL** (`CASE WHEN branding_status = 'AP'`), and any organiser edit resets it to `'PE'` in the same UPDATE.
- **[An uploaded camp logo came out BLACK](docs/Raktify_Engineering_Lessons.md#an-uploaded-camp-logo-came-out-black---and-the-fix-was-to-stop-using-the-canvas-2026-09-02)** — The cause was **Firefox blocking canvas readback**, so an **optional client-side conversion must never be able to fail an upload**: the resize lives on the server and the client canvas is best-effort in a bare `try/catch`. **TWO ceilings, never collapse them** - `LOGO_MAX_BYTES` is what is *stored*, `LOGO_UPLOAD_MAX_BYTES` what is *accepted*.
- **[A camp link previewed the GENERIC card, and the share URL cannot move](docs/Raktify_Engineering_Lessons.md#a-camp-link-shared-on-whatsapp-previewed-the-generic-card-and-the-share-url-cannot-move)** — `https://raktify.choudhari.ngo/c/{{1}}` is baked into **nine APPROVED Meta template buttons**, so moving the share origin costs nine templates x three languages and orphans the printed QR posters. Per-camp OG must therefore be served **at the existing SWA origin**.
- **[Per-camp OG is a SWA managed function + a server-rendered PNG](docs/Raktify_Engineering_Lessons.md#per-camp-og-is-a-swa-managed-function--a-server-rendered-png-built-2026-09-03)** — `api_location` is **repository-root-relative** (`frontend/api`, never `"api"`); a wrong value packages no function and **nothing fails anywhere**. `og.png` **never fails to return an image** - a crawler handed a 500 caches the absence for days. Font reachability is read from the **deployed** API, never a local run.
- **[The poster export IS the OG card](docs/Raktify_Engineering_Lessons.md#the-poster-export-is-the-og-card-so-there-is-no-second-renderer-2026-09-03)** — The organiser's download and the crawler's preview are the **same bytes from the same route**, so they can never drift, and there is **no canvas** near it. `<a download>` is ignored for a cross-origin href (fetch to blob, revoke on a **timer**). `POSTER_STATUSES` must mirror the route's own visibility filter, and the poster flag needs a **composite** cache key.
- **[A link-preview image is a CROSS-SITE subresource, and the card must be OPAQUE](docs/Raktify_Engineering_Lessons.md#a-link-preview-image-is-a-cross-site-subresource-and-the-card-must-be-opaque-2026-09-03-c2362a4)** — helmet's `Cross-Origin-Resource-Policy: same-site` is overridden **per-route only**, inside `og.png`'s own `serve()` helper. An OG PNG must be **3-channel**, and the flatten needs an explicit **raw intermediate** when there is a composite. `app-icon.png` / `social-avatar.png` keep alpha on purpose.
- **[A precached SPA shell is a shell from a DIFFERENT BUILD](docs/Raktify_Engineering_Lessons.md#a-precached-spa-shell-is-a-shell-from-a-different-build-2026-09-04)** — **TWO** membership rules for Workbox's `navigateFallbackDenylist`, and it recurred because only the first was known: (1) any path a **managed function rewrites**, or a precache hit never reaches the function; (2) every **one-shot / magic-link entry point** - `/setup/` `/activate/` `/consent/` `/camp/` `/alert/` - because the person arrives from WhatsApp on a device holding an arbitrarily old shell and acts **once**, so a field shipped later is silently absent and often unrecoverable. The static `/learn` tree is on it too, for a stronger reason: it is not a React route, so a shell-answered navigation bounces the reader to the home page. **Adding a new token route means adding it here.** When a shipped element is missing on real devices but present in a private window, suspect the **service worker** before the CSS - and the fix needs **one reload** on an already-broken handset (field-confirmed 2026-09-09).
- **[Staff pick their OWN username at setup](docs/Raktify_Engineering_Lessons.md#staff-pick-their-own-username-at-setup-shipped-2026-09-08-a11192b)** — A failed rename must **not** burn the token - true only because the three public setup routes run on a bare pooled client with **no open transaction**; wrapping them in one silently breaks it. `RESERVED_NAMES` is **exact-match only** or every existing `*_admin` breaks. Refusals are **409 / 409 / 400, never 404 / 410**.
- **[A camp application told NOBODY it needed reviewing](docs/Raktify_Engineering_Lessons.md#a-camp-application-told-nobody-it-needed-reviewing-fixed-2026-09-01)** — `notifyCampReviewPending()` is **fire-and-forget, never awaited** (the organiser's 201 must not wait on Meta), and zero recipients logs `logger.warn` loudly. `platform_users` has **no `is_active` column** - it uses `deactivated_at`. The blood bank's silence at apply is **correct**.
- **[A camp can be hard-deleted, and the audit ledger is what makes that safe](docs/Raktify_Engineering_Lessons.md#a-camp-can-be-hard-deleted-and-the-audit-ledger-is-what-makes-that-safe-shipped-2026-09-02)** — A hard `DELETE` is only ever acceptable on a table `099_attach_audit_triggers.sql` actually audits, because `fn_audit_row()` files **the whole row as JSON** plus the actor and the reason into the INSERT-only ledger. **Check that before allowing one anywhere else.** The `change_reason` is mandatory, and the **four guards must never be widened**.
- **[English is the default language, Marathi is a CHOICE](docs/Raktify_Engineering_Lessons.md#english-is-the-default-language-marathi-is-a-choice-shipped-2026-09-01-migration-320)** — `preferred_language` is the **WhatsApp** language, not the UI language, and a guessed `'mr'` becomes indistinguishable from a chosen one. Existing rows are deliberately **NOT backfilled**. Grep gate: `preferred_language || 'mr'` and `.default('mr')` must both return nothing in `backend/src`.
- **[WhatsApp template pipeline — current state](docs/Raktify_Engineering_Lessons.md#whatsapp-template-pipeline--current-state-aug-2026)** — Three layers fail differently: Meta approval (per **name x language**), the template **name** (a plain App Service **appsetting**), and the Meta credentials (Key Vault, **shared by every template**). An unset `WHATSAPP_TEMPLATE_*` key therefore sends **nothing, silently**, while the `FA` row persists and the job looks healthy. `node scripts/check_whatsapp_templates.js` is the gate and it **cannot see prod**. A body may not **begin or end with a variable**. Chase state through the **Graph API**, never `submit_whatsapp_templates_v2.js`.
- **[V2 WhatsApp templates (July 2026)](docs/Raktify_Engineering_Lessons.md#v2-whatsapp-templates-july-2026--task-77--historical)** — Historical record of the donor-alert-gate template set - which are wired to fire today, which have provider handlers still waiting on a caller.
- **[V2 WhatsApp delivery-status hardening](docs/Raktify_Engineering_Lessons.md#v2-whatsapp-delivery-status-hardening-july-2026--task-79)** — The delivery webhook captures `failure_reason` from Meta's `errors[]` and promotes only code `131050` to `'OP'`; the rest stay `FA` until there is data to widen.

## Pilot scope — Donor + Camp modules only (Aug 2026)

PDMC (blood bank in-charge + Dean) agreed to run the **donor and camp modules
first**, prove the platform's robustness and reliability, and only then switch
blood requests on. Consequences for anyone touching the code:

- The donor-facing **"raise a blood request"** surface is **commented out, not
  deleted**. Four blocks, all carrying the literal marker
  `PILOT SCOPE (Aug 2026)` — grep for it:
  `frontend/src/App.jsx` (the `DonorRaiseRequest` import; the
  `<Route path="/donor/raise">`) and
  `frontend/src/pages/donor/DonorDashboard.jsx` (the `import { Link }`; the
  `<Link to="/donor/raise">` CTA). **Re-enabling is uncommenting those four
  — do not rewrite the feature.**
- `frontend/src/pages/donor/DonorRaiseRequest.jsx` and **`POST /requests/citizen`
  stay live**. Do **not** disable the endpoint: `scripts/smoke_test_phase5.js`
  covers it, and the ask was frontend invisibility only.
- Only the *donor self-service* entry point is hidden. Tier 1/2/3 request paths
  (hospital, coordinator-on-behalf, community) are untouched.
- Read this as a scope decision, not a defect — nothing behind the hidden CTA
  is broken, and the request engine, matcher and escalation ladder are all still
  exercised by their smoke tests.

### Camps: attendance derives itself, and blood banks publish capacity

Every rule, column and trap is in
**[docs/Raktify_Camp_Module.md](docs/Raktify_Camp_Module.md)** - read it before
touching camps. The invariants that must survive without opening it:

- **`camp_registrations.status = 'AT'` is written by a TRIGGER, not a route.** The
  status endpoints reject `'AT'`/`'NS'` with `409 attendance_is_derived`. Settable
  are `RG` (revert), `DF` (came, could not donate) and `CN`. No-show is derived by
  the `camp_close_roster` job.
- **`'DF'` is an attendance fact ONLY** - it must never write
  `donors.deferral_until` or `next_eligible_date`. A roster tap is not a clinical
  gate (hard rule 1). `is_invalidated` does not unwind attendance either.
- **`units_collected` derives from `COUNT(*)`** over the camp's donations; the
  manual field at `complete` only wins when larger.
- **`bb_response` (`PE`/`AC`/`DC`) is an axis ORTHOGONAL to
  `donation_camps.status`**, which gained no value. It never changes `status` and
  never changes what `GET /camps/collectable` returns. A decline neither cancels
  the camp nor clears `partnered_blood_bank_id`.
- **Two unrelated `DC`s:** `status='DC'` = the NGO declined the application;
  `bb_response='DC'` = the blood bank declined to collect.
- **No `bb_camp_capacity` row = NOT PUBLISHED, never closed** - branch on
  `published`, never on `max_camps`. `max_camps = 0` IS the holiday.
- **Overbooking is enforced in `services/camps/capacity.js`, not the DB** - that
  file is the single source of occupancy truth for both the BB calendar and the
  organiser's booking gate.
- **Decline reasons go to the NGO admin, NEVER the organiser.** Organiser name and
  mobile are revealed to the accepting BB only, after `'AC'`.
- **Any table passed to `attach_audit_trigger()` must have a column literally
  named `id`** - `fn_audit_row()` hardcodes `NEW.id`. That is the only reason
  migration 318 exists.
- **Dates in capacity/availability responses are calendar labels** - use
  `to_char(...,'YYYY-MM-DD')`, never a raw `RETURNING scheduled_date`.
- **RLS is inert at runtime, so a handler's own `WHERE` IS the security boundary.**
  The roster PII leak (`GET /camps/:id/registrations`, now `403 not_your_camp`) was
  exactly that.
- **`<DateOfBirthInput>`'s three selects are driven by its OWN `{y,m,d}` state,
  never by the `value` prop** - do not "simplify" that away (shipped broken once,
  fixed `c9a8c85`).
- **Gate: `npm run smoke:camps`.** `smoke_test_phase4.js` is the required
  regression, because 314 adds a trigger to `donation_history`.

## Phase history and migration numbering — MOVED

Phases 0–8 are all code-complete and live on Azure; so is everything in the
post-Phase-8 batch. The per-phase acceptance detail, the per-phase deferrable
lists, the Post-Phase-8 breakdown and the migration-numbering table now live in
**`docs/Raktify_Phase_History.md`** — relocated 2026-09-08 for the same reason as
the lessons above. Three things about it that matter more than the detail itself:

- **`npm run migrate:status` is the source of truth for migrations**, not that
  doc's table and not this file. The table is missing rows 267–309 entirely; it is
  kept for the trap notes it records, never as an inventory. Schema head is
  **320**; the next new migration is **321**.
- **Do not run `node scripts/smoke_test_phase3/5/6.js`** — pre-268 staff-auth
  drift, they fail for unrelated reasons. The gates that must pass are the ones in
  the table near the top of this file.
- The **Post-Phase-8 deferred items** list is in that doc. It is the standing
  backlog, and it is where a "why is this not built yet" question is answered.

## Source of truth
The single, complete spec is `docs/Raktify_Master_Prompt.md`. The 8 phases (0 → 8) are independent specs. **Each phase is meant to be executed in a fresh agent session.** Do not skip phases. Do not invent fields, tables, statuses, or workflow steps that are not in the spec — if you find a gap, surface it; do not paper over it.

## Hard rules

1. **Patient-safety rules live in the database.** CHECK constraints, triggers, and RLS — not application code. Application code has bugs; constraints do not. Never move a clinical rule from a trigger into application logic without explicit user approval.
2. **`audit_log` is INSERT-only.** Only the `audit_writer` Postgres role can write to it. No application role gets UPDATE or DELETE on `audit_log` ever. Do not add an "easy" admin override — there is no override.
3. **Donor PII is masked from hospitals.** Mobile numbers are never returned to the hospital role. All donor↔hospital comms are mediated by the platform.
4. **Self-reported blood group is never used in matching.** `donors.blood_group_self_reported` is display-only with an "Unverified" badge. Only `donors.blood_group_verified` (writable solely by `blood_bank` role) is queried during matching.
5. **Migrations are immutable once applied.** The runner refuses to re-apply a migration whose checksum has changed. To alter a previous migration, write a new one.
6. **Clinical reference data (compatibility matrix, TTI deferrals, component shelf life, eligibility) is now MEDICALLY SIGNED OFF (haematologist, 10-Jul-2026 — see `docs/medical-review/`).** The values live in `002b_seed_blood_components.sql`, `002c_seed_compatibility_matrix.sql`, and `services/donors/eligibility.js`, promoted on the running DB by migration 297. The rule still stands for any FUTURE change: never seed or alter a clinical value from anywhere except the medical advisor's signed document, and record the change in the Q&A doc.

## Repository structure

```
backend/src/
  config/          env, logger, db pool
  routes/          Express routers (one file per resource)
  middleware/      auth, RLS-session, error handler
  services/        domain services + provider abstractions
    encryption/    local (AES-256-GCM; Azure Key Vault crypto provider future work) — swap via ENCRYPTION_PROVIDER
    notifications/ console | msg91 | whatsapp_cloud (Meta Graph API — live primary) — swap via NOTIFICATIONS_PROVIDER
    storage/       local (Azure Blob provider future work) — swap via STORAGE_PROVIDER
    whatsapp/      bot conversation state machine + parsers
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

| Service | Local provider | Live / planned provider | Activates when |
|---------|----------------|---------------|----------------|
| Encryption | AES-256-GCM with env keys (kept in Azure Key Vault, injected as App Service settings) | An Azure Key Vault crypto provider that wraps the key material — future work | `ENCRYPTION_PROVIDER=local` today (only option); a future `azure-kv` value will swap |
| File storage | Local disk under `LOCAL_STORAGE_DIR` | Azure Blob Storage provider — future work | `STORAGE_PROVIDER=local` today; a future `azure-blob` value will swap |
| Notifications | JSON files in `LOCAL_OUTBOX_DIR` | **`whatsapp_cloud` = Meta WhatsApp Business Cloud API direct** (live primary) · `msg91` (SMS / voice fallback — stubbed pending DLT) | `NOTIFICATIONS_PROVIDER=whatsapp_cloud` (live) / `msg91` (fallback) |
| Mail | Console / file outbox | Google Workspace API | `MAIL_PROVIDER=workspace` |

The Master Prompt §1.3 originally specified AWS KMS and AWS S3 for the real-provider column; the May 2026 Azure pivot replaces both with Azure-native equivalents listed above. Implementation of the Azure-native crypto + storage providers is still future work — the `local` providers continue to run on Azure App Service unchanged.

When implementing new features, **always** call the abstraction (`require('../services/encryption')`), never call cloud-provider or notification-vendor SDKs directly from a route handler.

## Encryption policy

Full policy, the column-shape table and the two-key rationale:
**[docs/Raktify_Encryption_Policy.md](docs/Raktify_Encryption_Policy.md)**. The
three rules that must survive without opening it:

- **Fixed-width identifiers (`CHAR(N)`) are PLAINTEXT in the column** -
  `donors.mobile`, `abha_id`, `aadhaar_last4`, every `*_contact_mobile`. AES-GCM
  uses random IVs, so equality lookup (OTP login, duplicate detection) would be
  impossible. Disk encryption + RLS + column GRANTs are the control.
- **Free-text PII (`TEXT`) is column-encrypted** via `services/encryption`,
  format `v1:<provider>:<keyKind>:<base64url>`.
- **TTI / screening data uses the SEPARATE `screening` key kind**, so a server
  holding the main key cannot read screening data. The screening endpoint is the
  only path that uses it.
- **Hospital role NEVER sees donor mobile**, even though it is plaintext in the
  DB - mask in the API layer as `+91XXXXX1234` (hard rule 3).

## Migration discipline

- One concept per migration. Do not bundle.
- Every migration ends with a commented-out `-- ROLLBACK` block describing how to revert.
- Tables created in earlier migrations may be referenced as foreign keys; the order in `database/migrations/` is the source of truth.
- After seeding immutable reference data (blood groups, components, compatibility matrix), the seed file ends with `REVOKE INSERT, UPDATE, DELETE … FROM app_user`.
- Triggers are defined in `database/triggers/<name>.sql` and `\i`-included from the migration that owns the table.

## Sensitive data handling

- Real secrets only ever live in `.env` (gitignored). Never in code, never in commits, never in logs (logger has redaction rules; extend them when you add new fields).
- Mobile numbers, full names, addresses, ABHA IDs, IP addresses, and TTI results are encrypted at rest. The encryption module returns ciphertext strings prefixed `v1:<provider>:<keyKind>:<payload>`.
- TTI / screening data uses the **separate** `screening` key kind, backed by a different encryption key in production (held in Azure Key Vault as `LOCAL_SCREENING_ENCRYPTION_KEY_HEX`).

## What "done" means for a phase

Each phase has explicit acceptance criteria in the Master Prompt. A phase is complete when:
- Every acceptance criterion ticks
- All migrations apply cleanly to a fresh Postgres 16 instance (dev: Neon; prod: `raktify-db` Flexible Server)
- Lint + format checks pass
- The relevant integration test or smoke test (per phase) passes
- The phase's RLS policies have been exercised by `scripts/test_rls.sql`
