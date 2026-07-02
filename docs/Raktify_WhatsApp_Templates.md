# Raktify — WhatsApp Message Templates

> Original 7 templates (§1–7 below) are already submitted to Meta. §8–14 are
> the **V2 batch** — 7 new templates for the donor-alert-gate architecture
> (BB routing, replacement obligation, community-first alerts, BB incoming
> panel, coord prefire warning + critical-new pings, community leader
> mobilise). All wired into the notification chokepoint at
> `backend/src/services/notifications/`. Approval is independent per template
> + per language; typical review time is 1–3 business days. **Submit each
> language variant separately** — they review in parallel.

---

## How to submit each template

1. Go to **WhatsApp Manager** → https://business.facebook.com/wa
2. Left sidebar → **Account tools** → **Message templates**
3. Click **`Create template`** (top-right).
4. **Category:** pick from the table below for each template.
5. **Language:** pick one. To submit the same template in multiple languages, repeat the create-template flow per language; they all share the same template *name*, just with different language tags.
6. **Header:** None (unless specified).
7. **Body:** paste exactly as shown. Use `{{1}}`, `{{2}}` etc. for variables — Meta will ask for sample values during submission.
8. **Footer:** paste exactly as shown (or "None" if blank).
9. **Buttons:** configure as shown.
10. Click **`Submit`**. Meta reviews and emails you the result.

**Naming convention:** Snake-case, descriptive. The backend
`sendNotification()` function references templates by exactly this name string,
so don't rename without updating `backend/src/services/notifications/`.

---

## Template 1 · `donor_otp`

| Field | Value |
|---|---|
| **Name** | `donor_otp` |
| **Category** | **Authentication** |
| **Languages** | English, Marathi, Hindi |
| **Header** | None |
| **Footer** | None *(footers not allowed on Authentication templates)* |

### Body (English)

```
*{{1}}* is your Raktify verification code. For your security, do not share this code with anyone.
```

### Body (Marathi)

```
*{{1}}* हा तुमचा Raktify पडताळणी कोड आहे. सुरक्षेसाठी हा कोड कोणाशीही शेअर करू नका.
```

### Body (Hindi)

```
*{{1}}* आपका Raktify सत्यापन कोड है। सुरक्षा के लिए, यह कोड किसी के साथ साझा न करें।
```

### Variables

- `{{1}}` — 6-digit OTP. Sample: `483921`

### Buttons

- **One button: Copy code**
  - Type: `Copy code`
  - Copy code text variable: `{{1}}` (same as body variable)
  - This auto-fills the OTP into the user's clipboard on tap.

### Fires when

- Donor login (`POST /auth/otp/send` with `role_hint=donor`)
- Donor registration step 4 (consent + OTP)
- Coordinator login

---

## Template 2 · `donor_alert_critical`

| Field | Value |
|---|---|
| **Name** | `donor_alert_critical` |
| **Category** | **Utility** |
| **Languages** | English, Marathi |
| **Header** | None |
| **Footer** | `An initiative of Choudhari Foundation · choudhari.ngo` |

### Body (English)

```
🩸 *Critical blood need*

Patient needs *{{1}}* ({{2}})
*{{3}} units* needed by *{{4}}*
District: *{{5}}*

Tap below to view and respond. Your donation could save a life.
```

### Body (Marathi)

```
🩸 *अत्यावश्यक रक्त गरज*

रुग्णाला *{{1}}* ({{2}}) रक्त हवे
*{{3}} युनिट* — *{{4}}* पर्यंत
जिल्हा: *{{5}}*

प्रतिसाद देण्यासाठी खाली टॅप करा. तुमचे दान एखाद्याचा जीव वाचवू शकते.
```

### Variables

- `{{1}}` — Blood group (e.g. `B-`)
- `{{2}}` — Component (e.g. `PRBC`)
- `{{3}}` — Units required (e.g. `2`)
- `{{4}}` — Needed-by datetime (e.g. `14:00 today`)
- `{{5}}` — District name (e.g. `Amravati`)

### Buttons

- **One button: Open Raktify**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/donor?alert={{1}}` *(Meta calls the dynamic part Variable 1 on the URL)*
  - Sample value for review: `https://raktify.choudhari.ngo/donor?alert=abc123`

### Fires when

- Matching engine activates donors for a critical-tier request when bank inventory is insufficient.

---

## Template 3 · `camp_reminder`

| Field | Value |
|---|---|
| **Name** | `camp_reminder` |
| **Category** | **Utility** *(opted-in roster, not marketing)* |
| **Languages** | English, Marathi |
| **Header** | None |
| **Footer** | `An initiative of Choudhari Foundation · choudhari.ngo` |

### Body (English)

```
Hi *{{1}}*,

Reminder: *{{2}}* on *{{3}}* at *{{4}}*.

{{5}}

See you there! 🩸
```

### Body (Marathi)

```
नमस्कार *{{1}}*,

स्मरण: *{{2}}* — *{{3}}* रोजी, *{{4}}* ठिकाणी.

{{5}}

तिथे भेटू! 🩸
```

### Variables

- `{{1}}` — Donor first name (e.g. `Ramesh`)
- `{{2}}` — Camp name (e.g. `Republic Day Donation Drive 2026`)
- `{{3}}` — Date (e.g. `26 January 2026, 09:00–16:00`)
- `{{4}}` — Venue (e.g. `Main Auditorium, SGBAU campus`)
- `{{5}}` — Custom message from organiser (e.g. `Bring govt ID. Light breakfast from 8am.`)

### Buttons

- **One button: Open camp page**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/c/{{1}}`
  - Sample: `https://raktify.choudhari.ngo/c/republic-day-camp-amravati`

### Fires when

- Camp organiser broadcasts a message to the roster (`POST /camps/access/:token/broadcast`)
- Day-before automated reminder (post-launch automation)

---

## Template 4 · `camp_organizer_link`

| Field | Value |
|---|---|
| **Name** | `camp_organizer_link` |
| **Category** | **Utility** |
| **Languages** | English |
| **Header** | None |
| **Footer** | `An initiative of Choudhari Foundation · choudhari.ngo` |

### Body

```
Hi *{{1}}*,

Your camp *{{2}}* on *{{3}}* has been approved on Raktify. 🩸

Track RSVPs, broadcast updates, and mark attendance from your organiser dashboard. The link below is private — please don't share publicly.
```

### Variables

- `{{1}}` — Organiser name (e.g. `Dr. Rajesh Kulkarni`)
- `{{2}}` — Camp name (e.g. `Republic Day Donation Drive 2026`)
- `{{3}}` — Scheduled date (e.g. `26 January 2026`)

### Buttons

- **One button: Open organiser dashboard**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/camp/{{1}}`
  - Sample: `https://raktify.choudhari.ngo/camp/LD5mQTKwK0KYdGnZguLcCgXHl6CYIjMh`

### Fires when

- NGO admin approves a public camp application (`POST /camps/:id/verify`). The magic-link token is delivered to the organiser's submitted mobile.

---

## Template 5 · `mou_esign_link`

| Field | Value |
|---|---|
| **Name** | `mou_esign_link` |
| **Category** | **Utility** |
| **Languages** | English |
| **Header** | None |
| **Footer** | `Choudhari EduHealth India Foundation · NGO-DARPAN MH/2025/0643345` |

### Body

```
Hi *{{1}}*,

Please review and sign the Raktify Memorandum of Understanding for *{{2}}*.

The eSign link below is valid until *{{3}}*. After signing, your institutional admin credentials will be sent to this number.
```

### Variables

- `{{1}}` — Signatory name (e.g. `Dr. S. Deshmukh`)
- `{{2}}` — Institution legal name (e.g. `Irwin Hospital Amravati`)
- `{{3}}` — Sign-link expiry (e.g. `28 May 2026, 17:00`)

### Buttons

- **One button: Sign MoU**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/onboarding/esign/{{1}}`
  - Sample: `https://raktify.choudhari.ngo/onboarding/esign/abc123`

### Fires when

- NGO admin clicks "Send MoU for eSign" on a verified institution (`POST /onboarding/generate-mou/:id`).

---

## Template 6 · `institutional_credentials` — **DEPRECATED**

> **Status:** Rejected by Meta as Utility (temp passwords resemble OTP
> codes); rejected on principle too — sending plaintext passwords over a
> messaging channel is poor practice. Superseded by **Template 7
> `institutional_setup_link`** below, which sends a single-use
> password-setup URL instead. The legacy template definition is preserved
> here only for change-history reference; do NOT resubmit. The code path
> in `/onboarding/mou-signed` no longer references it.

Legacy body (for reference):
```
Welcome to Raktify, *{{1}}*! 🩸  Your admin login is ready.  *Email:* {{2}}  *Temporary password:* {{3}}  You'll be asked to change your password on first login.
```

---

## Template 7 · `institution_activation_link` *(replaces Template 6)*

> **Naming + framing notes:** the first iteration of this template was
> submitted as `institutional_setup_link` with a body that said "set your
> password". Meta's automated classifier flagged it as Authentication-flavoured
> ("password", "set" trigger the auth NLP) and rejected it. Authentication
> templates must deliver a numeric code, not a link — so resubmitting under
> that category doesn't fit either. The resolution is to **reframe as a
> standard account-activation Utility template** (drops the trigger words,
> matches a well-established Utility pattern across SaaS / e-commerce).
> Backend code keeps `templateType: 'SETUP_LINK'` (internal name) and the
> URL route keeps `/setup/:token` (with `/activate/:token` as a sibling
> route that renders the same component, so the Meta button URL can stay
> on `/activate/` without breaking older in-flight tokens).

| Field | Value |
|---|---|
| **Name** | `institution_activation_link` |
| **Category** | **Utility** |
| **Languages** | English (add MR/HI later if needed; institutional signatories tend to be English-comfortable) |
| **Header** | None |
| **Footer** | `Raktify · An initiative of Choudhari EduHealth India Foundation` |

### Body

```
Hi *{{1}}*,

Welcome aboard! Your *{{2}}* account on Raktify is ready to activate. Tap below to complete account setup — takes about 30 seconds. 🩸

The activation link is private and expires in *{{3}}*. Please don't share or forward.
```

### Variables

- `{{1}}` — Signatory name (e.g. `Dr. S. Deshmukh`)
- `{{2}}` — Institution display name (e.g. `Irwin Hospital Amravati`)
- `{{3}}` — Expiry duration (e.g. `7 days`)

### Buttons

- **One button: Activate account**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/activate/{{1}}`
  - Sample value for review: `https://raktify.choudhari.ngo/activate/abc123XYZ-0_0-_0_0`

### Fires when

- eSign webhook fires (`POST /onboarding/mou-signed`) and provisions the
  institutional admin platform_user row. The handler generates a single-use,
  7-day-TTL setup token (see `services/users/setup.js`) and embeds it as the
  URL button variable. Recipient taps the link → lands on `/setup/<token>` →
  sets their own password → token is consumed → can log in normally.

### Security properties

- Token is 32-byte URL-safe random (~256 bits entropy)
- Only the SHA-256 hash is stored in `platform_users.setup_token_hash`
- TTL: 7 days from generation (NGO admin can re-issue if expired)
- Single-use: the second click after a successful setup shows
  "link already used, please log in instead"
- Until consumed, the `platform_users.password_hash` is an unguessable
  random placeholder — the institution literally cannot log in by any other
  path until they use the setup link.

### After approval

Backend env var to set (paste the **Meta-approved template name**, not the internal alias):

```
WHATSAPP_TEMPLATE_SETUP_LINK=institution_activation_link
```

The `setup_link` key inside `env.whatsapp.templates` resolves the template
name at send time. Handler in
`backend/src/services/notifications/whatsappCloudProvider.js` lives in the
`TEMPLATE_HANDLERS.SETUP_LINK` entry — 3 body vars (signatory_name,
institution_name, expires_in) + 1 URL button var (setup_token).

---

## Submission order

If you want to be strategic about review times:

1. **`donor_otp`** (en, mr, hi) — **submit first**, gates donor login on every demo.
2. **`institutional_credentials`** — gates institution onboarding (May 27 demo step).
3. **`mou_esign_link`** — gates institution onboarding step 2.
4. **`camp_organizer_link`** — gates camp approval flow.
5. **`donor_alert_critical`** (en, mr) — gates emergency response demo.
6. **`camp_reminder`** (en, mr) — gates camp organiser broadcast.

In practice all six get reviewed in parallel, so submit in one sitting.

---

## After approval

When Meta emails you approval, the template appears in **Message templates** with status **Approved**.

Your backend then calls `sendNotification({ templateType: 'donor_otp', variables: { '1': '483921' }, channel: 'WA', language: 'mr' })` and Meta routes the right language to the donor's preferred locale.

The chokepoint already exists — see
`backend/src/services/notifications/whatsappCloudProvider.js`.
We just need to flip `NOTIFICATIONS_PROVIDER=whatsapp_cloud` in the Azure App
Service env once the templates are approved + display name is live.

---

## If Meta rejects a template

Common reasons:
- **Footer too promotional** — keep it factual ("An initiative of …"), not promotional ("Donate now!").
- **Body too generic** — Authentication templates must include the word "code" or "verification".
- **Variable misuse** — `{{1}}` in the body must have a sample value during submission.
- **Buttons that look like phishing** — URLs must match a domain owned by the verified business.

If rejected, Meta gives a one-line reason. Tweak and resubmit; the second
review is usually same-day.

---

# V2 batch — donor-alert-gate architecture

> Templates §8–§14 support the V2 donor-alert-gate flow (see CLAUDE.md
> Post-Phase-8). Backend code is already wired to send these — you just need
> Meta approval + the corresponding `WHATSAPP_TEMPLATE_*` env var set.
>
> **Category note:** all V2 templates are **Utility**. Meta rejects
> Marketing-flavoured urgency language; the bodies below have been tuned to
> read transactional (specific request identifiers, concrete next action, no
> "help us!" appeals). If Meta reclassifies to Marketing, the fix is almost
> always to drop emojis in the header line + tighten the CTA to something
> like "Tap to view request".

---

## Template 8 · `donor_alert_bb_routed`

> V2 replacement for `donor_alert_critical` when the matcher has a specific
> blood bank to route the donor to (distance included). Falls back to
> `donor_alert_critical` when no BB routing is available.

| Field | Value |
|---|---|
| **Name** | `donor_alert_bb_routed` |
| **Category** | **Utility** |
| **Languages** | English, Marathi, Hindi |
| **Header** | None |
| **Footer** | `Raktify · An initiative of Choudhari Foundation` |

### Body (English)

```
A patient needs *{{1}}* blood at *{{2}}* today. That's about *{{3}} km* from you.

Tap below to confirm you can donate. If you can't, please tap 'not this time' so we can find someone else.
```

### Body (Marathi)

```
आज एका रुग्णाला *{{2}}* येथे *{{1}}* रक्ताची गरज आहे. तुमच्यापासून सुमारे *{{3}} किमी*.

रक्तदान करू शकत असल्यास खाली टॅप करा. जमत नसल्यास 'यावेळी नाही' दाबा जेणेकरून आम्ही दुसरा दाता शोधू.
```

### Body (Hindi)

```
आज एक मरीज़ को *{{2}}* पर *{{1}}* रक्त की आवश्यकता है। आपसे लगभग *{{3}} किमी* दूर।

रक्तदान कर सकते हैं तो नीचे टैप करें। नहीं कर सकते तो 'इस बार नहीं' दबाएँ ताकि हम दूसरा दाता ढूँढ सकें।
```

### Variables

- `{{1}}` — Blood group + component (e.g. `B- PRBC`)
- `{{2}}` — Blood bank display name (e.g. `Dr. Panjabrao Deshmukh BB, Amravati`)
- `{{3}}` — Distance from donor's current location (integer km, e.g. `4`)

### Buttons

- **One button: Confirm you can donate**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/alert/{{1}}`
  - Sample: `https://raktify.choudhari.ngo/alert/eyJhbGciOiJIUzI1Ni-sample-jwt`

### Fires when

Scheduler job `donor_alert_gate` fires alerts from `pending_donor_alerts`.
Backend `templateType: 'DONOR_ALERT_BB'`. Provider handler in
`whatsappCloudProvider.js` fills body vars in insertion order: `blood_group`,
`bb_name`, `distance_km` + URL button with the public alert token.

### After approval

```
WHATSAPP_TEMPLATE_DONOR_ALERT_BB=donor_alert_bb_routed
```

---

## Template 9 · `donor_alert_replacement`

> Sent when the requesting BB flags the request as needing a **replacement**
> donor (i.e. BB is giving inventory now, patient's family or friends need to
> return equivalent units within a window). Different framing from a
> life-safety alert — it's an obligation-fulfilment ask, not a rescue.

| Field | Value |
|---|---|
| **Name** | `donor_alert_replacement` |
| **Category** | **Utility** |
| **Languages** | English, Marathi, Hindi |
| **Header** | None |
| **Footer** | `Raktify · An initiative of Choudhari Foundation` |

### Body (English)

```
Hi *{{1}}*, a patient at *{{2}}* has received *{{3}}* today. The blood bank asks for a replacement donation to keep stock balanced within *{{4}}*.

Tap below to confirm. Your donation replaces the unit and keeps supply stable for the next patient.
```

### Body (Marathi)

```
नमस्कार *{{1}}*, आज *{{2}}* येथील एका रुग्णाला *{{3}}* देण्यात आले आहे. रक्तपेढी *{{4}}* च्या आत बदली रक्तदान मागत आहे.

पुष्टी करण्यासाठी खाली टॅप करा. तुमचे दान त्या युनिटची पूर्तता करते आणि पुरवठा स्थिर ठेवते.
```

### Body (Hindi)

```
नमस्ते *{{1}}*, आज *{{2}}* के एक मरीज़ को *{{3}}* दिया गया है। ब्लड बैंक *{{4}}* के भीतर प्रतिस्थापन दान की ज़रूरत बता रहा है।

पुष्टि करने के लिए नीचे टैप करें। आपका दान उस यूनिट की भरपाई करता है और अगले मरीज़ के लिए आपूर्ति स्थिर रखता है।
```

### Variables

- `{{1}}` — Donor first name (e.g. `Ramesh`)
- `{{2}}` — Blood bank display name (e.g. `Irwin Hospital BB, Amravati`)
- `{{3}}` — Component received (e.g. `1 unit of B- PRBC`)
- `{{4}}` — Timeframe (e.g. `72 hours`)

### Buttons

- **One button: Confirm replacement donation**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/alert/{{1}}`
  - Sample: `https://raktify.choudhari.ngo/alert/repl-abc123`

### Fires when

BB coordinator marks a request `replacement_required=TRUE` via the
coordinator panel. Backend `templateType: 'DONOR_ALERT_REPLACE'`. The alert
token is the same public-JWT scheme as `donor_alert_bb_routed`.

### After approval

```
WHATSAPP_TEMPLATE_DONOR_ALERT_REPLACE=donor_alert_replacement
```

---

## Template 10 · `donor_alert_community_first`

> First-look alert sent only to donors attributed to a specific community
> leader, before the wider donor pool is engaged. Community-scoped alerts
> give the leader's roster a 15–30 min exclusive window to respond.

| Field | Value |
|---|---|
| **Name** | `donor_alert_community_first` |
| **Category** | **Utility** |
| **Languages** | English, Marathi, Hindi |
| **Header** | None |
| **Footer** | `Raktify · Community leader alert · choudhari.ngo` |

### Body (English)

```
Hi *{{1}}*, your community leader *{{2}}* is looking for *{{3}}* donors for a patient in *{{4}}* today.

Tap below to confirm you can donate. This alert is going to your community first — before Raktify widens the search.
```

### Body (Marathi)

```
नमस्कार *{{1}}*, आज *{{4}}* मधील एका रुग्णासाठी तुमचे कम्युनिटी लीडर *{{2}}* *{{3}}* दात्यांचा शोध घेत आहेत.

रक्तदान करू शकत असल्यास खाली टॅप करा. हा अलर्ट प्रथम तुमच्या कम्युनिटीला जात आहे — त्यानंतर Raktify शोध विस्तृत करेल.
```

### Body (Hindi)

```
नमस्ते *{{1}}*, आज *{{4}}* के एक मरीज़ के लिए आपके कम्युनिटी लीडर *{{2}}* *{{3}}* दाताओं की तलाश में हैं।

रक्तदान कर सकते हैं तो नीचे टैप करें। यह अलर्ट पहले आपकी कम्युनिटी को जा रहा है — उसके बाद Raktify खोज बढ़ाएगा।
```

### Variables

- `{{1}}` — Donor first name (e.g. `Ramesh`)
- `{{2}}` — Community leader display name (e.g. `Anita Kale`)
- `{{3}}` — Blood group + component (e.g. `O+ PRBC`)
- `{{4}}` — District / taluka name (e.g. `Amravati Rural`)

### Buttons

- **One button: Confirm you can donate**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/alert/{{1}}`
  - Sample: `https://raktify.choudhari.ngo/alert/comm-xyz789`

### Fires when

`donor-alert-gate` scheduler fires and the request has
`attributed_community_id != NULL`. Backend `templateType:
'DONOR_ALERT_COMMUNITY'`. Community-first pool is selected in
`selectDonorPool()` via `attributedCommunityId` — same token scheme as
`donor_alert_bb_routed`.

### After approval

```
WHATSAPP_TEMPLATE_DONOR_ALERT_COMMUNITY=donor_alert_community_first
```

---

## Template 11 · `bb_donor_incoming`

> Notifies the receiving blood bank when a donor has accepted an alert and
> is coming to donate. Populates the "Incoming donors" tab in the BB
> dashboard. English-only for now — BB staff are English-comfortable and
> we don't spend Meta approval budget on lower-priority translations.

| Field | Value |
|---|---|
| **Name** | `bb_donor_incoming` |
| **Category** | **Utility** |
| **Languages** | English |
| **Header** | None |
| **Footer** | `Raktify · Blood bank alert · choudhari.ngo` |

### Body

```
A donor has accepted an alert and is coming to your bank.

Donor: *{{1}}* ({{2}})
For: *{{3}}*
Expected arrival: *{{4}}*

Open the Incoming Donors tab to review, mark arrived, or defer.
```

### Variables

- `{{1}}` — Donor display name (BB is authorised to see donor identity)
- `{{2}}` — Verified blood group (e.g. `B-`)
- `{{3}}` — Request short code (e.g. `REQ-A7X9`)
- `{{4}}` — Expected arrival window (e.g. `within 2 hours` / `Tuesday morning`)

### Buttons

- **One button: Open Incoming Donors**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/bb?tab=incoming&donor={{1}}`
  - Sample: `https://raktify.choudhari.ngo/bb?tab=incoming&donor=abc123`

### Fires when

Donor taps 'Accept' on the public `/alert/:token` page and selects this BB.
`routes/donorAlerts.js` writes the `donor_alert_choice` row, then dispatches
this template. Backend `templateType: 'BB_DONOR_INCOMING'`. Recipient is the
BB's `blood_bank.contact_mobile` (or a per-institution notify list if we
add one later).

### Privacy note

Donor identity is shared here because BBs are the point where donation
records are created (they legitimately need to see + verify the donor). This
does NOT violate the hospital-mask rule — hospitals never receive this
template; only BBs do.

### After approval

```
WHATSAPP_TEMPLATE_BB_DONOR_INCOMING=bb_donor_incoming
```

---

## Template 12 · `coord_prefire_warning`

> Fires 15 min before a scheduled donor-alert burst so the coordinator can
> hold, cancel, or let it proceed. English-only.

| Field | Value |
|---|---|
| **Name** | `coord_prefire_warning` |
| **Category** | **Utility** |
| **Languages** | English |
| **Header** | None |
| **Footer** | `Raktify · Coordinator alert · choudhari.ngo` |

### Body

```
Alerts for request *{{1}}* ({{2}}) will fire to donors in *{{3}}*.

If a BB has quietly committed inventory, hold the alert. Otherwise let it fire.

Tap below to review or hold.
```

### Variables

- `{{1}}` — Request short code (e.g. `REQ-A7X9`)
- `{{2}}` — Blood group + component + units (e.g. `2 units O- PRBC`)
- `{{3}}` — Time until fire (e.g. `15 minutes`)

### Buttons

- **One button: Review request**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/coordinator/requests/{{1}}`
  - Sample: `https://raktify.choudhari.ngo/coordinator/requests/abc-123`

### Fires when

Scheduler job (planned) — 15 min before `pending_donor_alerts.scheduled_fire_at`.
Backend `templateType: 'COORD_PREFIRE_WARN'`. Recipient is the assigned
district coordinator's mobile.

### After approval

```
WHATSAPP_TEMPLATE_COORD_PREFIRE_WARN=coord_prefire_warning
```

---

## Template 13 · `coord_critical_new`

> Wakes a district coordinator when a new critical request lands in their
> district — before the matcher has completed. Time-sensitive because the
> coordinator can hand-place the request against inventory they know exists
> that Raktify doesn't. English-only.

| Field | Value |
|---|---|
| **Name** | `coord_critical_new` |
| **Category** | **Utility** |
| **Languages** | English |
| **Header** | None |
| **Footer** | `Raktify · Coordinator alert · choudhari.ngo` |

### Body

```
New critical request in *{{1}}*.

Needs: *{{2}}* by *{{3}}*
From: *{{4}}*

Tap to review. Matching engine is running — you can override, cancel, or hand-place inventory now.
```

### Variables

- `{{1}}` — District / taluka (e.g. `Amravati`)
- `{{2}}` — Blood group + component + units (e.g. `3 units B- PRBC`)
- `{{3}}` — Needed-by datetime (e.g. `18:00 today`)
- `{{4}}` — Requesting facility name (e.g. `Government General Hospital, Amravati`)

### Buttons

- **One button: Review request**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/coordinator/requests/{{1}}`
  - Sample: `https://raktify.choudhari.ngo/coordinator/requests/xyz-789`

### Fires when

Coordinator router (`routes/coordinator.js`) auto-assigns a coordinator to a
new CRITICAL request. Backend `templateType: 'COORD_CRITICAL_NEW'`. Recipient
is the assigned coordinator's mobile.

### After approval

```
WHATSAPP_TEMPLATE_COORD_CRITICAL_NEW=coord_critical_new
```

---

## Template 14 · `community_leader_mobilise`

> Nudges a community leader to broadcast the request to their WhatsApp
> group (Raktify never messages community members directly — the leader
> chooses whom to forward to).

| Field | Value |
|---|---|
| **Name** | `community_leader_mobilise` |
| **Category** | **Utility** |
| **Languages** | English, Marathi, Hindi |
| **Header** | None |
| **Footer** | `Raktify · Community leader alert · choudhari.ngo` |

### Body (English)

```
Hi *{{1}}*, a patient in *{{2}}* urgently needs *{{3}}*.

Tap below to see the shareable poster + WhatsApp text — takes one tap to forward to your community group. Raktify won't message your community members directly.
```

### Body (Marathi)

```
नमस्कार *{{1}}*, *{{2}}* मधील एका रुग्णाला *{{3}}* ची तातडीने गरज आहे.

पोस्टर आणि व्हॉट्सअॅप मजकूर पाहण्यासाठी खाली टॅप करा — तुमच्या कम्युनिटी ग्रुपला एका टॅपमध्ये फॉरवर्ड करा. Raktify तुमच्या कम्युनिटी सदस्यांना थेट संदेश पाठवणार नाही.
```

### Body (Hindi)

```
नमस्ते *{{1}}*, *{{2}}* के एक मरीज़ को *{{3}}* की तत्काल आवश्यकता है।

पोस्टर और व्हाट्सएप टेक्स्ट देखने के लिए नीचे टैप करें — एक टैप से अपने कम्युनिटी ग्रुप में फॉरवर्ड करें। Raktify आपके कम्युनिटी सदस्यों को सीधे संदेश नहीं भेजेगा।
```

### Variables

- `{{1}}` — Community leader name (e.g. `Anita`)
- `{{2}}` — District / taluka (e.g. `Achalpur`)
- `{{3}}` — Blood group + component (e.g. `O+ PRBC, 2 units`)

### Buttons

- **One button: See share toolkit**
  - Type: `URL` (dynamic)
  - URL: `https://raktify.choudhari.ngo/community-leader/mobilise/{{1}}`
  - Sample: `https://raktify.choudhari.ngo/community-leader/mobilise/mob-abc123`

### Fires when

Coordinator marks a request `mobilise_community_leaders=TRUE` (V2 override
button in the coord panel). Backend `templateType:
'COMMUNITY_LEADER_MOBILISE'`. Recipient is the leader whose community's
donor pool overlaps the compatible group set + district.

### After approval

```
WHATSAPP_TEMPLATE_COMMUNITY_LEADER_MOBILISE=community_leader_mobilise
```

---

## V2 batch — submission order (recommended)

Submit **English versions first for all 7** — that's the shared baseline
tests exercise. Add MR + HI for the 4 donor-facing / community-leader-facing
templates in a second batch once the EN ones are approved.

1. `donor_alert_bb_routed` (EN, MR, HI) — highest-impact; blocks V2 alert flow
2. `bb_donor_incoming` (EN) — completes the accept→BB loop
3. `donor_alert_community_first` (EN, MR, HI) — community routing
4. `community_leader_mobilise` (EN, MR, HI) — community amplification
5. `coord_critical_new` (EN) — coord awareness
6. `coord_prefire_warning` (EN) — coord kill-switch
7. `donor_alert_replacement` (EN, MR, HI) — replacement flow (deferred wiring)

**Total submissions:** 4 templates × 3 languages + 3 templates × 1 language = **15 template records**.

## V2 batch — wiring status (as of code merge)

- **Wired now:** `donor_alert_bb_routed` (fired from `donor-alert-gate` when
  a routed alert token exists), `bb_donor_incoming` (fired from
  `routes/donorAlerts.js` on donor accept).
- **Provider handlers exist for all 7** — env keys are read, templates render.
  The remaining 5 templates (`donor_alert_replacement`,
  `donor_alert_community_first`, `coord_prefire_warning`,
  `coord_critical_new`, `community_leader_mobilise`) need small orchestration
  wire-ups (scheduler ticks or override buttons on the coord panel) that
  are follow-up tasks — the notification chokepoint + provider are ready
  the moment those wire-ups land.
