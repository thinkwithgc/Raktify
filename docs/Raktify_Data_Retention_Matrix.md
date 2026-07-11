# Raktify — Data Retention & Erasure Matrix

**Status: DRAFT for founder + legal review.** This is the per-data-class
retention policy required by DPDP Act 2023 §8(7) (retain personal data only as
long as necessary) and §12 (right to erasure). It documents what we keep, for
how long, and what happens on an erasure request. Update the "Legal basis"
column once counsel confirms the statutory minimums for blood-bank records.

Last updated: 2026-07-11.

---

## 1. Guiding principles

1. **Personal data is kept only while it serves an active purpose.** A donor's
   contact PII is retained while their profile is active; transient logs are
   purged on a short cycle.
2. **Erasure = anonymise, not hard-delete.** On a §12 request we scrub every
   identifying field but KEEP the de-identified clinical record. Blood-safety
   lookback (a reactive TTI can surface years later) and hemovigilance are legal
   obligations under which DPDP §12 permits continued retention.
3. **The audit log is immutable and exempt.** It records *that* an action
   happened, not donor content, and is required for integrity + compliance.

---

## 2. Retention by data class

| Data class | Where | Retention | On donor §12 erasure | Legal basis (confirm) |
|---|---|---|---|---|
| Donor contact PII — name, mobile, address, ABHA, Aadhaar-last4, DOB, geo | `donors`, `platform_users` | While profile active | **Anonymised immediately** (name→`[erased]`, mobile→tombstone, rest nulled/generalised; auth row locked) | Consent (§6), withdrawn on erasure |
| Donor clinical record — donations, TTI screening results, deferrals | `donation_history`, `donor_screening` | Long-term (blood-safety; confirm NBTC minimum, typ. 5+ yrs) | **Kept, de-identified** (donor PII already gone; row keyed by donor_id) | Legal obligation (§12 exception) |
| Verified blood group | `donors.blood_group_verified` | While record exists | **Kept** (clinical, needed for historical unit traceability) | Legal obligation |
| Reactive-TTI lookback investigation | `lookback_registry` | Until closed + retention tail | **Blocks erasure while open**, then donor is anonymised | Legal obligation (§12 exception) |
| Audit trail | `audit_log` | **7 years, immutable, never purged** | Untouched (records the erasure event itself) | Legal/compliance |
| Notification logs — PII payload (message variables, external mobile) | `notification_log` | **PII scrubbed after 90 days** (`data_retention_purge` job); row kept for counts | N/A (not keyed to donor identity after scrub) | Legitimate use (§7), minimised |
| WhatsApp bot conversation state | `bot_sessions` | **1 hour TTL** (`bot_session_cleanup` job) | N/A (transient) | Legitimate use |
| OTP secrets | `platform_users.otp_hash` | Nulled on verify; short `otp_expires_at` | Nulled on erasure | Security |
| Login IP / last-login | `platform_users.last_login_ip` | While account active | Nulled on erasure | Security |
| Login-attempt counters / lockout | `platform_users.failed_login_attempts`, `locked_until` | Transient (reset on success / lock expiry) | Row locked far-future | Security |
| Database backups / PITR | Azure Flexible Server | 7-day point-in-time recovery | Erased data ages out of the 7-day window naturally | Operational |

> **Note on backups:** an erasure anonymises live rows immediately; historical
> backup snapshots still contain the pre-erasure values until they roll off the
> 7-day PITR window. This is standard and DPDP-defensible (backups are not an
> active processing purpose), but state it in the privacy notice.

---

## 3. What is implemented

- **§12 erasure** — `backend/src/services/donors/erasure.js`, exposed as
  `POST /admin/donors/:id/erase` (ngo_admin, on a verified donor request).
  Two-table anonymisation (donors + platform_users) in one transaction; blocked
  while an open lookback references the donor. Migration `298` adds
  `donors.erased_at` + the tombstone sequence.
- **§8(7) log retention** — `backend/src/services/scheduler/jobs/data-retention-purge.js`,
  daily; scrubs `notification_log` PII payload older than
  `PII_LOG_RETENTION_DAYS` (default 90). Manual run via
  `POST /admin/jobs/run` (super_admin).
- **bot session TTL** — `bot_session_cleanup` (hourly), pre-existing.

## 4. Open items for review

1. **Confirm the blood-bank clinical-record statutory minimum** (NBTC / Drugs &
   Cosmetics Rules) and set an explicit retention tail on `donation_history` /
   `donor_screening` (currently "long-term / indefinite while blood-safety
   relevant").
2. **Donor self-service erasure** — today erasure is admin-initiated on a
   verified request. A `POST /donors/me/erase` self-service path needs a small
   RLS policy letting a donor scrub their own `platform_users` row.
3. **Inactive-donor auto-anonymisation** — optionally anonymise donors with no
   activity for N years (proactive §8(7)), rather than only on request.
4. **Parental consent (§9)** for the thalassemia + minor donor paths — separate
   workstream.
