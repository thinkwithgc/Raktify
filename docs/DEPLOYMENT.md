# Raktify — Production deployment runbook (Azure)

Raktify deploys to **Microsoft Azure**, region **Central India** (Pune — keeps data inside Maharashtra, satisfies data-residency expectations for an Indian health NGO).

> The application code was originally scaffolded against AWS provider names
> (`ENCRYPTION_PROVIDER=kms`, `STORAGE_PROVIDER=s3`). **On Azure those stay on
> the `local` provider** — see §6. The app runs unchanged; Azure-native crypto
> and blob-storage providers are future work, not a launch blocker.

## 0. One-time foundation

| Item | Value |
|---|---|
| Azure subscription | Choudhari EduHealth India Foundation (nonprofit — apply for [Azure for Nonprofits](https://www.microsoft.com/en-us/nonprofits) credits) |
| Resource group | `raktify-prod` |
| Region | `Central India` |
| Naming | `raktify-<resource>-prod` (e.g. `raktify-db-prod`) |

```sh
az group create --name raktify-prod --location centralindia
```

## 1. Database — Azure Database for PostgreSQL Flexible Server

| Setting | Value | Why |
|---|---|---|
| Engine | PostgreSQL 16 | Matches Neon dev — `gen_random_uuid()`, `CITEXT`, JSONB. |
| Tier / size | Burstable **B1ms** (1 vCore, 2 GB) at launch; **B2s** past ~500 donors | Cost-appropriate; scale vertically first. |
| High availability | **Zone-redundant HA enabled** | Life-critical — Azure's equivalent of Multi-AZ. Costs ~2×; no justification to skip. |
| Backups | 7–35 day retention, PITR on; geo-redundant if budget allows | |
| Encryption at rest | On by default (service-managed key); customer-managed key via Key Vault optional | Satisfies the CHAR-column "storage-level encryption" requirement in the encryption policy. |
| Networking | **Private access (VNet integration)** — only the App Service subnet reaches it | No public endpoint. |
| SSL | `require` — append `?sslmode=require` to `DATABASE_URL` | The `pg` pool already enables `rejectUnauthorized` when it sees `sslmode=`. |

```sh
az postgres flexible-server create \
  --resource-group raktify-prod --name raktify-db-prod \
  --location centralindia --tier Burstable --sku-name Standard_B1ms \
  --version 16 --storage-size 32 --high-availability ZoneRedundant \
  --backup-retention 14 --admin-user raktify_admin \
  --admin-password "$(openssl rand -base64 24)"
```

**First-time DB setup** (from a jumpbox in the VNet, or temporarily allow your IP):
1. Create the helper roles the schema expects:
   ```sql
   CREATE USER app_user      LOGIN PASSWORD '<rotated>';
   CREATE USER audit_writer  NOLOGIN;
   CREATE USER audit_reader  NOLOGIN;
   CREATE USER bb_writer     NOLOGIN;
   ```
2. `npm run migrate` against `DATABASE_URL` → verify with `npm run migrate:status` (every migration `applied`).
3. Seed reference data (`database/seeds/`) — the seed step self-revokes write grants on immutable clinical tables.
4. Run `scripts/test_rls.sql` — confirm every role sees only its permitted rows.

**Rollback:** PITR restore to the timestamp before a bad change. Migrations are immutable (CLAUDE.md hard rule §5) — never edit an applied migration; write a new one.

## 2. Backend — Azure App Service (Linux, Node 22)

| Setting | Value |
|---|---|
| Plan | Basic **B1** at launch; **P0v3/P1v3** Premium for autoscale + staging slots later |
| Runtime | Node 22 LTS, Linux |
| Startup command | `node backend/src/server.js` (or `npm --workspace backend start`) |
| Health check path | `/health` — App Service recycles the instance if it fails |
| Always On | Enabled |
| VNet integration | Same VNet as the database |
| Logs | Azure Monitor / Log Analytics workspace |
| Deploy | GitHub Actions via the App Service Deployment Center, or `az webapp deploy` |

```sh
az appservice plan create -g raktify-prod -n raktify-plan --is-linux --sku B1
az webapp create -g raktify-prod -p raktify-plan -n raktify-api-prod \
  --runtime "NODE:22-lts"
az webapp config set -g raktify-prod -n raktify-api-prod \
  --startup-file "node backend/src/server.js"
az webapp config set -g raktify-prod -n raktify-api-prod \
  --generic-configurations '{"healthCheckPath": "/health"}'
```

**App settings** (env vars — set via portal, `az webapp config appsettings set`, or Key Vault references):
```
NODE_ENV=production
PORT=8080                       # App Service Linux expects the app on $PORT
FRONTEND_URL=https://raktify.choudhari.ngo
ALLOWED_ORIGINS=https://raktify.choudhari.ngo
DATABASE_URL=@Microsoft.KeyVault(SecretUri=https://raktify-kv.vault.azure.net/secrets/database-url/)
JWT_SECRET=@Microsoft.KeyVault(SecretUri=.../secrets/jwt-secret/)
JWT_EXPIRES_IN=8h
ENCRYPTION_PROVIDER=local
LOCAL_ENCRYPTION_KEY_HEX=@Microsoft.KeyVault(.../secrets/enc-key/)
LOCAL_SCREENING_ENCRYPTION_KEY_HEX=@Microsoft.KeyVault(.../secrets/screening-key/)
NOTIFICATIONS_PROVIDER=whatsapp_cloud   # primary live channel; 'console' for dev, 'msg91' for the SMS path
STORAGE_PROVIDER=local
MAIL_PROVIDER=console
SCHEDULER_ENABLED=true
OTP_ECHO=false                          # NEVER true in prod — echoes OTP in API response for staging demos

# WhatsApp Business Cloud API (Meta-direct — no BSP, no India DLT).
# Required when NOTIFICATIONS_PROVIDER=whatsapp_cloud.
WHATSAPP_PHONE_NUMBER_ID=@Microsoft.KeyVault(.../secrets/wa-phone-number-id/)
WHATSAPP_ACCESS_TOKEN=@Microsoft.KeyVault(.../secrets/wa-access-token/)
WHATSAPP_WABA_ID=@Microsoft.KeyVault(.../secrets/wa-waba-id/)
WHATSAPP_WEBHOOK_VERIFY_TOKEN=@Microsoft.KeyVault(.../secrets/wa-webhook-verify/)
WHATSAPP_APP_SECRET=@Microsoft.KeyVault(.../secrets/wa-app-secret/)   # verifies X-Hub-Signature-256 on inbound webhooks
WHATSAPP_API_VERSION=v21.0
WHATSAPP_TEMPLATE_OTP=donor_otp
WHATSAPP_TEMPLATE_EMERGENCY=donor_alert_critical
WHATSAPP_TEMPLATE_REMINDER=camp_reminder
WHATSAPP_TEMPLATE_THANKYOU=camp_organizer_link
WHATSAPP_TEMPLATE_CRED=mou_esign_link
```
> **Note:** `server.js` reads `env.port` from `PORT`. App Service Linux injects
> `PORT` (commonly 8080) — the app already honours it.
>
> **WhatsApp delivery prerequisites (Meta-side, not code):** the WABA needs a
> **payment method on file** before any business-initiated template delivers (the
> Graph API returns `accepted` + a `wamid` but Meta silently drops delivery until
> billing is set), and until the WABA matures, sends only reach **allow-listed
> test recipients** (≤5). Business Verification is done (21 May 2026). Set the
> access token to a **System User long-lived token**, not a temporary one — temp
> tokens expire in 24 h. The webhook callback URL in the Meta App dashboard must
> point at `https://api.raktify.choudhari.ngo/webhooks/whatsapp/incoming` with the
> verify token above.

### 2.1 Staging deployment (current reality — May 2026)

Staging is **already live** and differs from the prod recipe above:

| Concern | Staging today | Prod target (this doc) |
|---|---|---|
| Backend | `raktify-api-staging` App Service (Central India) | `raktify-api-prod` |
| Frontend | Azure Static Web Apps `raktify.choudhari.ngo` | `raktify-web-prod` |
| Database | **Neon** (dev/staging DB) | Azure PostgreSQL Flexible Server |
| Deploy trigger | **push to `main`** fires both GitHub Actions automatically | same |

- Workflows: `.github/workflows/main_raktify-api-staging.yml` (backend) and
  `.github/workflows/azure-static-web-apps-jolly-bay-08008c700.yml` (frontend).
  Both trigger **only on push to `main`**. `VITE_API_URL` is baked into the Vite
  build at deploy time (set in the SWA workflow env).
- The working pattern in the Claude worktree is `git push origin <local-branch>:main`
  (fast-forward) — one push fans out to both deploys, frontend in ~2 min, backend
  in ~3–5 min.
- **Migrations + seed are NOT in the workflow.** Run them manually against the
  staging `DATABASE_URL`: `npm run migrate` then (optionally) `node scripts/seed_demo.js --reset`.
- **Azure free-trial credit (~₹18,900) expires 17 Jun 2026; the subscription
  auto-deletes 17 Jul 2026** unless upgraded to Pay-As-You-Go. Cheapest steady
  state: PAYG + App Service F1 + Static Web Apps Free + DB on Neon free tier ≈
  ₹0/mo (Azure managed Postgres has no free tier — keep the DB on Neon or budget
  ~₹1–1.5k/mo for Burstable B1ms). Set a Cost Management budget alert at ₹100/mo.

## 3. Frontend — Azure Static Web Apps

The Vite build is a static bundle with a precached service worker — Static Web Apps is the ideal host (global CDN, free SSL, SPA routing, custom domains).

```sh
az staticwebapp create -g raktify-prod -n raktify-web-prod \
  --location centralindia --sku Standard
```

- **Build config** (GitHub Actions, auto-generated by Static Web Apps):
  - App location: `frontend`
  - Output location: `dist`
  - Build command: `npm run build`
- **Production env:** set `VITE_API_URL=https://api.raktify.choudhari.ngo` as a build-time variable so the SPA calls the API origin directly (CORS on the backend allows it).
- **SPA fallback + cache headers:** `frontend/staticwebapp.config.json` (committed) routes unknown paths to `index.html` and sets cache headers per asset type.

## 4. Secrets — Azure Key Vault

```sh
az keyvault create -g raktify-prod -n raktify-kv --location centralindia
az keyvault secret set --vault-name raktify-kv --name jwt-secret \
  --value "$(openssl rand -hex 64)"
az keyvault secret set --vault-name raktify-kv --name enc-key \
  --value "$(openssl rand -hex 32)"
az keyvault secret set --vault-name raktify-kv --name screening-key \
  --value "$(openssl rand -hex 32)"
# database-url, msg91-auth-key, leegally-api-key … set the same way
```
Grant the App Service's **system-assigned managed identity** `get` on Key Vault secrets so the `@Microsoft.KeyVault(...)` references resolve. Never commit a real `.env`.

## 5. Custom domains & DNS

On the `choudhari.ngo` DNS zone:

| Host | Type | Target |
|---|---|---|
| `raktify.choudhari.ngo` | CNAME | the Static Web App default hostname |
| `api.raktify.choudhari.ngo` | CNAME | the App Service default hostname |

Add each as a custom domain in the respective Azure resource; Azure issues managed TLS certificates for both. `theme-color` and the PWA manifest already carry the Raktify brand.

## 6. Provider-abstraction reality on Azure

| Concern | Launch state | Future work |
|---|---|---|
| Encryption | `ENCRYPTION_PROVIDER=local` — AES-256-GCM, key material held in Key Vault and injected as an app setting. Data is encrypted; you just don't get cloud-managed key rotation. | An Azure Key Vault crypto provider in `services/encryption`. |
| File storage | `STORAGE_PROVIDER=local` — disk on the App Service. Fine for low document volume at launch; not durable across scale-out. | An Azure Blob Storage provider in `services/storage`. |
| Notifications | **`whatsapp_cloud`** is the primary live channel (Meta-direct Cloud API — no BSP, no DLT). `console` for dev/CI; `msg91` is the stubbed SMS path. | Wire MSG91 SMS as the WA→SM→CA fallback chain once DLT registration lands. |
| DB at-rest encryption | Provided by Azure PostgreSQL Flexible Server automatically. | Customer-managed key via Key Vault (optional). |

## 7. Monitoring & alerting

- **Application Insights** — create a resource, set `APPLICATIONINSIGHTS_CONNECTION_STRING` as an app setting. Wire `applicationinsights` in `server.js` (future small task) or use App Service auto-instrumentation.
- **Azure Monitor alerts:** CPU > 80%, memory > 85%, HTTP 5xx spike, DB connections > 80% of max → action group emailing `ops@choudhari.ngo`.
- **Availability test:** Application Insights URL ping test on `/health` every 5 min from multiple regions.
- **Log retention:** Log Analytics workspace, 90 days.

## 8. Security-hardening verification (already in code — verify in prod)

- [ ] `helmet` headers — `curl -I https://api.raktify.choudhari.ngo/health` shows `Content-Security-Policy: default-src 'none'`.
- [ ] CORS — a non-whitelisted origin is rejected (`origin_not_allowed`).
- [ ] Global rate limit — 101 req/IP/min → `429 rate_limit_global`.
- [ ] OTP / login per-route limits fire.
- [ ] `sanitizeInput` strips control chars + script bookends.
- [ ] `npm run lint` passes — the `no-restricted-syntax` rule blocks template-literal SQL.
- [ ] `app_user` cannot UPDATE/DELETE `audit_log`; `/admin/audit/integrity` returns `ok: true`.
- [ ] No secrets committed — Key Vault holds everything sensitive.

## 9. Go-live checklist (excerpt)

The Master Prompt has the full list. Launch blockers:

1. All migrations apply cleanly to a fresh prod DB; `migrate:status` all `applied`.
2. Reference data seeded; compatibility matrix promoted out of `_DRAFT_PENDING_REVIEW` only after haematologist sign-off.
3. RLS smoke (`scripts/test_rls.sql`) green per role.
4. Audit hash chain verified over a 100-row sample.
5. WhatsApp Cloud API: payment method on the WABA, templates approved (donor_otp +
   donor_alert_critical + camp_reminder + camp_organizer_link + mou_esign_link),
   webhook verified, System-User long-lived token in Key Vault, WhatsApp bot tested
   MR/HI/EN. (MSG91 DLT is only needed for the SMS fallback, not launch.)
6. OTP, TOTP, LeegAlly e-sign tested in staging.
7. Scheduled jobs registered (`SCHEDULER_ENABLED=true`).
8. Lookback protocol tested end-to-end (reactive TTI → deferral → recall → lookback rows).
9. Offline emergency fallback sheet delivered to partner hospitals + blood banks.
