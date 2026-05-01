# BloodConnect

Life-critical community blood donation and emergency matching platform operated by **Choudhari EduHealth India Foundation**, Amravati, Maharashtra.

> ⚠️ **Life-critical system.** A bug in blood-group matching, eligibility screening, or lookback can kill a patient. All patient-safety-critical rules are enforced at the **database** layer (CHECK constraints, triggers, RLS) — never in application code alone.

The full product specification is `docs/BloodConnect_Master_Prompt.md`. The build is structured in 8 phases (0 → 8). This repository is the implementation of that spec.

---

## Repository layout

```
/backend           Node.js + Express API
/frontend          React web app (scaffold lands in Phase 7)
/database
  /migrations      Numbered SQL migrations (001_…, 002_…, sequential, immutable once applied)
  /seeds           Reference data (blood groups, components, compatibility matrix, LGD)
  /triggers        Trigger functions, one per file
  /rls             Row Level Security policies, one per role/table
/scripts           Migration runner, LGD importer, RLS test harness, ops utilities
/docs              The Master Prompt + supporting design notes
```

---

## Tech stack (non-negotiable)

| Layer | Technology |
|-------|------------|
| Database | PostgreSQL — Neon (dev) → AWS RDS Mumbai (prod) |
| Backend | Node.js 22 LTS + Express |
| Frontend | React + Tailwind (mobile-first PWA) |
| Auth (donors/coordinators) | Mobile OTP via MSG91 |
| Auth (institutions) | Email + bcrypt + TOTP |
| File storage | AWS S3 (Mumbai) — local disk in dev |
| Encryption | AES-256 via AWS KMS — local key in dev |
| Notifications | MSG91 (WhatsApp Business + SMS + voice) |
| Digital MoU | LeegAlly (Aadhaar eSign) |
| Geographic data | LGD (Local Government Directory, Ministry of Panchayati Raj) |

External integrations are abstracted behind provider interfaces (`backend/src/services/{encryption,notifications,storage}`). Dev defaults are local providers; flipping a single env var swaps to the real backing service at go-live without code changes.

---

## Local development

### Prerequisites
- Node.js 22 LTS
- A PostgreSQL connection string (Neon dev DB is preconfigured in `.env`)
- Git Bash or WSL recommended on Windows for shell scripts

### Setup

```bash
# 1. Install all workspace deps (root + backend)
npm install
npm --workspace backend install

# 2. Copy env template if you don't have a .env yet
cp .env.example .env       # fill in values

# 3. Verify DB connectivity + apply pending migrations
npm run migrate:status
npm run migrate

# 4. Run the API
npm run dev:backend
# → http://localhost:3000/health
```

### Useful scripts

| Command | What it does |
|---------|--------------|
| `npm run dev:backend` | Start backend with `--watch` |
| `npm run lint` / `npm run format` | Static checks |
| `npm run migrate` | Apply all pending migrations |
| `npm run migrate:status` | Show applied / pending / drift |
| `npm run migrate:dry` | Parse migrations without executing (CI-safe) |
| `npm run lgd:import` | Seed states/districts/talukas/villages from LGD |

---

## Status (live)

- **Phase 0** — Infrastructure scaffold ✅
- **Phase 1** — Database foundation 🚧 (in progress)
- **Phase 2-8** — Pending

### Outstanding external dependencies

| Dependency | Status | Blocks |
|------------|--------|--------|
| Medical advisor sign-off (compatibility matrix, TTI deferrals, eligibility rules) | Pending | Phase 1 seed promotion to PROD |
| Healthcare lawyer sign-off (MoU template, liability clauses) | Pending | Phase 2 onboarding go-live |
| AWS account (Mumbai) — RDS, S3, KMS | Deferred to go-live | Production deploy |
| Google Workspace for Nonprofits | Blocked on FCRA registration | Institutional email provisioning |
| MSG91 DLT registration + auth key | Pending | Live OTP / WhatsApp |
| LGD geographic CSV / API access | API endpoint configured; not yet seeded | Donor village search |

---

## License

© Choudhari EduHealth India Foundation. All rights reserved.
