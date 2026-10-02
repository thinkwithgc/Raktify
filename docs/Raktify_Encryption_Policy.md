# Encryption policy

Moved out of `CLAUDE.md` on 2 October 2026 for the same reason as the camp
module: it is settled policy, consulted when adding a PII column, not on every
session. The two rules that must survive without opening this file are kept in
CLAUDE.md under **Sensitive data handling**.

Nothing below has been edited, only relocated.

## The policy (resolved 2026-05-01)

The spec's `// encrypted` comments on `CHAR` columns are misleading. Decision after design review:

**Hybrid encryption strategy.** Two distinct mechanisms apply to two distinct column-shape categories:

| Column shape | Examples | Mechanism |
|--------------|----------|-----------|
| Fixed-width identifiers (`CHAR(N)`) | `donors.mobile`, `donors.abha_id`, `donors.aadhaar_last4`, all `*_contact_mobile`, `*.guardian_mobile` | Storage-level: **Azure Database for PostgreSQL Flexible Server** encrypts the disk at rest (service-managed key; customer-managed via Azure Key Vault optional). Access enforced by RLS + column-level GRANTs. **Plaintext in the column.** (Spec originally said AWS RDS + KMS — superseded by the May 2026 Azure pivot.) |
| Free-text PII (`TEXT`) | `full_name`, `address_line`, `deferral_reason`, `recall_reason`, `donor_screening.*_method`, `donor_screening.notes`, `lookback_registry.hospital_response`, `outcome_notes`, `notification_log.template_variables` (where appropriate), all encrypted-method columns | Column-level: AES-256-GCM via `backend/src/services/encryption`. Ciphertext format `v1:<provider>:<keyKind>:<base64url>`. |

**Why CHAR columns can't be column-encrypted:**
- Lookup by mobile (OTP login, duplicate detection) needs equality match. AES-GCM uses random IVs → same plaintext yields different ciphertexts → no equality match.
- Length: ciphertext is much wider than the original 13/17 chars; widening to `TEXT` would cascade through the entire schema.

**Why two encryption keys (per spec §1.3, adapted for Azure):**
- `LOCAL_ENCRYPTION_KEY_HEX` (key kind `main`): encrypts general PII text fields (name, address, etc.)
- `LOCAL_SCREENING_ENCRYPTION_KEY_HEX` (key kind `screening`): encrypts TTI screening data only — every method/notes column on `donor_screening` and any field on `screening_audit_log` whose name implies sensitive content.
- Both key materials live in **Azure Key Vault** in prod and are injected as App Service settings (the spec's original AWS-KMS naming `KMS_MAIN_KEY_ARN` / `KMS_SCREENING_KEY_ARN` is superseded by the May 2026 Azure pivot; an Azure Key Vault crypto provider that wraps these keys with a KV-hosted KEK is future work).
- A compromised app server with main-key access cannot read screening data without separately compromising the screening key. The screening API endpoint is the only path that uses the screening provider; everything else must use main.

**What the API code must do:**
- Mobile / ABHA / aadhaar_last4 columns: store plaintext, lookups work.
- TEXT PII columns: pass through `encryption.encrypt(value, { keyKind: 'main' | 'screening' })` before INSERT/UPDATE; pass through `decrypt()` before returning to the client.
- Never log a plaintext or ciphertext PII value. The pino redact list in `backend/src/config/logger.js` already covers known-sensitive paths; extend it when adding fields.

**Hospital-facing API rule (spec §1.2):**
Hospital role NEVER sees donor mobile in API responses, even though it's plaintext in the DB. Mask in the API layer: `+91XXXXX1234` (last 4 only).



