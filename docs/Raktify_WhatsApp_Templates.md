# Raktify — WhatsApp Message Templates

> Six message templates to submit to Meta for review. All are wired into the
> backend's notification chokepoint (`backend/src/services/notifications/`).
> Approval is independent per template + per language; typical review time is
> 1–3 business days. **Submit all of these in one batch — they review in
> parallel.**

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

## Template 6 · `institutional_credentials`

| Field | Value |
|---|---|
| **Name** | `institutional_credentials` |
| **Category** | **Utility** |
| **Languages** | English |
| **Header** | None |
| **Footer** | `Raktify · An initiative of Choudhari Foundation` |

### Body

```
Welcome to Raktify, *{{1}}*! 🩸

Your admin login is ready.

*Email:* {{2}}
*Temporary password:* {{3}}

You'll be asked to change your password on first login.
```

### Variables

- `{{1}}` — Institution display name (e.g. `IGGMC Nagpur`)
- `{{2}}` — Provisioned email (e.g. `iggmc-nagpur@choudhari.ngo`)
- `{{3}}` — Temporary password (e.g. `Xy7-Kn3-Pq9-Ms4`)

### Buttons

- **One button: Open Raktify**
  - Type: `URL` (static)
  - URL: `https://raktify.choudhari.ngo/staff/login`

### Fires when

- eSign webhook fires (`POST /onboarding/mou-signed`) and auto-provisions the institutional admin platform_user row.

> **Security note for v2:** Sending a temporary password over WhatsApp is
> functional but not ideal. A future iteration should replace this with a
> magic-link template (`institutional_setup_link`) that lands the user on a
> one-time-use password-setup page. Spec'd in roadmap Q1 2027.

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
