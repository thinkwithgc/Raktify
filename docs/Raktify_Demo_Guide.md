# Raktify — Demo Guide

> **For the donor / partner meeting on 27 May 2026.**
> Pair with `docs/Raktify_Feature_Reference.md` (what's built) and
> `docs/Raktify_CSR_Budget.html` (financial / roadmap deck).

This is the click-by-click runbook. Open Raktify at
**`https://raktify.choudhari.ngo`** on your demo laptop and follow along.

---

## 1. Test accounts on staging

All staff accounts share the same password. Donor + coordinator log in by
mobile OTP — staging has `OTP_ECHO=true`, so the OTP is echoed back to the
login screen as `dev_otp echoed by backend: 123456` (no SMS provider needed).

### Staff (email + password)

| Role | Email | Password |
|------|-------|----------|
| Super admin | `superadmin@raktify.ngo` | `RaktifyDemo@2026` |
| NGO admin | `ngoadmin@raktify.ngo` | `RaktifyDemo@2026` |
| Hospital | `hospital@raktify.ngo` | `RaktifyDemo@2026` |
| Blood bank | `bloodbank@raktify.ngo` | `RaktifyDemo@2026` |
| Admin (legacy alias) | `admin@raktify.ngo` | `RaktifyDemo@2026` |

Sign in at `/staff/login`. None of these have TOTP enabled in staging — a
real production account will.

### Coordinator (mobile OTP)

| Role | Mobile | OTP |
|------|--------|-----|
| Coordinator (Amravati) | `+91 90000 00007` | echoed inline on send |

Sign in at `/login` → tap "**NGO / staff login**" to reach `/staff/login` is for email users; coordinators use the **donor mobile login** page since they're OTP users. The router auto-routes a coordinator role to `/coordinator`.

### Donors (mobile OTP)

| Donor | Mobile | Verified blood group | Notes |
|-------|--------|----------------------|-------|
| Ramesh Patil | `+91 90000 00001` | O+ | Has prior verified donation |
| Sunita Joshi | `+91 90000 00002` | A+ | |
| Imran Shaikh | `+91 90000 00003` | B+ | |
| Anjali More | `+91 90000 00004` | O+ | |
| Vikas Thakre | `+91 90000 00005` | AB+ | |
| Deepa Nair | `+91 90000 00006` | Unverified | Shows the "Self-reported (unverified)" badge in passport |

Sign in at `/login`. The OTP is echoed in the verify screen.

### Demo institutions

| Institution | Kind | District | shortname |
|-------------|------|----------|-----------|
| Irwin Hospital | Hospital | Amravati | `irwin` |
| Amravati Blood Centre | Blood bank (with CDSCO licence) | Amravati | `adbc` |

### Re-seed if anything goes sideways

```bash
node scripts/seed_demo.js --reset
```

`--reset` deletes demo accounts in FK-safe order (donors `+9190000000%`,
users `@raktify.ngo`, demo institutions by shortname, demo blood bags by
`DEMOISBT%` barcode prefix, demo requests by clinical_indication marker)
and re-creates them. Safe to run mid-demo.

---

## 2. The two demo flows we'll run live

### Flow A — Public camp host → NGO verify → donor RSVP via shared link

This is the headline flow. It demos:
- public self-service for any organisation (no Raktify account needed)
- NGO trust gate (verify license / send MoU / approve camp)
- magic-link organizer dashboard (no signup)
- multi-channel donor invitation with per-channel attribution
- donor experience (badge tiers, tier progression, camp RSVP)

**Setup before the meeting:**
1. Open three browser windows / tabs:
   - **Window 1**: incognito, no auth. (For the public-host story.)
   - **Window 2**: signed in as `ngoadmin@raktify.ngo`. (For verification.)
   - **Window 3**: incognito with a fresh donor identity to register. (For the donor side.)

**Live walk-through:**

1. **(Window 1)** Open `/camps/host`. Fill in:
   - Type: Educational institution / college
   - Org: "Sant Gadge Baba University"
   - Camp name: "Republic Day Donation Drive 2026"
   - State: Maharashtra · District: Amravati
   - Venue: "Main Auditorium, SGBAU campus"
   - Address: "Tapovan Road, Amravati"
   - Date: any near-future date · Time: 09:00–16:00
   - Target donors: 100
   - Volunteer training requested: ✅ · Expected volunteers: 8
   - Your name: "Dr. Rajesh Kulkarni" · Role: "Convenor" · Mobile: any 10-digit valid Indian mobile (e.g. `9850000000`)
2. Submit. Show the **"Application received"** confirmation card with the application ID.

3. **(Window 2)** `/admin` → **Onboarding tab... no wait, Camps tab**. Pending review is the default filter.
   - The new camp appears, tinted amber, with the "Training requested · 8 vols" chip.
   - Click **Review →**. The submitter panel shows everything — contact, role, organiser type, time window, training expectation, host notes.
   - Click **Verify & approve**. The success card appears with the **magic URL** in a read-only field.
   - Copy the URL with the **Copy** button. Show the **Send via WhatsApp** deep-link button (it opens wa.me with the pre-filled message).
   - Click **Preview dashboard** to open `/camp/<token>` in a new tab.

4. **(Window 4, opened via Preview)** The organizer dashboard appears with:
   - Camp status: Planned · Expiry date.
   - KPI cards: 0 / 0 / 0 / 0 (camp is brand new).
   - **Invite donors** card — copy URL, WhatsApp / Facebook / X / Email buttons, Instagram-copy button, QR code in Raktify red with a Print button.
   - Empty roster.

5. **(Window 1)** Paste the **`/c/<slug>`** URL (the public landing URL — not the magic token URL). Slugs look like `republic-day-donation-drive-2026-abc12`.
   - Hero card shows date, weekday, time window, venue, target counts.
   - Educational footer talks about ID, hydration, TTI testing, privacy.
   - Click **Sign up & register**.

6. **(Window 3 — donor signup)** A wizard appears at `/register?camp=<slug>&via=direct`.
   - Step 1: tap None on all pre-screening questions.
   - Step 2: enter a fresh mobile (e.g. `9850001234`), name, DOB, gender, village (use the demo seed village).
   - Step 3: just continue.
   - Step 4: tick consent → OTP sent → enter the echoed OTP → submit.
   - The wizard redirects back to `/c/<slug>`. The auto-RSVP fires. You see the "You're on the list" success card.

7. **(Window 4 — organizer dashboard)** Refresh. The KPI flips to 1 / 0 / 0 / 0. The roster shows the new donor with their blood group. The **Where RSVPs came from** panel shows `Direct link · 1`.

8. **(Window 4)** Type a quick message in the broadcast box: "Please bring a govt ID. Light breakfast served from 8 am." Click **Send to 1 donor**. Show the "Queued 1 message" confirmation. In production with WhatsApp Cloud live, the donor would receive this on WhatsApp; in staging it's logged to the console outbox.

9. **(Window 4)** On the roster row, click **Attended** to mark the donor as having shown up. The status pill flips to green.

Total time: ~8 minutes if you're crisp. This is the single most demoable flow for partners.

---

### Flow B — Hospital raises emergency → coordinator matches → blood bank fulfils

This demos the core lifecycle the platform is built around. Run it when
the audience cares about the operational depth, not the conversion story.

**Setup:**
1. Open three windows:
   - **Window 1**: signed in as `hospital@raktify.ngo`
   - **Window 2**: signed in as the coordinator (`+91 90000 00007` mobile)
   - **Window 3**: signed in as `bloodbank@raktify.ngo`

**Walk-through:**

1. **(Window 1)** `/hospital` → Dashboard tab. Show:
   - 5 KPI cards (open requests, critical now, fulfilled this month, expired this month, avg time-to-fulfilment over 90 days)
   - District blood availability grid (8 groups × N components)
   - Recent activity strip
2. Click **+ Raise request**. Fill a critical-tier request:
   - Patient initials: "R.K." · Age: 38 · Gender: M
   - Blood group: B+ · Component: PRBC · Units: 2
   - Urgency: **Critical** · Needed by: 4 hours from now
   - Clinical indication: "Postpartum haemorrhage" · Ward: "ICU-3"
3. Submit. The response shows matched bag count + the matched blood bank id.

4. **(Window 2)** `/coordinator` → Dashboard. The "Critical now" KPI ticks up. The "Most urgent open requests" panel lists the new request.
5. Click into the request detail. Show the action bar (Accept / Claim / Verify (only for tier 3/4) / Re-trigger match / Close with bag IDs) and the cross-role thread.
6. Click **Accept**. The request status flips to AS (Assigned).

7. **(Window 3)** `/bb` → Dashboard. The "Incoming requests · your district" panel lists the same request (Raise-Hand mechanism). Show the inventory grid + expiring-soon KPI.
8. Switch to Inventory tab. Filter by `AV` (Available). Show the colour-coded expiry pills.

9. **(Window 2)** Back to the coordinator request detail. Click **Close with bag IDs**, paste the bag IDs from Window 3's inventory. The request flips FU → CL (closed).

10. **(Window 1)** Hospital dashboard refreshes. "Fulfilled this month" KPI ticks up. The request moves to "Recent activity".

Total time: ~10 minutes. This is the operational depth story.

---

## 3. Other features to surface (if time allows)

### 3.1 Donor badge tier (Flow A's donor view)
After the donor finishes Flow A, they land on `/donor` showing:
- Their tier (New → Bronze → Silver → Gold → Champion at 0 / 1 / 5 / 10 / 25 lifetime verified donations)
- Progress bar to next tier
- Estimated lives-saved counter (`donations × 3`)
- The next-eligible-date card
- Donation history with TTI verdict per row

### 3.2 Institution onboarding flow
1. **(Window 1, incognito)** `/onboarding/apply`. Show the institutional self-apply form for a hospital or blood bank.
2. **(Window 2 — ngo_admin)** `/admin` → Onboarding tab (which is the default landing tab). Review the application, click Verify license, then Send MoU for eSign. In dev, the eSign URL is echoed inline so you can click through.
3. After "signing" the MoU (`POST /onboarding/mou-signed`), the institutional admin login is auto-provisioned and credentials are WhatsApp'd (or surfaced in dev).

### 3.3 NGO admin breadth
`/admin` has 10 tabs. Quick tour:
- **Onboarding** — institutional applications, verify / decline / send MoU.
- **Coordinators** — verify / suspend.
- **Camps** — review pending camp hosts, approve, decline, view roster.
- **Thalassemia** — patient registry with due-soon colour coding and one-tap transfusion recording.
- **Rare blood** — Bombay / Rh-null / weak-D etc with donor-link or shadow-entry modes.
- **Duplicates** — suspected-duplicate donor pairs.
- **Referrals** — institution-referral funnel.
- **Lookback** — open post-reactive-TTI investigations.
- **Audit** — hash-chain integrity check + filterable audit_log_safe view.
- **Jobs** — scheduled-task control panel.

Plus `/admin/reports` — district summary, hemovigilance, blood bank performance. CSV download supported.

### 3.4 Hospital dashboard depth
`/hospital` is more than a list:
- 90-day KPIs.
- District inventory grid that masks bag IDs (privacy invariant).
- Auto-refreshing recent activity.

### 3.5 Blood bank operational depth
`/bb` covers:
- Live inventory with colour-coded expiry.
- Donor mobile lookup → preview verified blood group → record donation flow.
- TTI accordion with 4-eyes verification gating.
- Legacy opening-stock entry (no TTI required).

### 3.6 Coordinator impact metrics
`/coordinator` dashboard surfaces:
- District queue size + critical count.
- Donations facilitated, requests fulfilled, lives saved estimate, reliability score (green ≥ 80 / amber ≥ 50 / red < 50).
- District donor pool size.

---

## 4. Handling questions on the day

### "How does Raktify make money?"
It doesn't. Free for donors, hospitals, blood banks, NGOs. Costs are covered
by CSR partnerships and grants. See `Raktify_CSR_Budget.html` for the
2-year operating budget.

### "Why not just use eRaktKosh / Sankalp / ublood / friends2support?"
Those are donor directories. We're a full bag-lifecycle platform —
component-level matching, TTI gating with 4-eyes verification, lookback
registry, hemovigilance reporting, RLS-gated audit trail, MoU-eSign-driven
onboarding, district escalation rings. The `Raktify_Feature_Reference.md`
table shows the side-by-side.

### "How do you protect donor privacy?"
- Mobile is encrypted at rest, masked from hospitals (`+91XXXXX1234`), never on the public camp roster.
- Self-reported blood group is never used in matching (always lab-verified).
- TTI field-level results never leave the screening tab — only the verdict (CL / PE / IN / HD).
- Audit log is INSERT-only with a hash chain; even a compromised admin can't backdate or delete records.
- Two KMS keys (main + screening) so a leaked app-server key can't decrypt TTI data.

### "What about regulatory approval?"
- The clinical reference data (compatibility matrix, TTI deferrals, eligibility rules) is `_DRAFT_PENDING_REVIEW` until the medical advisor signs off.
- The MoU template is pending legal review.
- The hemovigilance report endpoint is DHO-submission-ready (currently CSV; PDF is one Puppeteer wire away).
- No production launch until both sign-offs are in.

### "Can a partner organisation use this in their state?"
Yes — the LGD geographic loader covers all of India. Activating a new state
is a single SQL `UPDATE`. We're built on Azure infra in Central India with
data residency aligned to DPDP Act 2023.

### "Aadhaar verification?"
The schema supports `aadhaar_last4` (encrypted), and the
`id_proof_type / id_proof_last4` columns on coordinators capture
self-reported KYC. Full Aadhaar XML verification needs a UIDAI AUA/KUA
licence — that's months of paperwork and on the roadmap, not built.

---

## 5. Pre-flight checklist (do this 1 hour before the meeting)

- [ ] Re-seed demo data: `node scripts/seed_demo.js --reset`
- [ ] Confirm backend is up: `curl https://raktify-api-staging-hsdxfzhrg5a7ekes.centralindia-01.azurewebsites.net/health` should return `{ status: 'ok' }`.
- [ ] Confirm `OTP_ECHO=true` is set on staging (App Service → Configuration). Without it, donor OTP login won't work.
- [ ] Open all three to four browser windows ahead of time and sign each in to its role. The OTP flow is fast enough but doing it live distracts from the narrative.
- [ ] Have the URLs and account list (this guide) on a second screen or printout.
- [ ] Mobile hotspot ready in case the venue Wi-Fi is flaky — the platform is offline-capable for donor availability toggles, but live demos need network.
- [ ] Restart the App Service if it's been idle (cold start ≈ 10–20 s on B1).
- [ ] If you plan to demo the camp magic-link share, have wa.me opened on your phone so you can show the actual WhatsApp share intent.

---

## 6. If something breaks mid-demo

| Symptom | Quick recovery |
|---------|----------------|
| Donor OTP isn't echoed | `OTP_ECHO=true` env var missing. Set in App Service → Restart. ~30s. |
| Login redirects to wrong portal | Logout, sign in again. We fixed the routing in commit `626c699`. |
| Camp magic link returns 500 | Already fixed (commit `e397f5e`). If it reproduces, the App Service hasn't redeployed the latest main yet — check `git log -1` on the deploy. |
| Backend cold start (slow first request) | Hit `/health` once before the demo to warm it up. |
| Postgres connection timeout | Firewall — add the venue's public IP to `raktify-db-staging` → Networking. |
| Static Web App build looks stale | Hard-refresh (Ctrl+F5 / Cmd+Shift+R). The PWA service worker can cache aggressively. |

---

## 7. Closing slide (suggested talking points)

1. **Code-complete in 8 phases.** 44 migrations, 44 endpoints, 5 role portals, 10 admin tabs. Live on Azure now.
2. **Designed for real Indian conditions.** Mobile OTP first, offline-capable, Marathi-default with Hindi/English, free for everyone.
3. **Privacy is a feature, not a footnote.** RLS on every table, AES-GCM column encryption, two-KMS-key hybrid for TTI data, hash-chained audit log.
4. **What CSR funding accelerates** — WhatsApp activation, pan-India geo, real-time queue, Aadhaar KYC, IoT cold-chain, insurance integration, design pass. (See `Raktify_CSR_Budget.html`.)
5. **What we need from partners** — district roll-out introductions (DHO offices, blood bank associations), medical-advisor referrals for the clinical-data sign-off, and the CSR commitment itself.

Good luck.
