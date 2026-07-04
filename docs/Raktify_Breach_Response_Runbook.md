# Raktify — Personal Data Breach Response Runbook

**Status:** DRAFT — pending founder + legal-advisor sign-off.
**Owner:** Grievance Officer / Data Protection point of contact (see §7).
**Legal basis:** Digital Personal Data Protection Act 2023 (DPDP Act), §8(6)
— a Data Fiduciary must notify the **Data Protection Board of India (DPB)** and
each **affected Data Principal** of a personal-data breach, in the form and
manner to be prescribed. Until the DPB prescribes exact timings we treat
**72 hours from confirmed detection** as our self-imposed notification target
(aligned with global norms and the DPB's expected direction).

This runbook is deliberately short and operational. When a breach is suspected,
follow it top to bottom. Do not wait for certainty to start containment.

---

## 0. What counts as a personal-data breach

Any unauthorised processing, accidental disclosure, acquisition, sharing, use,
alteration, destruction, or loss of access to personal data that compromises
its confidentiality, integrity, or availability. For Raktify, in practice:

- Donor / patient PII (name, mobile, address, ABHA, Aadhaar-last4) exposed to a
  party not entitled to it.
- TTI / screening (health) data disclosed outside the blood-bank boundary.
- The `DATABASE_URL`, an encryption key (`encryption-key-main` /
  `encryption-key-screening`), `JWT_SECRET`, or the WhatsApp access token
  leaking (each enables mass PII access).
- The hash-chained `audit_log` chain breaking (possible tampering).
- Bulk data exfiltration signals (an actor pulling large volumes via a valid
  but abused credential / RLS bypass).

A single-record mis-send (e.g. one WhatsApp to a wrong number) is a breach too,
but usually **Tier 3** (see §2).

---

## 1. Immediate response — first 60 minutes

1. **Declare.** Whoever notices raises it directly to the Grievance Officer
   (§7). No triage-by-committee; one named owner runs the incident.
2. **Contain — stop the bleeding before you investigate.**
   - Credential/key leak → rotate it *now* in Azure Key Vault
     (`az keyvault secret set …`), then restart `raktify-api` so the new value
     is picked up. Keys: `encryption-key-main`, `encryption-key-screening`,
     `database-url`, `jwt-secret`, `whatsapp-access-token`.
   - Compromised user/account → suspend it (`is_active = FALSE`; for staff also
     clear sessions by rotating `JWT_SECRET`, which invalidates every token).
   - Abused endpoint → tighten the rate limiter or take the route offline; the
     API is fronted by Azure, scale-in / stop the App Service if truly active.
   - **Do NOT** delete or overwrite logs, DB rows, or the audit_log — you need
     them for scope + they are legally protected (audit_log is INSERT-only by
     design; there is no delete path, keep it that way).
3. **Preserve evidence.** Snapshot App Service logs, Azure Monitor / App
   Insights, and the relevant `audit_log` window before they roll off.
4. **Timestamp everything.** Start an incident log (plain text, append-only):
   time detected, who, what you saw, every action taken. This is what you file
   with the DPB.

---

## 2. Severity tiers (drives who you notify and how fast)

| Tier | Definition | Notify DPB? | Notify data principals? | Target |
|------|-----------|-------------|-------------------------|--------|
| **Tier 1 — Critical** | Health data (TTI/screening) exposed, OR key/DB-credential leak enabling mass PII access, OR >100 individuals' PII, OR audit-chain tampering | Yes | Yes — every affected person | ≤72 h to DPB; principals in parallel |
| **Tier 2 — Significant** | 2–100 individuals' PII (name/mobile/address) exposed to an unauthorised party | Yes | Yes — the affected individuals | ≤72 h |
| **Tier 3 — Minor** | Single-record mis-delivery, quickly contained, no health data | Log internally; notify DPB if pattern/recurrence | The one affected individual | Best-effort, documented |

When unsure between two tiers, treat it as the **higher** one.

---

## 3. Assess scope (in parallel with containment)

- **Who** is affected (donors / patients / staff) and **how many** — query by
  the exposed vector, not by guesswork.
- **What fields** — was it encrypted-at-rest PII (name/address — ciphertext is
  useless without the key) or plaintext identifiers (mobile/ABHA)? A DB dump
  where the encryption keys were **not** also compromised is materially lower
  risk because `full_name` / `address_line` / screening free-text are
  AES-256-GCM ciphertext. **If a key was also leaked, assume full exposure.**
- **When** it started and whether it is ongoing.
- **How** — root cause hypothesis (leaked secret, RLS gap, dependency CVE,
  insider, lost device).

---

## 4. Notify

### 4.1 Data Protection Board of India (Tier 1 & 2)
File within 72 h of confirmed detection. Include: nature & extent of the breach,
categories & approximate number of data principals affected, likely
consequences, measures taken/proposed to mitigate, and the Grievance Officer as
point of contact. Keep a copy in the incident log.

### 4.2 Affected data principals (Tier 1 & 2)
Notify each affected person in clear language via their registered channel
(WhatsApp / SMS / email). Template:

> **Raktify security notice.** We detected an incident on {date} that may have
> involved your {data type}. Here is what happened: {plain summary}. Here is
> what we have done: {containment}. Here is what you can do: {action, e.g.
> "no action needed" / "we recommend …"}. Questions: contact@choudhari.ngo /
> +91 98505 41412. — Choudhari EduHealth India Foundation.

Do not downplay, do not speculate on blame, do not promise what you can't
verify. If health data was involved, say so.

---

## 5. Eradicate & recover

- Fix the root cause (patch, close the RLS gap, rotate all plausibly-exposed
  secrets even if only one is confirmed).
- Confirm containment held (no continued access).
- Restore any affected availability from a known-good state.
- Verify the `audit_log` hash chain (`GET /admin/audit/integrity`) once the
  `audit_reader` grant is in place; if the chain is broken, document the range.

---

## 6. Post-incident (within 2 weeks)

- Written post-mortem: timeline, root cause, blast radius, what worked, what
  didn't. Blameless — the goal is the fix, not fault.
- Concrete corrective actions with owners + dates (e.g. add the missing RLS
  test, add an alert, rotate keys on a schedule).
- Update this runbook with anything the incident taught us.
- File the closed incident record; retain it (breach records are themselves
  data we must be able to produce for the DPB).

---

## 7. Contacts

- **Grievance Officer / DP point of contact:** Gaurav R. Choudhari
- **Email:** contact@choudhari.ngo
- **Phone:** +91 98505 41412
- **Organisation:** Choudhari EduHealth India Foundation, Amravati, Maharashtra
- **Regulator:** Data Protection Board of India (DPDP Act 2023)
- **Cloud / infra escalation:** Azure Portal (RG `raktify`, Central India) —
  App Service `raktify-api`, Key Vault `raktify-kv`, DB `raktify-db`.

---

## 8. Pre-wired mitigations already in the platform

These reduce breach likelihood and blast radius — reference them when scoping:

- **Encryption at rest** — `full_name`, `address_line`, `clinical_indication`,
  guardian name, and all TTI screening free-text are AES-256-GCM ciphertext
  (`services/pii`); screening uses a **separate key**. A DB-only leak (without
  the KV keys) does not expose these.
- **RLS on every table** — district / role scoping in the database, not just
  app code.
- **Hash-chained, INSERT-only `audit_log`** — tampering is detectable and there
  is no delete path.
- **Mobile masking** — hospitals never receive donor mobile in API responses.
- **Secrets in Azure Key Vault** — referenced via managed identity, rotatable
  without a redeploy.

---

### Open items (needed to make this runbook fully executable)
1. Confirm the DPB's prescribed notification format/timeline once notified in
   the official Gazette; adjust §4.1.
2. Wire an **alert** (Azure Monitor / App Insights) on: repeated 401/403 spikes,
   unusual bulk reads, and App Service restarts — so detection isn't manual.
3. Land the `audit_reader` SELECT grant so `/admin/audit/integrity` works during
   an incident (currently returns a diagnostic 500 — see CLAUDE.md deferrals).
4. Document a key-rotation drill (rotate `encryption-key-main`, re-encrypt,
   re-derive blind indexes) so a key leak has a rehearsed recovery.
