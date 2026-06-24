# Raktify · Azure cutover (staging → production)

Reference scripts + runbook for migrating the live system from the original
`raktify-staging` resource group to a clean production `raktify` resource group.

> **Why we're doing this:** the original Azure resources were named with
> `-staging` suffixes during the build phase. With real institutions about to
> onboard (1 hospital + 2 blood banks committed for end of June 2026), we want
> production-quality naming, isolation, and operational hygiene. The
> alternative (keep "staging" names but treat them as prod, just relabel via
> tags) is documented in [DEPLOYMENT.md §2.3](../DEPLOYMENT.md) as the
> faster-but-cosmetically-impure option.

## Five-day program

| Day | What | Touches old RG? | User-facing impact |
|-----|------|-----------------|--------------------|
| **1** | Provision new `raktify` RG with all resources (parallel to old) | No | None |
| **2** | Migrate schema + reference seeds + Key Vault secrets to new env | No | None |
| **3** | Wire GitHub Actions to new App Service + SWA; bind `raktify.choudhari.ngo` custom domain to new SWA; DNS cutover | No (still old serves until DNS swap) | ~30 min DNS propagation |
| **4** | WhatsApp Cloud payment method · LeegAlly API key wiring · end-to-end test with foundation as test hospital | No | None |
| **5** | Onboard the 3 real institutions (1 hospital + 2 blood banks) | No | First real users live |
| **5+7** | Decommission old `raktify-staging` RG after 7-day soak | Yes — deletes old | None (already cut over) |

## Scripts in this folder

| File | When | What |
|------|------|------|
| `01-create-resources.sh` | Day 1 | Provisions the new `raktify` RG + 6 resources (App Service, Postgres, Key Vault, Static Web App, App Service Plan, all properly tagged). Writes `azure-day1-output.env` (chmod 600, gitignored) with the generated DB password and connection strings. ~20 min runtime. |
| `02-seed-reference.js` | Day 2 | Applies the 3 reference-data seeds (blood_groups, blood_components, compatibility_matrix) — same seeds run during the original Phase 1, just against the new DB. |
| `02-upload-secrets.sh` | Day 2 | Uploads all `WHATSAPP_*`, `JWT_SECRET`, `LOCAL_ENCRYPTION_KEY_HEX`, `LOCAL_SCREENING_ENCRYPTION_KEY_HEX`, `LEEGALLY_*`, `DATABASE_URL` to the new Key Vault (`raktify-kv`). |
| `02-configure-app.sh` | Day 2 | Sets the new App Service's environment variables as `@Microsoft.KeyVault(...)` references pointing at `raktify-kv`. |
| `03-cutover-frontend.sh` | Day 3 | Generates the new GitHub Actions workflow files, configures the SWA deployment token in GitHub secrets, and prepares the DNS cutover instructions. |

(Scripts 02 and 03 will land as subsequent commits — Day 1 first.)

## Prerequisites (one-time, on the machine that runs the scripts)

1. **Azure CLI installed** (`az --version` >= 2.50). Install:
   - Windows: `winget install Microsoft.AzureCLI` or download from <https://aka.ms/installazurecli>
   - macOS: `brew install azure-cli`
   - Linux: `curl -L https://aka.ms/InstallAzureCli | bash`

2. **Logged in to the correct subscription:**
   ```sh
   az login
   az account set --subscription "Pay-As-You-Go"   # or whatever your subscription is named
   az account show --query name -o tsv             # verify
   ```

3. **GitHub CLI installed** (`gh --version`) — needed Day 3 for adding the SWA deploy token as a GitHub Actions secret.

4. **Run from Git Bash on Windows**, or any bash shell on macOS/Linux. The scripts use bash features (`set -euo pipefail`, process substitution, etc.).

## Safety notes

- **Days 1-3 are reversible.** The old `raktify-staging` keeps serving traffic
  until the DNS cutover on Day 3, and even then you can roll back by
  re-pointing the CNAME within DNS TTL (5 min in this setup).
- **Day 5+7 deletes the old RG** — only run that after at least 7 days of
  problem-free operation on the new env.
- **All output files are gitignored.** `azure-day1-output.env` (and any
  `*-output.env`) contain real secrets — keep them on disk only.
- **The Postgres admin password is auto-generated** in `01-create-resources.sh`
  and written to the output file. Treat the output file like an SSH private
  key: 600 perms, machine-local.

## After Day 5: what to delete

```sh
# Verify the new env has been healthy for at least 7 days
curl -fsS https://raktify.choudhari.ngo/health   # frontend
curl -fsS https://raktify-api.azurewebsites.net/health  # new backend

# Confirm no real traffic on the old App Service for the last 24h
az monitor metrics list \
  --resource "/subscriptions/<sub>/resourceGroups/raktify-staging/providers/Microsoft.Web/sites/raktify-api-staging" \
  --metric Requests --interval 1h

# If both are clean, delete the old RG (this is destructive — once it's gone, it's gone)
az group delete --name raktify-staging --yes --no-wait
```
