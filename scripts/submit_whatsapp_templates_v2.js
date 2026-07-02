#!/usr/bin/env node
/**
 * Submit the V2 donor-alert-gate WhatsApp templates to Meta for review.
 *
 * Uses the Meta Graph API:
 *   POST https://graph.facebook.com/<version>/<waba_id>/message_templates
 *
 * Reads creds from process.env:
 *   WHATSAPP_ACCESS_TOKEN   (System User token with whatsapp_business_management)
 *   WHATSAPP_WABA_ID        (WhatsApp Business Account id)
 *   WHATSAPP_API_VERSION    (optional, default v21.0)
 *
 * Also honours .env via dotenv (same file the backend reads).
 *
 * Usage:
 *   # Submit ALL 15 template records (7 templates x 3 langs for donor/leader
 *   # templates, 1 lang for BB/coord templates):
 *   node scripts/submit_whatsapp_templates_v2.js
 *
 *   # Dry-run: print the payloads without POSTing
 *   node scripts/submit_whatsapp_templates_v2.js --dry-run
 *
 *   # Submit a subset by name (comma-separated, matches Meta template name)
 *   node scripts/submit_whatsapp_templates_v2.js --only donor_alert_bb_routed,bb_donor_incoming
 *
 *   # Submit only specific languages (default: all supported for each template)
 *   node scripts/submit_whatsapp_templates_v2.js --lang en
 *
 * On success each submission returns Meta's { id, status } — Meta typically
 * queues them in APPROVED / PENDING / REJECTED asynchronously; check
 * WhatsApp Manager → Message templates for the final state.
 *
 * Behaviour on individual failure: prints the error and keeps going with the
 * next template. Exit code = number of failures.
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
function argOf(flag) {
  const i = argv.indexOf(flag);
  return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
}
const ONLY = argOf('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
const LANG_FILTER = argOf('--lang')?.split(',').map((s) => s.trim()).filter(Boolean);

const {
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_WABA_ID,
  WHATSAPP_API_VERSION = 'v21.0',
} = process.env;

if (!DRY_RUN) {
  const missing = [];
  if (!WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!WHATSAPP_WABA_ID) missing.push('WHATSAPP_WABA_ID');
  if (missing.length) {
    console.error(
      `Missing env vars: ${missing.join(', ')}.\n` +
        `Add them to .env (or export before running).\n` +
        `Pass --dry-run to print payloads without POSTing.`,
    );
    process.exit(2);
  }
}

const FOOTER_RAKTIFY = 'Raktify · An initiative of Choudhari Foundation';
const FOOTER_LEADER = 'Raktify · Community leader alert · choudhari.ngo';
const FOOTER_COORD = 'Raktify · Coordinator alert · choudhari.ngo';
const FOOTER_BB = 'Raktify · Blood bank alert · choudhari.ngo';
const ACTIVATION_BASE = 'https://raktify.choudhari.ngo';

// One entry per template + language variant. Meta submits each language as
// its own record. `example` values are what Meta shows during review — use
// realistic-but-fake data.
const TEMPLATES = [
  // ── 8. donor_alert_bb_routed (EN/MR/HI) ────────────────────────────────
  {
    name: 'donor_alert_bb_routed',
    category: 'UTILITY',
    language: 'en',
    body: `A patient needs *{{1}}* blood at *{{2}}* today. That's about *{{3}} km* from you.\n\nTap below to confirm you can donate. If you can't, please tap 'not this time' so we can find someone else.`,
    body_example: ['B- PRBC', 'Dr. Panjabrao Deshmukh BB, Amravati', '4'],
    footer: FOOTER_RAKTIFY,
    button_url: `${ACTIVATION_BASE}/alert/{{1}}`,
    button_example: `${ACTIVATION_BASE}/alert/sample-jwt-token-here`,
    button_text: 'Confirm you can donate',
  },
  {
    name: 'donor_alert_bb_routed',
    category: 'UTILITY',
    language: 'mr',
    body: `आज एका रुग्णाला *{{2}}* येथे *{{1}}* रक्ताची गरज आहे. तुमच्यापासून सुमारे *{{3}} किमी*.\n\nरक्तदान करू शकत असल्यास खाली टॅप करा. जमत नसल्यास 'यावेळी नाही' दाबा जेणेकरून आम्ही दुसरा दाता शोधू.`,
    body_example: ['B- PRBC', 'डॉ. पंजाबराव देशमुख रक्तपेढी, अमरावती', '4'],
    footer: FOOTER_RAKTIFY,
    button_url: `${ACTIVATION_BASE}/alert/{{1}}`,
    button_example: `${ACTIVATION_BASE}/alert/sample-jwt-token-here`,
    button_text: 'रक्तदान करा',
  },
  {
    name: 'donor_alert_bb_routed',
    category: 'UTILITY',
    language: 'hi',
    body: `आज एक मरीज़ को *{{2}}* पर *{{1}}* रक्त की आवश्यकता है। आपसे लगभग *{{3}} किमी* दूर।\n\nरक्तदान कर सकते हैं तो नीचे टैप करें। नहीं कर सकते तो 'इस बार नहीं' दबाएँ ताकि हम दूसरा दाता ढूँढ सकें।`,
    body_example: ['B- PRBC', 'डॉ. पंजाबराव देशमुख ब्लड बैंक, अमरावती', '4'],
    footer: FOOTER_RAKTIFY,
    button_url: `${ACTIVATION_BASE}/alert/{{1}}`,
    button_example: `${ACTIVATION_BASE}/alert/sample-jwt-token-here`,
    button_text: 'रक्तदान करें',
  },

  // ── 9. donor_alert_replacement (EN/MR/HI) ──────────────────────────────
  {
    name: 'donor_alert_replacement',
    category: 'UTILITY',
    language: 'en',
    body: `Hi *{{1}}*, a patient at *{{2}}* has received *{{3}}* today. The blood bank asks for a replacement donation to keep stock balanced within *{{4}}*.\n\nTap below to confirm. Your donation replaces the unit and keeps supply stable for the next patient.`,
    body_example: ['Ramesh', 'Irwin Hospital BB, Amravati', '1 unit of B- PRBC', '72 hours'],
    footer: FOOTER_RAKTIFY,
    button_url: `${ACTIVATION_BASE}/alert/{{1}}`,
    button_example: `${ACTIVATION_BASE}/alert/sample-repl-token`,
    button_text: 'Confirm replacement donation',
  },
  {
    name: 'donor_alert_replacement',
    category: 'UTILITY',
    language: 'mr',
    body: `नमस्कार *{{1}}*, आज *{{2}}* येथील एका रुग्णाला *{{3}}* देण्यात आले आहे. रक्तपेढी *{{4}}* च्या आत बदली रक्तदान मागत आहे.\n\nपुष्टी करण्यासाठी खाली टॅप करा. तुमचे दान त्या युनिटची पूर्तता करते आणि पुरवठा स्थिर ठेवते.`,
    body_example: ['रमेश', 'इर्विन हॉस्पिटल रक्तपेढी, अमरावती', 'B- PRBC चा 1 युनिट', '72 तास'],
    footer: FOOTER_RAKTIFY,
    button_url: `${ACTIVATION_BASE}/alert/{{1}}`,
    button_example: `${ACTIVATION_BASE}/alert/sample-repl-token`,
    button_text: 'बदली दान करा',
  },
  {
    name: 'donor_alert_replacement',
    category: 'UTILITY',
    language: 'hi',
    body: `नमस्ते *{{1}}*, आज *{{2}}* के एक मरीज़ को *{{3}}* दिया गया है। ब्लड बैंक *{{4}}* के भीतर प्रतिस्थापन दान की ज़रूरत बता रहा है।\n\nपुष्टि करने के लिए नीचे टैप करें। आपका दान उस यूनिट की भरपाई करता है और अगले मरीज़ के लिए आपूर्ति स्थिर रखता है।`,
    body_example: ['रमेश', 'इर्विन हॉस्पिटल ब्लड बैंक, अमरावती', 'B- PRBC की 1 यूनिट', '72 घंटे'],
    footer: FOOTER_RAKTIFY,
    button_url: `${ACTIVATION_BASE}/alert/{{1}}`,
    button_example: `${ACTIVATION_BASE}/alert/sample-repl-token`,
    button_text: 'प्रतिस्थापन दान',
  },

  // ── 10. donor_alert_community_first (EN/MR/HI) ─────────────────────────
  {
    name: 'donor_alert_community_first',
    category: 'UTILITY',
    language: 'en',
    body: `Hi *{{1}}*, your community leader *{{2}}* is looking for *{{3}}* donors for a patient in *{{4}}* today.\n\nTap below to confirm you can donate. This alert is going to your community first — before Raktify widens the search.`,
    body_example: ['Ramesh', 'Anita Kale', 'O+ PRBC', 'Amravati Rural'],
    footer: FOOTER_LEADER,
    button_url: `${ACTIVATION_BASE}/alert/{{1}}`,
    button_example: `${ACTIVATION_BASE}/alert/sample-comm-token`,
    button_text: 'Confirm you can donate',
  },
  {
    name: 'donor_alert_community_first',
    category: 'UTILITY',
    language: 'mr',
    body: `नमस्कार *{{1}}*, आज *{{4}}* मधील एका रुग्णासाठी तुमचे कम्युनिटी लीडर *{{2}}* *{{3}}* दात्यांचा शोध घेत आहेत.\n\nरक्तदान करू शकत असल्यास खाली टॅप करा. हा अलर्ट प्रथम तुमच्या कम्युनिटीला जात आहे — त्यानंतर Raktify शोध विस्तृत करेल.`,
    body_example: ['रमेश', 'अनिता काळे', 'O+ PRBC', 'अमरावती ग्रामीण'],
    footer: FOOTER_LEADER,
    button_url: `${ACTIVATION_BASE}/alert/{{1}}`,
    button_example: `${ACTIVATION_BASE}/alert/sample-comm-token`,
    button_text: 'रक्तदान करा',
  },
  {
    name: 'donor_alert_community_first',
    category: 'UTILITY',
    language: 'hi',
    body: `नमस्ते *{{1}}*, आज *{{4}}* के एक मरीज़ के लिए आपके कम्युनिटी लीडर *{{2}}* *{{3}}* दाताओं की तलाश में हैं।\n\nरक्तदान कर सकते हैं तो नीचे टैप करें। यह अलर्ट पहले आपकी कम्युनिटी को जा रहा है — उसके बाद Raktify खोज बढ़ाएगा।`,
    body_example: ['रमेश', 'अनीता काले', 'O+ PRBC', 'अमरावती ग्रामीण'],
    footer: FOOTER_LEADER,
    button_url: `${ACTIVATION_BASE}/alert/{{1}}`,
    button_example: `${ACTIVATION_BASE}/alert/sample-comm-token`,
    button_text: 'रक्तदान करें',
  },

  // ── 11. bb_donor_incoming (EN only) ────────────────────────────────────
  {
    name: 'bb_donor_incoming',
    category: 'UTILITY',
    language: 'en',
    body: `A donor has accepted an alert and is coming to your bank.\n\nDonor: *{{1}}* ({{2}})\nFor: *{{3}}*\nExpected arrival: *{{4}}*\n\nOpen the Incoming Donors tab to review, mark arrived, or defer.`,
    body_example: ['Ramesh Patil', 'B-', 'REQ-A7X9', 'within 2 hours'],
    footer: FOOTER_BB,
    button_url: `${ACTIVATION_BASE}/bb?tab=incoming&donor={{1}}`,
    button_example: `${ACTIVATION_BASE}/bb?tab=incoming&donor=sample-donor-id`,
    button_text: 'Open Incoming Donors',
  },

  // ── 12. coord_prefire_warning (EN only) ────────────────────────────────
  {
    name: 'coord_prefire_warning',
    category: 'UTILITY',
    language: 'en',
    body: `Alerts for request *{{1}}* ({{2}}) will fire to donors in *{{3}}*.\n\nIf a BB has quietly committed inventory, hold the alert. Otherwise let it fire.\n\nTap below to review or hold.`,
    body_example: ['REQ-A7X9', '2 units O- PRBC', '15 minutes'],
    footer: FOOTER_COORD,
    button_url: `${ACTIVATION_BASE}/coordinator/requests/{{1}}`,
    button_example: `${ACTIVATION_BASE}/coordinator/requests/sample-request-id`,
    button_text: 'Review request',
  },

  // ── 13. coord_critical_new (EN only) ───────────────────────────────────
  {
    name: 'coord_critical_new',
    category: 'UTILITY',
    language: 'en',
    body: `New critical request in *{{1}}*.\n\nNeeds: *{{2}}* by *{{3}}*\nFrom: *{{4}}*\n\nTap to review. Matching engine is running — you can override, cancel, or hand-place inventory now.`,
    body_example: ['Amravati', '3 units B- PRBC', '18:00 today', 'Government General Hospital, Amravati'],
    footer: FOOTER_COORD,
    button_url: `${ACTIVATION_BASE}/coordinator/requests/{{1}}`,
    button_example: `${ACTIVATION_BASE}/coordinator/requests/sample-request-id`,
    button_text: 'Review request',
  },

  // ── 14. community_leader_mobilise (EN/MR/HI) ───────────────────────────
  {
    name: 'community_leader_mobilise',
    category: 'UTILITY',
    language: 'en',
    body: `Hi *{{1}}*, a patient in *{{2}}* urgently needs *{{3}}*.\n\nTap below to see the shareable poster + WhatsApp text — takes one tap to forward to your community group. Raktify won't message your community members directly.`,
    body_example: ['Anita', 'Achalpur', 'O+ PRBC, 2 units'],
    footer: FOOTER_LEADER,
    button_url: `${ACTIVATION_BASE}/community-leader/mobilise/{{1}}`,
    button_example: `${ACTIVATION_BASE}/community-leader/mobilise/sample-token`,
    button_text: 'See share toolkit',
  },
  {
    name: 'community_leader_mobilise',
    category: 'UTILITY',
    language: 'mr',
    body: `नमस्कार *{{1}}*, *{{2}}* मधील एका रुग्णाला *{{3}}* ची तातडीने गरज आहे.\n\nपोस्टर आणि व्हॉट्सअॅप मजकूर पाहण्यासाठी खाली टॅप करा — तुमच्या कम्युनिटी ग्रुपला एका टॅपमध्ये फॉरवर्ड करा. Raktify तुमच्या कम्युनिटी सदस्यांना थेट संदेश पाठवणार नाही.`,
    body_example: ['अनिता', 'अचलपूर', 'O+ PRBC, 2 युनिट'],
    footer: FOOTER_LEADER,
    button_url: `${ACTIVATION_BASE}/community-leader/mobilise/{{1}}`,
    button_example: `${ACTIVATION_BASE}/community-leader/mobilise/sample-token`,
    button_text: 'शेअर टूलकिट',
  },
  {
    name: 'community_leader_mobilise',
    category: 'UTILITY',
    language: 'hi',
    body: `नमस्ते *{{1}}*, *{{2}}* के एक मरीज़ को *{{3}}* की तत्काल आवश्यकता है।\n\nपोस्टर और व्हाट्सएप टेक्स्ट देखने के लिए नीचे टैप करें — एक टैप से अपने कम्युनिटी ग्रुप में फॉरवर्ड करें। Raktify आपके कम्युनिटी सदस्यों को सीधे संदेश नहीं भेजेगा।`,
    body_example: ['अनीता', 'अचलपुर', 'O+ PRBC, 2 यूनिट'],
    footer: FOOTER_LEADER,
    button_url: `${ACTIVATION_BASE}/community-leader/mobilise/{{1}}`,
    button_example: `${ACTIVATION_BASE}/community-leader/mobilise/sample-token`,
    button_text: 'शेयर टूलकिट',
  },
];

function buildPayload(t) {
  const components = [
    {
      type: 'BODY',
      text: t.body,
      example: { body_text: [t.body_example] },
    },
  ];
  if (t.footer) components.push({ type: 'FOOTER', text: t.footer });
  if (t.button_url) {
    components.push({
      type: 'BUTTONS',
      buttons: [
        {
          type: 'URL',
          text: t.button_text,
          url: t.button_url,
          example: [t.button_example],
        },
      ],
    });
  }
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    components,
  };
}

async function submit(t) {
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_WABA_ID}/message_templates`;
  const payload = buildPayload(t);
  if (DRY_RUN) {
    console.log(`— DRY-RUN — ${t.name} (${t.language})`);
    console.log(JSON.stringify(payload, null, 2));
    return { ok: true, dry: true };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: json };
}

(async () => {
  const rows = TEMPLATES.filter(
    (t) =>
      (!ONLY || ONLY.includes(t.name)) &&
      (!LANG_FILTER || LANG_FILTER.includes(t.language)),
  );
  console.log(`Submitting ${rows.length} template records${DRY_RUN ? ' (dry-run)' : ''}...\n`);
  let failed = 0;
  for (const t of rows) {
    process.stdout.write(`  → ${t.name} (${t.language}) `);
    try {
      const r = await submit(t);
      if (r.ok) {
        console.log(r.dry ? '(dry-run)' : `✓ ${r.body?.status || 'submitted'}`);
      } else {
        console.log(`✗ HTTP ${r.status}: ${r.body?.error?.message || 'unknown'}`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ threw: ${err.message}`);
      failed++;
    }
  }
  console.log(`\nDone. ${rows.length - failed}/${rows.length} succeeded.`);
  process.exit(failed);
})();
