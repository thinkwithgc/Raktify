# Raktify — QA Test Plan

**For:** External QA tester
**Production URL:** https://raktify.choudhari.ngo
**Test environment:** PRODUCTION (live data, real WhatsApp messages). Treat with care.
**Test depth:** Full functional + edge-case + accessibility + responsive

---

## 0. Ground rules

1. **This is production.** Real WhatsApp messages will go out from a real Meta-approved business account. Don't spam (template-message daily quota for unverified WABA = limited).
2. **Use only your own mobile numbers** for testing donor + community_leader flows. Do not use random numbers — they'll receive unexpected WhatsApp.
3. **Don't intentionally try SQL injection / XSS / DoS.** This is a healthcare platform with patient PII. Standard pentesting requires written authorisation. Functional testing only.
4. **Bug reports** → file in the template at the end of this doc. Severity guidelines included.
5. **Out-of-scope (do not test):**
   - The `/onboarding/mou-signed` webhook (would trigger real Leegality flow + cost the Foundation eSign credits)
   - Hard institution suspension (irreversible)
   - DB-direct queries
   - Anything that requires NGO admin to "verify license" for a real institution

---

## 1. Test credentials (Gaurav will share separately)

| Role | Username | Password | Mobile | URL |
|---|---|---|---|---|
| super_admin (director) | `director` | (separate channel) | n/a — uses password | https://raktify.choudhari.ngo/staff/login |

Once you're logged in as `director`, you can:
- Create test coordinators via `/admin → Coordinators → + Invite coordinator` (give your own mobile to test the WhatsApp flow)
- Create test community leaders via `/admin → Community leaders → + Invite leader`
- Onboard a test institution end-to-end (apply form → verify → MoU → activate)

**Do NOT** change the director account's password or mobile. If you need to test password reset, ask Gaurav to issue a separate test super_admin.

---

## 2. URL surface to test

| Surface | URL | Auth required |
|---|---|---|
| Public landing | https://raktify.choudhari.ngo | No |
| Donor login (mobile + OTP) | https://raktify.choudhari.ngo/login | No |
| Donor registration | https://raktify.choudhari.ngo/register | No |
| Community-leader login | https://raktify.choudhari.ngo/login?role=community_leader | No |
| Institution onboarding application | https://raktify.choudhari.ngo/onboarding/apply | No |
| Staff login | https://raktify.choudhari.ngo/staff/login | No |
| Camp public page | https://raktify.choudhari.ngo/c/<slug> | No (slug-based) |
| Community public page | https://raktify.choudhari.ngo/community/<slug> | No (slug-based) |
| Camp host application | https://raktify.choudhari.ngo/camps/host | No |
| robots.txt | https://raktify.choudhari.ngo/robots.txt | No |
| sitemap.xml | https://raktify.choudhari.ngo/sitemap.xml | No |
| Privacy / Terms / Data-deletion | /privacy, /terms, /data-deletion | No |
| Donor portal | /donor | Donor JWT |
| Community leader portal | /community-leader | community_leader JWT |
| Coordinator portal | /coordinator | coordinator JWT |
| Hospital portal | /hospital | hospital JWT |
| Blood bank portal | /bb | blood_bank JWT |
| Admin portal | /admin | ngo_admin / super_admin JWT |
| DHO portal | /dho | dho JWT |

---

## 3. Test scenarios by role

### TS-1: Public surface (anonymous, no login)

| # | Scenario | Expected |
|---|---|---|
| 1.1 | Landing page loads | Hero text ("The right blood, right on time."), CTA buttons "Become a donor" + "Log in", language switcher (MR/HI/EN), top nav with 3 clusters (brand · CTAs · utility) |
| 1.2 | Switch language to Marathi | All visible labels switch to MR; URL stays the same; refresh persists choice |
| 1.3 | Switch to Hindi → English → back to MR | All three work; preference stored in localStorage |
| 1.4 | View source on landing page | Confirm `<title>` is "Raktify — Blood Donor Network by Choudhari Foundation"; JSON-LD NGO schema present in `<head>`; `<noscript>` fallback has keyword-rich content |
| 1.5 | Try the public community page with an invalid slug | 404 message: "Community not found" + back-to-Raktify link |
| 1.6 | Try the public camp page with an invalid slug | 404 message |
| 1.7 | Visit /privacy, /terms, /data-deletion | Render legal copy, no JS errors |
| 1.8 | Open landing on mobile (DevTools or real device) | Hamburger menu in top nav; layout responsive at 320px-wide; CTAs tappable |
| 1.9 | Test PWA install prompt on mobile Chrome | Add-to-home-screen offered; icon = blood-drop "R"; offline page loads when network disconnected |

### TS-2: Donor registration + login

**Use your own mobile number** for the OTP. WhatsApp message will arrive from "Raktify".

| # | Scenario | Expected |
|---|---|---|
| 2.1 | Open /register with no URL params | 4-step wizard starts at "Health" (pre-screening Q&A) |
| 2.2 | Step 1: answer all NO to pre-screening | "Next" button enabled; proceeds to "You" step |
| 2.3 | Step 1: answer YES to a permanent-exclusion question (e.g. "Have you tested positive for HIV?") | Soft decline screen explaining why + offering doctor consultation suggestion |
| 2.4 | Step 2: enter invalid mobile (e.g. 7-digit number) | Inline validation error before submit; "Next" stays disabled OR shows error on submit |
| 2.5 | Step 2: enter valid +91 mobile + name + DOB + gender | Proceeds to "Recent" temporary deferral step |
| 2.6 | Step 3: any temporary deferral → still proceeds (informational only in v1) | Doesn't block, just informational |
| 2.7 | Step 4: skip consent checkbox + try to submit | Submit disabled |
| 2.8 | Step 4: tick consent + submit | OTP sent via WhatsApp; OTP step shown; donor row created in DB |
| 2.9 | Enter wrong OTP 3 times | "Account locked" + retry-after timestamp |
| 2.10 | Enter correct OTP | Logged in, redirected to /donor dashboard |
| 2.11 | Try /register with `?community=<valid-slug>` URL | Banner at top: "You're joining <community name>" — pre-attribution works |
| 2.12 | Register a duplicate (same mobile, second time) | OTP-resend works (rate-limited 3/h); but duplicate registration via mobile = blocked at backend (409); should test with same name+DOB+different mobile to trigger soft duplicate flag |
| 2.13 | Donor login at /login with verified mobile | Mobile field; submit → OTP arrives within ~10s; verify → /donor dashboard |
| 2.14 | Toggle availability on/off | Updates persist; if offline at toggle time → queued in IDB outbox, banner shows "1 pending change", syncs on reconnect |
| 2.15 | Try to access /admin or /coordinator as donor JWT | 403 forbidden (RequireAuth guards) |

### TS-3: Institution onboarding application (no commitment)

| # | Scenario | Expected |
|---|---|---|
| 3.1 | Open /onboarding/apply | Form with: kind (Hospital/BloodBank), legal_name, display_name, shortname, state/district/taluka/village cascade, address, pincode, optional GPS, CDSCO license (BB only), hospital reg no (HO only), primary contact, optional email, in-house BB checkbox |
| 3.2 | Submit with invalid pincode (e.g. starts with 0) | Inline error: "pincode must be 6 digits, not starting with 0" |
| 3.3 | Submit with BB kind but no CDSCO license | Backend 400: "cdsco_licence_required_for_blood_bank" |
| 3.4 | Submit valid application | "Application received" confirmation; institution row created in DB with status='PE' (pending) |
| 3.5 | Logged-in as director, go to /admin → Onboarding → see the application | Card shows your submitted data; "Verify license" + "Decline" buttons |
| 3.6 | Click "Verify license" (test institution only — do NOT click "Send MoU" unless you want to trigger real Leegality eSign) | Status flips PE → VE (verified); license_verified_at + license_verified_by stamped |
| 3.7 | If you DO want to test eSign (use Gaurav's mobile only, with his permission) | Real Aadhaar eSign link sent; only ~5 free credits/day on the Leegality account |

### TS-4: Community leader (invited by director)

You'll be a community_leader for this test. Ask director to invite your mobile.

| # | Scenario | Expected |
|---|---|---|
| 4.1 | Director invites you at /admin → Community leaders → + Invite | You receive WhatsApp `community_leader_signin` template within ~10s — Body: "Hi <your name>, your Raktify access is ready…", Footer: "Raktify | An initiative of Choudhari Foundation.", Button: "Sign in" |
| 4.2 | Tap the "Sign in" button in WhatsApp | Opens /login?role=community_leader&m=<your-mobile>; mobile field pre-filled |
| 4.3 | Click "Send OTP" | OTP arrives within ~10s; enter → logged in; redirected to /community-leader empty dashboard |
| 4.4 | Dashboard renders your profile + zero communities | Empty state message: "No communities yet. Create one — every community needs a co-leader…" |
| 4.5 | Click "+ Create community" | Form: name, slug (auto-derived from name, editable), description, state/district/taluka, co-leader picker (typeahead) |
| 4.6 | Try to submit without picking a co-leader | Submit disabled (button greyed); form notes co-leader is required |
| 4.7 | Pick a co-leader from the typeahead (you'll need a 2nd leader to exist — ask director to invite a 2nd one first) | Co-leader selected; "Create community" enables |
| 4.8 | Submit → land on community detail page | Shows name + region + counts (0 donors, 0 camps); "Edit" button (owner-only); ReferralCard with URL + Show QR; DonorsCard (empty); CampsCard (empty + "+ Host a camp" button) |
| 4.9 | Click "Edit" → change the name → tick the confirmation about donor confusion → save | Name updates; refresh persists |
| 4.10 | Click "Show QR" → download PNG | QR contains the community's public URL; scan it on your phone confirms |
| 4.11 | Open the public URL in incognito | Public community profile shows name + region + counts + "Join as a donor" CTA |
| 4.12 | Click "+ Host a camp" → fill form → submit | Camp created with status 'Pending' (PE); shown in CampsCard with amber "Pending" pill |
| 4.13 | Try removing the only co-leader | Refused with: "Cannot remove the last co-leader" (409) |
| 4.14 | Try editing the community's slug | Field doesn't exist in edit form (intentional — slug is immutable per UX decision) |

### TS-5: Coordinator (invited by director, NGO-employed)

Coordinator uses staff auth (username + password + TOTP).

| # | Scenario | Expected |
|---|---|---|
| 5.1 | Director invites you at /admin → Coordinators → + Invite coordinator → fill name + your mobile + district | You receive WhatsApp `institution_link` activation; Sign in button → /activate/<token> |
| 5.2 | /activate page → set password → submit | Redirect to /staff/login; success flash |
| 5.3 | Log in at /staff/login with auto-derived username (e.g. `yourname_coord`) + password | Login succeeds; redirect to /coordinator dashboard |
| 5.4 | Coordinator dashboard | Empty queue if no requests pending; KPI tiles for queue depth, on-duty toggle, impact metrics |
| 5.5 | Director can suspend you via /admin → Coordinators → Suspend | Your next login attempt returns 403 "account_suspended" |

### TS-6: Donor self-flow from a community referral

This validates the recruiter-attribution chain.

| # | Scenario | Expected |
|---|---|---|
| 6.1 | As community_leader, copy your community's URL | Format: https://raktify.choudhari.ngo/community/<slug> |
| 6.2 | Open in incognito → click "Join as a donor" | Lands on /register?community=<slug> |
| 6.3 | Banner at top of /register | "You're joining <community name>. The community organisers will see your name + blood group only — never your mobile." |
| 6.4 | Complete registration (different mobile from your leader account) | Donor row created; community_id + referred_by_community_leader_id (= owner of community) set |
| 6.5 | Back in your community-leader portal, refresh DonorsCard | New donor appears with name + blood group + last-donation (none yet); mobile NOT shown |

### TS-7: Bulk donor upload (NGO admin OR blood bank)

| # | Scenario | Expected |
|---|---|---|
| 7.1 | /admin → Import donors → click "⬇ Sample CSV" button | Download `raktify-donor-upload-sample.csv` with header row + 3 example rows |
| 7.2 | Open the sample in Excel; replace example rows with 5 of your test donors (use throwaway mobile numbers you have access to) | Required columns: full_name, mobile, blood_group_code |
| 7.3 | Save as CSV and upload | Preview shows 5 rows with green ✓ next to each |
| 7.4 | Click "Upload 5 rows" | Results table: 5 imported, 0 skipped, 0 invalid; source = IMP |
| 7.5 | Re-upload the same CSV | All 5 show "duplicate"; 0 newly imported |
| 7.6 | Make a deliberate error in your CSV (e.g. blood group "X+") | Preview shows that row in red with reason: "blood group must be one of A+/A-/B+/B-/AB+/AB-/O+/O-"; Upload disabled |
| 7.7 | One of those imported donors visits /register with their mobile | The web register merges with the imported row (consent_data_use → TRUE, mobile_verified → TRUE) |
| 7.8 | If you have BB credentials (ask director for a test BB account) | At /bb → Record donation → look up imported donor by mobile → amber "Imported donor — needs activation" banner; click "Activate donor" → modal asks DOB + gender + consent; submit → banner clears |

### TS-8: SEO + crawl-readiness

| # | Scenario | Expected |
|---|---|---|
| 8.1 | curl https://raktify.choudhari.ngo/robots.txt | HTTP 200, content-type `text/plain`, contains `Sitemap: https://raktify.choudhari.ngo/sitemap.xml` + Disallow rules for admin / staff / portal routes |
| 8.2 | curl https://raktify.choudhari.ngo/sitemap.xml | HTTP 200, XML with 9 URL entries (landing + register + login + staff/login + onboarding/apply + camps/host + privacy + terms + data-deletion) |
| 8.3 | View page source on landing | `<title>`, `<meta name="description">`, JSON-LD `@type: NGO` schema, `<noscript>` block with keyword-rich content |
| 8.4 | Share https://raktify.choudhari.ngo on WhatsApp to yourself | Link preview: title + description + the blood-drop OG image |

### TS-9: Performance + error handling

| # | Scenario | Expected |
|---|---|---|
| 9.1 | Time the landing page load on a 4G connection | First contentful paint < 2.5s; full interactive < 4s |
| 9.2 | API health endpoint: curl https://raktify-api.azurewebsites.net/health | Returns JSON `{status:"ok", db:"ok", environment:"production", version:"0.1.0"}` |
| 9.3 | Spam the OTP send endpoint with the same mobile (3+ times in an hour) | 4th attempt: 429 with `error: "rate_limit_otp_send"` and a retry-after header |
| 9.4 | Open browser DevTools Network tab during donor flow | All requests go to https://raktify-api.azurewebsites.net (CORS-allowed); no console errors; no 500s |
| 9.5 | Disconnect network mid-flow and toggle donor availability | Banner: "1 pending change — will sync when online"; reconnect → banner clears + change persists |

### TS-10: Accessibility quick-pass

| # | Scenario | Expected |
|---|---|---|
| 10.1 | Tab through the landing page | All interactive elements focusable in order; focus ring visible |
| 10.2 | Use a screen reader (VoiceOver / NVDA) on landing | Major regions (nav, main, footer) labelled; CTAs read out correctly |
| 10.3 | Check colour contrast on key text (donor CTA, alert badges) | WCAG AA at minimum (4.5:1 for body text) |
| 10.4 | Try to navigate the donor registration wizard keyboard-only | All 4 steps reachable + completable without mouse |

### TS-11: Browser + device matrix

Try at minimum:

| Browser | Desktop | Mobile |
|---|---|---|
| Chrome (latest) | ✓ | ✓ (Android) |
| Safari (latest) | ✓ (macOS) | ✓ (iOS) |
| Firefox (latest) | ✓ | optional |
| Edge (latest) | optional | optional |

Flag any visual breakage, layout shifts, or JS errors in console.

---

## 4. Known limitations (so you don't waste time)

These are **intentional v1 gaps** — please don't file as bugs:

1. **Pre-screening question bank is DRAFT** — banner says so. Currently informational only; doesn't block matching.
2. **Donor merge endpoint** returns 501 (stub) — pending medical-advisor sign-off.
3. **TOTP** is allowed-on-first-login, not enforced — will harden post-onboarding.
4. **WhatsApp templates currently only in English** — Marathi + Hindi translations are pending Meta approval batch. Welcome WhatsApp arrives in English even if user picked Marathi at registration.
5. **Adverse-reaction table not in schema yet** — hemovigilance report shows `0` with a note.
6. **Coordinator dashboard polls (not WebSocket)** — 15-20 sec refresh window.
7. **Service worker BackgroundSync** isn't wired — outbox replay happens on reconnect + on hook mount, not in background.
8. **NMC registry check** for hospital onboarding is currently manual — auto-check is post-Phase-8 deferred.
9. **Camp QR registration is IP-rate-limited (100/min)** — a real camp with 50+ donors on the same WiFi could trip it. Fix queued for before first real camp.
10. **PDF generation for DHO reports** — currently CSV-only. PDF deferred.

If you find something not on this list that seems wrong, file it.

---

## 5. Bug report template

When you find a bug, copy this template and fill it out. Send to Gaurav via WhatsApp / email.

```
---
TITLE: <one-line summary>
SEVERITY: [P0 / P1 / P2 / P3]
ENVIRONMENT: Production · <browser+version> · <OS>
ROLE: <donor / community_leader / coordinator / hospital / blood_bank / ngo_admin / super_admin / dho / anonymous>
URL: <full URL where bug surfaced>
TIMESTAMP: <YYYY-MM-DD HH:MM IST>
---

STEPS TO REPRODUCE:
1.
2.
3.

EXPECTED:
<what should have happened>

ACTUAL:
<what actually happened>

EVIDENCE:
<screenshots / browser console errors / network tab response / any quoted error text>

REPRODUCIBILITY:
[Always / Sometimes / Once]

WORKAROUND:
<any way to get past it; "none" if not>
```

### Severity guide

- **P0 — critical:** Data loss / data corruption / security breach / patient-safety risk / cannot reach the platform at all
- **P1 — high:** A primary workflow is broken for an entire user role; significant data shown incorrectly; auth bypass
- **P2 — medium:** A non-primary feature is broken; UX confusion; cosmetic issues that affect understanding
- **P3 — low:** Cosmetic bugs; typos; minor UI polish; nice-to-have improvements

---

## 6. What I particularly want eyes on

Gaurav's top priorities (this is honest about where I expect to find things):

1. **Multi-role login flow** — the same mobile being both donor + community_leader is a recent change. Confirm switching between `/login` and `/login?role=community_leader` works cleanly, OTP routes to the right account, no JWT cross-contamination.
2. **The activation magic-link flow** — both `community_leader_signin` (mobile pre-fill) and `institution_link` (token-based). Confirm both work on iOS Safari + Android Chrome (most common in the field).
3. **The bulk-upload + lazy-activation chain** — upload donors silently → those donors later activate at BB → confirm consent + mobile_verified flip correctly. The hand-off is fragile and important.
4. **Form validation consistency** — donor register has heavy validation; institution apply has different validation; community create has its own. Test that errors are surfaced consistently, no silent submits.
5. **Public surface SEO** — open https://raktify.choudhari.ngo in an incognito browser, check the link preview when shared on WhatsApp, verify the noscript fallback renders if you disable JS in DevTools.
6. **The PWA on a slow connection** — throttle to "Slow 3G" in DevTools and try the donor flow. The service worker should cache the shell; subsequent loads should be near-instant.

---

## 7. Getting unstuck

| Issue | Try |
|---|---|
| Login OTP not arriving | Wait 30 sec; if still nothing, check that the mobile is the one you actually own and is registered on WhatsApp |
| "Account locked" | Wait the cooldown period stated in the response; or ask Gaurav to manually unlock |
| Director account doesn't load /admin | Hard-refresh (Ctrl+Shift+R); clear cookies if needed; confirm login redirect went to /admin |
| WhatsApp button URL opens but page says "Invalid link" | Token may have expired (7 days) or already been used; ask Gaurav to issue a fresh invite |
| Anything else | Open browser DevTools → Console + Network tab → screenshot + send |

---

Test enthusiastically. Don't worry about breaking things — anything that breaks for you, breaks for a real user, and we want to know about it before the first hospital onboards.

— Gaurav
