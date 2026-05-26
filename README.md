# Raktify

> **A mission-critical operating system for India's bloodstream.**
> _An operating system, not an app._

Life-critical community blood donation and emergency matching platform operated by **Choudhari EduHealth India Foundation**, Amravati, Maharashtra.

> ⚠️ **Life-critical system.** A bug in blood-group matching, eligibility screening, or lookback can kill a patient. All patient-safety-critical rules are enforced at the **database** layer (CHECK constraints, triggers, RLS) — never in application code alone.

The full product specification is `docs/Raktify_Master_Prompt.md`. The build is structured in 8 phases (0 → 8) plus a planned Phase 9 (offline-community onboarding).

**For the 27 May 2026 donor meeting**, three docs:

| Document | Use it for |
|----------|-----------|
| `docs/Raktify_System_Overview.html` | **16-page illustrated narrative** — for partners, hospitals, CSR funders, board members. Cover → problem → system diagram → emergency walk-through → six stakeholder journeys → privacy & safety → technical architecture → roadmap → ask. Open in a browser; print to PDF for sharing. |
| `docs/Raktify_Feature_Reference.md` | Exhaustive technical snapshot of every feature shipped (roles, screens, endpoints, schemas). |
| `docs/Raktify_Demo_Guide.md` | Click-by-click runbook with all test accounts and demo flows. |
| `docs/Raktify_CSR_Budget.html` | Two-year operating budget + aggressive 18-month roadmap (A4 print-ready). |
| `docs/Raktify_DHO_Circular_Template.html` | A4 template for a DHO to circulate to district hospitals + blood banks mandating Raktify adoption. |
| `docs/Raktify_DHO_LoC_Template.html` | 2-page Letter of Cooperation template between a DHO Office and Choudhari EduHealth India Foundation. |
| `docs/DEPLOYMENT.md` | Azure infra recipe + production env matrix. |

**Live staging:** `https://raktify.choudhari.ngo` (frontend) ·
`https://raktify-api-staging-hsdxfzhrg5a7ekes.centralindia-01.azurewebsites.net/health` (backend).

---

## Repository layout

```
/backend           Node.js + Express API
/frontend          React + Vite + Tailwind PWA (donor / coordinator / hospital / blood-bank / admin)
/database
  /migrations      Numbered SQL migrations (sequential, immutable once applied)
  /seeds           Reference data (blood groups, components, compatibility matrix, LGD)
/scripts           Migration runner, LGD importer, RLS test harness, ops utilities
/docs              The Master Prompt, DEPLOYMENT.md, supporting design notes
```

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Database | PostgreSQL — Neon (dev) → Azure Database for PostgreSQL Flexible Server (prod) |
| Backend | Node.js 22 LTS + Express → Azure App Service (Linux) |
| Frontend | React + Vite + Tailwind (mobile-first PWA) → Azure Static Web Apps |
| Auth (donors/coordinators) | Mobile OTP — delivered via WhatsApp Business Cloud API (Meta-direct); MSG91 SMS path stubbed |
| Auth (institutions) | Email + bcrypt + TOTP |
| Secrets | Azure Key Vault |
| File storage | Local disk (dev) — Azure Blob Storage provider is future work |
| Encryption | AES-256-GCM, key in env / Key Vault (`local` provider) |
| Notifications | **WhatsApp Business Cloud API** (Meta-hosted, no BSP/DLT) — primary channel, live. MSG91 (SMS/voice) + local console are the other two providers. |
| Digital MoU | LeegAlly (Aadhaar eSign) |
| Geographic data | LGD (Local Government Directory, Ministry of Panchayati Raj) |

External integrations are abstracted behind provider interfaces (`backend/src/services/{encryption,notifications,storage}`). Dev defaults are local providers; flipping a single env var swaps the backing service. Note: the encryption/storage abstractions currently ship `local` + AWS (`kms`/`s3`) providers — Azure-native providers are future work; on Azure the `local` providers run unchanged.

---

## Local development

### Prerequisites
- Node.js 22 LTS
- A PostgreSQL connection string (Neon dev DB)
- Git Bash or WSL recommended on Windows for shell scripts

### Setup

```bash
# 1. Install all workspace deps
npm install

# 2. Copy env template and fill in values
cp .env.example .env

# 3. Verify DB connectivity + apply pending migrations
npm run migrate:status
npm run migrate

# 4. Run the API + frontend
npm run dev:backend     # → http://localhost:3000/health
npm run dev:frontend    # → http://localhost:5173
```

### Useful scripts

| Command | What it does |
|---------|--------------|
| `npm run dev:backend` | Start backend with `--watch` |
| `npm run dev:frontend` | Start Vite dev server (proxies API to `localhost:3000`) |
| `npm run build:frontend` | Production build of the React PWA → `frontend/dist` |
| `npm run smoke:frontend` | Alias of `build:frontend` — minimum signal that the bundle compiles |
| `npm run lint` / `npm run format` | Static checks |
| `npm run migrate` | Apply all pending migrations |
| `npm run migrate:status` | Show applied / pending / drift |
| `npm run lgd:import` | Seed states/districts/talukas/villages from LGD |

---

## Status

Phases 0–8 **and all post-Phase-8 additions** are code-complete and live on Azure
staging. See `CLAUDE.md` for the per-phase detail (including the **Post-Phase-8
status** section), `docs/Raktify_Feature_Reference.md` for the exhaustive feature
catalogue, and `docs/Raktify_CSR_Budget.html` for the deferred-items roadmap.

| Phase | Status |
|-------|--------|
| 0 — Infrastructure | ✅ |
| 1 — Database foundation | ✅ (46 migrations, latest `266`) |
| 2 — Auth + onboarding | ✅ |
| 3 — Donor registration + passport | ✅ |
| 4 — Inventory + TTI | ✅ |
| 5 — Request engine + matching | ✅ |
| 6 — Notifications + WhatsApp + Lookback | ✅ |
| 7 — Frontend (React PWA) | ✅ (6 role portals + public surfaces) |
| 8 — Admin + reporting + deploy | ✅ (10-tab admin, 3 reports) |
| Post-Phase-8 additions | **Live on Azure staging.** WhatsApp Business Cloud API as the primary notification channel (Meta-direct, no BSP/DLT) · DHO governance role + `/dho` dashboard · Donor tier badges · Camps end-to-end (host → verify → magic-link organizer dashboard → public landing → share toolkit → channel attribution → roster → attendance) · Hospital/blood-bank/coordinator overview dashboards · Institution self-apply onboarding · Thalassemia & rare-blood registries · Public geo lookup · Demo seed (`scripts/seed_demo.js`) · 3-cluster landing nav · `social-avatar` brand asset |
| 9 — Offline-community onboarding | Planned |

**Totals (2026-05-26):** 46 migrations · 104 route handlers across 17 resource routers · 6 frontend role-portals · 3 notification providers (console / MSG91 / WhatsApp Cloud).

### Outstanding external dependencies

| Dependency | Status | Blocks |
|------------|--------|--------|
| Medical advisor sign-off (compatibility matrix, TTI deferrals, eligibility rules) | Pending | Promoting clinical reference data out of `_DRAFT_PENDING_REVIEW` |
| Healthcare lawyer sign-off (MoU template) | Pending | Institution onboarding go-live |
| WhatsApp Cloud API — **payment method on the WABA** | **Pending — live blocker** | Template messages return `accepted` but Meta drops delivery until a card is on file |
| WhatsApp Cloud API — Business Verification | ✅ Done (21 May 2026) | (was blocking test-mode exit / higher tiers) |
| WhatsApp Cloud API — Official Business Account (green tick) | Greyed until WABA maturity + brand notability | Trust badge only; not deliverability |
| Azure account — App Service + Static Web Apps live on staging; PostgreSQL Flexible Server + Key Vault not yet provisioned (staging still on Neon) | In progress | Production DB cutover. Free-trial credit expires 17 Jun 2026; upgrade to PAYG before then |
| Google Workspace for Nonprofits | Blocked on FCRA registration | Institutional email provisioning |
| MSG91 DLT registration + auth key | Pending | SMS fallback channel (WhatsApp Cloud covers primary today) |
| LGD geographic CSV / API access | API endpoint configured; not yet seeded | Donor village search |

---

## License

© Choudhari EduHealth India Foundation. All rights reserved.
