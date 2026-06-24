#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Raktify · Azure cutover · Day 1 — provision the production environment
# ─────────────────────────────────────────────────────────────────────────────
#
# Creates a NEW resource group `raktify` (Central India) with the production
# infrastructure ALONGSIDE the existing `raktify-staging` RG. The current
# staging resources continue serving traffic on raktify.choudhari.ngo
# throughout Days 1-2; the DNS/workflow cutover happens on Day 3.
#
# What this script creates (estimated cost steady-state: ~₹3,000/mo):
#   1. Resource group    : raktify           (Central India)
#   2. App Service Plan  : raktify-plan      (Linux, B1)
#   3. App Service       : raktify-api       (Node 22, Always-On, /health probe)
#   4. Postgres Flex Srv : raktify-db        (Burstable B1ms, 32 GB, 14-day PITR)
#   5. Key Vault         : raktify-kv        (Standard, RBAC mode)
#   6. Static Web App    : raktify-web       (Free tier, no GitHub link yet)
#
# Tags applied to every resource:
#   environment=production, project=raktify,
#   owner=choudhari-eduhealth-foundation, cost-center=raktify,
#   managed-by=manual, created=<today>
#
# What this script DOES NOT do (intentionally):
#   • Does NOT touch the old `raktify-staging` RG
#   • Does NOT configure App Service env vars (Day 2, after secrets are in KV)
#   • Does NOT wire GitHub Actions (Day 3)
#   • Does NOT bind raktify.choudhari.ngo to the new SWA (Day 3, after testing)
#   • Does NOT migrate the DB or seed data (Day 2)
#
# Prerequisites:
#   • Azure CLI installed (`az --version` >= 2.50)
#   • Logged in: `az login`
#   • Subscription set: `az account set --subscription "<your subscription>"`
#   • Run from Git Bash on Windows, or any bash shell on macOS/Linux
#
# Outputs:
#   • All resources in subscription
#   • azure-day1-output.env in the current directory (chmod 600) — contains
#     the generated Postgres password + connection strings + SWA deploy token.
#     This file is gitignored. NEVER commit it.
#
# Runtime: ~20 minutes (Postgres provisioning is the long pole, ~10 min)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ==== CONFIG ════════════════════════════════════════════════════════════════
REGION="centralindia"        # All resources except Static Web Apps land here
SWA_REGION="eastasia"        # SWA isn't available in Central India; East Asia is the
                             # closest SWA region (the current raktify-web-staging is here too)
NEW_RG="raktify"
OLD_RG="raktify-staging"   # For reference; NOT touched today

PLAN_NAME="raktify-plan"
APP_NAME="raktify-api"
DB_NAME="raktify-db"
DB_ADMIN_USER="raktify_admin"
KV_NAME="raktify-kv"
SWA_NAME="raktify-web"
APP_DB_NAME="raktify"      # The application database inside the Postgres server

OUTPUT_FILE="./azure-day1-output.env"

# Auto-generated Postgres admin password (written to OUTPUT_FILE for retrieval)
DB_PASSWORD="$(openssl rand -base64 36 | tr -d '/+=\n' | head -c 32)"

# Tags applied to every resource (Azure flattens these into the resource metadata)
TODAY="$(date -u +%Y-%m-%d)"
TAGS_KV=(
  "environment=production"
  "project=raktify"
  "owner=choudhari-eduhealth-foundation"
  "cost-center=raktify"
  "managed-by=manual"
  "created=$TODAY"
)

# ==== HELPERS ══════════════════════════════════════════════════════════════
log()   { printf '\n\033[1;36m▸\033[0m %s\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
fail()  { printf '\n\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
hr()    { printf '%s\n' '════════════════════════════════════════════════════════════════'; }

# ==== PRE-FLIGHT ════════════════════════════════════════════════════════════
hr
echo " Raktify · Azure Cutover · Day 1"
hr

# Az CLI sanity
command -v az >/dev/null || fail "azure-cli not installed. https://aka.ms/installazurecli"
AZ_VERSION="$(az --version | head -1 | awk '{print $2}')"
echo "  Azure CLI: $AZ_VERSION"

# Subscription
SUBSCRIPTION="$(az account show --query name -o tsv 2>/dev/null || echo '')"
[[ -z "$SUBSCRIPTION" ]] && fail "Not logged in. Run: az login"
SUB_ID="$(az account show --query id -o tsv)"
echo "  Subscription : $SUBSCRIPTION ($SUB_ID)"
echo "  Region       : $REGION"
echo "  New RG       : $NEW_RG  (old: $OLD_RG, untouched)"
echo "  Today        : $TODAY"

# Get your public IP — needed to allow-list on Postgres firewall for initial
# migration step (Day 2). Without this, you can't connect from your laptop.
MY_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || echo '')"
[[ -z "$MY_IP" ]] && fail "Could not detect your public IP. Set MY_IP=<your-ip> before re-running."
echo "  Your public IP: $MY_IP (will be allow-listed on Postgres firewall)"

echo ""
read -p "Proceed? [y/N] " -n 1 -r REPLY; echo
[[ ! $REPLY =~ ^[Yy]$ ]] && { echo "Aborted."; exit 1; }

# ==== RESOURCE PROVIDERS ═══════════════════════════════════════════════════
# Newly-upgraded PAYG subscriptions often have providers UNREGISTERED.
# First request to an unregistered provider fails with MissingSubscriptionRegistration.
# Register everything we'll touch up-front — idempotent + fast if already done.
log "Registering required resource providers (idempotent)..."
for provider in Microsoft.Web Microsoft.DBforPostgreSQL Microsoft.KeyVault Microsoft.Storage Microsoft.Insights Microsoft.OperationalInsights; do
  STATE=$(az provider show --namespace "$provider" --query registrationState -o tsv 2>/dev/null || echo "NotRegistered")
  if [[ "$STATE" == "Registered" ]]; then
    ok "$provider already registered"
  else
    echo "    Registering $provider (current: $STATE)..."
    az provider register --namespace "$provider" --wait --only-show-errors
    ok "$provider registered"
  fi
done

# ==== NAME AVAILABILITY ════════════════════════════════════════════════════
log "Checking global name availability for globally-unique resources..."

# App Service name (DNS: *.azurewebsites.net)
AVAIL=$(az webapp list --query "[?name=='$APP_NAME'] | length(@)" -o tsv)
[[ "$AVAIL" != "0" ]] && warn "$APP_NAME may exist (in your subscription)" || ok "$APP_NAME available"

# Postgres server name (DNS: *.postgres.database.azure.com) — no direct check,
# server creation will fail with "name already exists" if globally taken
ok "$DB_NAME — will be validated at creation"

# Key Vault name (DNS: *.vault.azure.net)
KV_AVAIL=$(az keyvault check-name --name "$KV_NAME" --query "nameAvailable" -o tsv 2>/dev/null || echo "unknown")
if [[ "$KV_AVAIL" == "true" ]]; then
  ok "$KV_NAME available"
elif [[ "$KV_AVAIL" == "false" ]]; then
  fail "Key Vault name '$KV_NAME' is taken globally. Try '$KV_NAME-mh' or '$KV_NAME-ceif'."
else
  warn "Could not check $KV_NAME availability — will discover at creation"
fi

# Static Web App — no precheck API; assume OK
ok "$SWA_NAME — will be validated at creation"

# ==== STEP 1/6: RESOURCE GROUP ═════════════════════════════════════════════
log "1/6  Creating resource group '$NEW_RG' in $REGION"
az group create \
  --name "$NEW_RG" \
  --location "$REGION" \
  --tags "${TAGS_KV[@]}" \
  --only-show-errors -o table
ok "Resource group ready"

# ==== STEP 2/6: POSTGRES (background, takes ~10 min) ════════════════════════
log "2/6  Provisioning Postgres '$DB_NAME' (background — ~10 min)..."
echo "       SKU: Standard_B1ms · 1 vCore · 2 GB · 32 GB storage · v16"
echo "       Backup retention: 14 days · HA: disabled · auto-grow: enabled"
# Note: --high-availability is NOT a valid arg at create time in CLI 2.87.0+
# (HA is configured post-create; default is Disabled which is what we want).
az postgres flexible-server create \
  --resource-group "$NEW_RG" \
  --name "$DB_NAME" \
  --location "$REGION" \
  --admin-user "$DB_ADMIN_USER" \
  --admin-password "$DB_PASSWORD" \
  --sku-name "Standard_B1ms" \
  --tier "Burstable" \
  --version 16 \
  --storage-size 32 \
  --storage-auto-grow Enabled \
  --backup-retention 14 \
  --public-access "$MY_IP" \
  --tags "${TAGS_KV[@]}" \
  --yes \
  --only-show-errors \
  > /tmp/raktify-pg-create.log 2>&1 &
PG_PID=$!
echo "       Postgres provisioning PID: $PG_PID (log: /tmp/raktify-pg-create.log)"

# ==== STEP 3/6: APP SERVICE PLAN ═══════════════════════════════════════════
log "3/6  Creating App Service Plan '$PLAN_NAME' (Linux B1)"
az appservice plan create \
  --name "$PLAN_NAME" \
  --resource-group "$NEW_RG" \
  --is-linux \
  --sku B1 \
  --location "$REGION" \
  --tags "${TAGS_KV[@]}" \
  --only-show-errors -o table
ok "App Service Plan ready"

# ==== STEP 4/6: APP SERVICE ════════════════════════════════════════════════
log "4/6  Creating App Service '$APP_NAME' (Node 22, Linux)"
az webapp create \
  --resource-group "$NEW_RG" \
  --plan "$PLAN_NAME" \
  --name "$APP_NAME" \
  --runtime "NODE:22-lts" \
  --tags "${TAGS_KV[@]}" \
  --only-show-errors -o table

# HTTPS-only, TLS 1.2 min, FTP disabled, HTTP/2 on
az webapp update \
  --resource-group "$NEW_RG" \
  --name "$APP_NAME" \
  --https-only true \
  --only-show-errors > /dev/null
az webapp config set \
  --resource-group "$NEW_RG" \
  --name "$APP_NAME" \
  --always-on true \
  --http20-enabled true \
  --min-tls-version 1.2 \
  --ftps-state Disabled \
  --startup-file "node backend/src/server.js" \
  --only-show-errors > /dev/null

# Health-check path (App Service auto-recycles instance if /health fails)
az webapp config set \
  --resource-group "$NEW_RG" \
  --name "$APP_NAME" \
  --generic-configurations '{"healthCheckPath": "/health"}' \
  --only-show-errors > /dev/null

# Initial PORT setting (App Service Linux injects PORT; backend reads from env.port)
az webapp config appsettings set \
  --resource-group "$NEW_RG" \
  --name "$APP_NAME" \
  --settings "WEBSITES_PORT=8080" \
  --only-show-errors > /dev/null

# Assign system-managed identity (used to read secrets from Key Vault)
APP_PRINCIPAL_ID="$(az webapp identity assign \
  --resource-group "$NEW_RG" \
  --name "$APP_NAME" \
  --query principalId -o tsv)"
ok "App Service ready (managed identity: $APP_PRINCIPAL_ID)"

# ==== STEP 5/6: KEY VAULT ══════════════════════════════════════════════════
log "5/6  Creating Key Vault '$KV_NAME' (Standard, RBAC mode, 90-day retention)"
az keyvault create \
  --name "$KV_NAME" \
  --resource-group "$NEW_RG" \
  --location "$REGION" \
  --enable-rbac-authorization true \
  --retention-days 90 \
  --tags "${TAGS_KV[@]}" \
  --only-show-errors -o table

KV_ID="$(az keyvault show --name "$KV_NAME" --resource-group "$NEW_RG" --query id -o tsv)"

# Grant App Service's managed identity read access to secrets.
# CRITICAL: MSYS_NO_PATHCONV=1 prevents Git Bash on Windows from mangling
# the --scope path (it would otherwise prepend `C:/Program Files/Git/` →
# the API returns MissingSubscription).
MSYS_NO_PATHCONV=1 az role assignment create \
  --assignee "$APP_PRINCIPAL_ID" \
  --role "Key Vault Secrets User" \
  --scope "$KV_ID" \
  --only-show-errors > /dev/null
ok "App Service can READ from Key Vault"

# Grant the runner (you) full secret management — needed for Day 2 secret upload
MY_OBJ_ID="$(MSYS_NO_PATHCONV=1 az ad signed-in-user show --query id -o tsv)"
MSYS_NO_PATHCONV=1 az role assignment create \
  --assignee "$MY_OBJ_ID" \
  --role "Key Vault Secrets Officer" \
  --scope "$KV_ID" \
  --only-show-errors > /dev/null
ok "You can MANAGE secrets in Key Vault"

# ==== STEP 6/6: STATIC WEB APP ═════════════════════════════════════════════
log "6/6  Creating Static Web App '$SWA_NAME' (Free tier, $SWA_REGION)"
az staticwebapp create \
  --resource-group "$NEW_RG" \
  --name "$SWA_NAME" \
  --location "$SWA_REGION" \
  --sku Free \
  --tags "${TAGS_KV[@]}" \
  --only-show-errors -o table
ok "Static Web App ready (no GitHub binding — wired on Day 3)"

# ==== WAIT FOR POSTGRES + POST-CREATE CONFIG ═══════════════════════════════
log "Waiting for Postgres provisioning to complete..."
if wait "$PG_PID"; then
  ok "Postgres provisioned"
else
  fail "Postgres provisioning failed — see /tmp/raktify-pg-create.log"
fi

PG_HOST="${DB_NAME}.postgres.database.azure.com"

# Allow Azure services (so App Service outbound IPs can reach Postgres without
# enumerating every outbound IP). Reasonable for B1; tighten to VNet later.
# CLI 2.87.0 arg names: --server-name (server) + --name (rule name).
# Older docs/examples use --name (server) + --rule-name (rule) — wrong now.
log "Adding Postgres firewall rule: AllowAzureServices"
az postgres flexible-server firewall-rule create \
  --resource-group "$NEW_RG" \
  --server-name "$DB_NAME" \
  --name "AllowAzureServices" \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0 \
  --only-show-errors > /dev/null
ok "Azure services can reach Postgres"

# Create the application database 'raktify' (server creates default 'postgres' + 'azure_sys' + 'azure_maintenance').
# CLI 2.87.0 arg name: --database-name (NOT --name; --name is the rule name in firewall-rule but different here).
log "Creating application database '$APP_DB_NAME' on Postgres server"
az postgres flexible-server db create \
  --resource-group "$NEW_RG" \
  --server-name "$DB_NAME" \
  --database-name "$APP_DB_NAME" \
  --only-show-errors > /dev/null
ok "Database '$APP_DB_NAME' created"

# ==== OUTPUT FILE ══════════════════════════════════════════════════════════
APP_HOSTNAME="$(az webapp show --resource-group "$NEW_RG" --name "$APP_NAME" --query defaultHostName -o tsv)"
SWA_HOSTNAME="$(az staticwebapp show --resource-group "$NEW_RG" --name "$SWA_NAME" --query defaultHostname -o tsv)"
SWA_DEPLOY_TOKEN="$(az staticwebapp secrets list --resource-group "$NEW_RG" --name "$SWA_NAME" --query "properties.apiKey" -o tsv)"

cat > "$OUTPUT_FILE" <<EOF
# ─────────────────────────────────────────────────────────────────────────────
# Raktify · Azure Day 1 output · generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# THIS FILE CONTAINS SECRETS. NEVER COMMIT. The repo .gitignore excludes
# *-output.env so this file is safe in the working tree.
#
# Every line uses 'export' so that 'source ./azure-day1-output.env' propagates
# the vars into child processes (e.g. \`npm run migrate\` → node sees them).
# Without 'export', the vars are shell-scoped only and node connections fall
# back to localhost — wasting 30 min of "SSL doesn't work" diagnosis. Asked.
# ─────────────────────────────────────────────────────────────────────────────

# Subscription + region
export SUBSCRIPTION="$SUBSCRIPTION"
export SUB_ID="$SUB_ID"
export REGION="$REGION"
export NEW_RG="$NEW_RG"

# Postgres (raktify-db)
export DB_HOST="$PG_HOST"
export DB_NAME="$APP_DB_NAME"
export DB_ADMIN_USER="$DB_ADMIN_USER"
export DB_PASSWORD="$DB_PASSWORD"
export DATABASE_URL="postgresql://${DB_ADMIN_USER}:${DB_PASSWORD}@${PG_HOST}:5432/${APP_DB_NAME}?sslmode=require"

# App Service (raktify-api)
export APP_NAME="$APP_NAME"
export APP_HOSTNAME="$APP_HOSTNAME"
export APP_PRINCIPAL_ID="$APP_PRINCIPAL_ID"

# Key Vault (raktify-kv)
export KV_NAME="$KV_NAME"
export KV_URI="https://${KV_NAME}.vault.azure.net/"

# Static Web App (raktify-web)
export SWA_NAME="$SWA_NAME"
export SWA_HOSTNAME="$SWA_HOSTNAME"
export SWA_DEPLOY_TOKEN="$SWA_DEPLOY_TOKEN"

# Source this file on Day 2 before running migration / seed commands:
#   source $OUTPUT_FILE && npm run migrate
EOF

chmod 600 "$OUTPUT_FILE"

# ==== SUMMARY ══════════════════════════════════════════════════════════════
echo ""
hr
echo " ✓ Day 1 complete."
hr
echo ""
echo "Resources created in '$NEW_RG':"
az resource list --resource-group "$NEW_RG" --query "[].{name:name, type:type}" -o table
echo ""
echo "Secrets + connection strings: $OUTPUT_FILE (chmod 600)"
echo ""
echo "NEXT STEPS — Day 2:"
echo "  1. (One-time) Add to your local .gitignore:"
echo "       *-output.env"
echo ""
echo "  2. Source the output + apply migrations to raktify-db:"
echo "       source $OUTPUT_FILE"
echo "       DATABASE_URL=\"\$DATABASE_URL\" npm run migrate"
echo ""
echo "  3. Apply reference seeds (blood_groups, components, compatibility matrix):"
echo "       DATABASE_URL=\"\$DATABASE_URL\" node docs/azure-cutover/02-seed-reference.js"
echo ""
echo "  4. Upload secrets to Key Vault:"
echo "       bash docs/azure-cutover/02-upload-secrets.sh"
echo ""
echo "  5. Configure App Service env vars (Key Vault references):"
echo "       bash docs/azure-cutover/02-configure-app.sh"
echo ""
echo "DO NOT touch '$OLD_RG' yet — it keeps serving raktify.choudhari.ngo until Day 3."
echo ""
