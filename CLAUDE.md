# Claude / coding-agent instructions

This is a **life-critical** healthcare system. Read this whole file before touching code.

## Phase status

| Phase | Status | Smoke test | Notes |
|-------|--------|------------|-------|
| 0 — Infrastructure | ✅ done | `node scripts/smoke_test.js` | commit `1a8ee3e` |
| 1 — DB foundation  | ✅ done (18/18) | `node scripts/smoke_test_phase1_full.js` | 30 migrations, 34 tables, 100 triggers, 71 RLS policies — commit `1a8ee3e` |
| 2 — Auth + onboarding | ✅ done (21/21) | `node scripts/smoke_test_phase2.js` | OTP, TOTP, MoU eSign — commit `c3b758c` |
| 3 — Donor reg + passport | 🚧 scaffold (18/18) | `node scripts/smoke_test_phase3.js` | See **Phase 3 handoff** below |
| 4 — Inventory + TTI | pending | | |
| 5 — Request engine + matching | pending | | |
| 6 — Notifications + WhatsApp + Lookback | pending | | |
| 7 — Frontend (React PWA) | pending | | |
| 8 — Admin + reporting + deploy | pending | | |

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
5. **Donor mobile re-verification** — `donors.mobile_verified` is set to FALSE by `register`. The OTP verify path should flip it TRUE on first successful verification of a donor whose donor row exists.

## Source of truth
The single, complete spec is `docs/BloodConnect_Master_Prompt.md`. The 8 phases (0 → 8) are independent specs. **Each phase is meant to be executed in a fresh agent session.** Do not skip phases. Do not invent fields, tables, statuses, or workflow steps that are not in the spec — if you find a gap, surface it; do not paper over it.

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
