#!/usr/bin/env node
/**
 * Delete Meta-approved-as-MARKETING template records + resubmit them with
 * utility-tuned copy, aiming for UTILITY classification on the second pass.
 *
 * Which records? Meta's classifier flagged these 7 records as MARKETING even
 * though we submitted them as UTILITY (Meta's NLP is language-sensitive and
 * doesn't always match our intent):
 *
 *   donor_alert_bb_routed         mr, hi         (en is UTILITY, keep)
 *   donor_alert_community_first   en, mr, hi     (all 3 need rework)
 *   community_leader_mobilise     en, mr, hi     (all 3 need rework)
 *   camp_organizer_link           mr             (en + hi are UTILITY, MR just
 *                                                   needs to be resubmitted;
 *                                                   Meta's MR classifier flaked)
 *
 * Rework principles (to bias Meta's NLP toward UTILITY):
 *   • Transaction-anchored language ("a request has been logged for you")
 *   • Direct action language ("Confirm your response")
 *   • Remove emotional appeals + broadcast/community framing
 *   • Recipient-specific data references (name, blood group, distance)
 *   • Avoid promotional CTAs ("see the toolkit", "share widely")
 *
 * Usage:
 *   node scripts/reword_marketing_templates.js               # delete + resubmit
 *   node scripts/reword_marketing_templates.js --dry-run     # print new bodies
 *   node scripts/reword_marketing_templates.js --skip-delete # resubmit only
 *
 * Prereqs: WHATSAPP_ACCESS_TOKEN + WHATSAPP_WABA_ID in .env (or environment).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const SKIP_DELETE = argv.includes('--skip-delete');
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

if (!DRY_RUN && (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_WABA_ID)) {
  console.error('Missing WHATSAPP_ACCESS_TOKEN / WHATSAPP_WABA_ID.');
  process.exit(2);
}

const FOOTER_RAKTIFY = 'Raktify · An initiative of Choudhari Foundation';
const FOOTER_LEADER = 'Raktify · Community leader alert · choudhari.ngo';
const FOOTER_ORGANIZER = 'Raktify · Camp organizer alert · choudhari.ngo';
const BASE_URL = 'https://raktify.choudhari.ngo';

// New utility-tuned bodies + button configs, keyed by (name, language).
const TEMPLATES = [
  // ── donor_alert_bb_routed_v2 (EN + MR + HI) ───────────────────────────
  {
    name: 'donor_alert_bb_routed_v2',
    language: 'en',
    category: 'UTILITY',
    body: `A request for *{{1}}* has been logged at *{{2}}* today ({{3}} km from you).\n\nTap below to confirm your response for this specific request.`,
    body_example: ['B- PRBC', 'Dr. Panjabrao Deshmukh BB, Amravati', '4'],
    footer: FOOTER_RAKTIFY,
    button_url: `${BASE_URL}/alert/{{1}}`,
    button_example: `${BASE_URL}/alert/sample-jwt-token`,
    button_text: 'Confirm response',
  },
  {
    name: 'donor_alert_bb_routed_v2',
    language: 'mr',
    category: 'UTILITY',
    body: `तुमच्या रक्तगटासाठी *{{2}}* येथे विनंती नोंदली आहे: *{{1}}* ({{3}} किमी अंतर).\n\nतुमची उपस्थिती कळवण्यासाठी खालील लिंक टॅप करा. हा संदेश या विशिष्ट विनंतीसाठी आहे.`,
    body_example: ['B- PRBC', 'डॉ. पंजाबराव देशमुख रक्तपेढी, अमरावती', '4'],
    footer: FOOTER_RAKTIFY,
    button_url: `${BASE_URL}/alert/{{1}}`,
    button_example: `${BASE_URL}/alert/sample-jwt-token`,
    button_text: 'प्रतिसाद कळवा',
  },
  {
    name: 'donor_alert_bb_routed_v2',
    language: 'hi',
    category: 'UTILITY',
    body: `आपके रक्त समूह के लिए *{{2}}* पर एक अनुरोध दर्ज हुआ है: *{{1}}* ({{3}} किमी दूर)।\n\nअपनी उपस्थिति की पुष्टि करने के लिए नीचे लिंक टैप करें। यह संदेश इस विशिष्ट अनुरोध के लिए है।`,
    body_example: ['B- PRBC', 'डॉ. पंजाबराव देशमुख ब्लड बैंक, अमरावती', '4'],
    footer: FOOTER_RAKTIFY,
    button_url: `${BASE_URL}/alert/{{1}}`,
    button_example: `${BASE_URL}/alert/sample-jwt-token`,
    button_text: 'प्रतिक्रिया दें',
  },

  // ── donor_alert_community_first (EN + MR + HI) ─────────────────────────
  {
    name: 'donor_alert_community_first_v2',
    language: 'en',
    category: 'UTILITY',
    body: `Hi *{{1}}*, an alert for *{{3}}* has been logged in *{{4}}* today. You are on the priority responder list because of your registered affiliation with *{{2}}*.\n\nTap below to confirm your response for this specific request.`,
    body_example: ['Ramesh', 'Anita Kale', 'O+ PRBC', 'Amravati Rural'],
    footer: FOOTER_LEADER,
    button_url: `${BASE_URL}/alert/{{1}}`,
    button_example: `${BASE_URL}/alert/sample-comm-token`,
    button_text: 'Confirm response',
  },
  {
    name: 'donor_alert_community_first_v2',
    language: 'mr',
    category: 'UTILITY',
    body: `नमस्कार *{{1}}*, आज *{{4}}* मध्ये *{{3}}* साठी एक विनंती नोंदली आहे. *{{2}}* यांच्या कम्युनिटीशी संलग्न असल्यामुळे तुम्ही प्राधान्य यादीत आहात.\n\nया विनंतीसाठी तुमचा प्रतिसाद कळवण्यासाठी खालील लिंक टॅप करा.`,
    body_example: ['रमेश', 'अनिता काळे', 'O+ PRBC', 'अमरावती ग्रामीण'],
    footer: FOOTER_LEADER,
    button_url: `${BASE_URL}/alert/{{1}}`,
    button_example: `${BASE_URL}/alert/sample-comm-token`,
    button_text: 'प्रतिसाद कळवा',
  },
  {
    name: 'donor_alert_community_first_v2',
    language: 'hi',
    category: 'UTILITY',
    body: `नमस्ते *{{1}}*, आज *{{4}}* में *{{3}}* के लिए एक अनुरोध दर्ज हुआ है। *{{2}}* की कम्युनिटी से संबद्ध होने के कारण आप प्राथमिकता सूची में हैं।\n\nइस विशिष्ट अनुरोध के लिए अपना उत्तर देने हेतु नीचे टैप करें।`,
    body_example: ['रमेश', 'अनीता काले', 'O+ PRBC', 'अमरावती ग्रामीण'],
    footer: FOOTER_LEADER,
    button_url: `${BASE_URL}/alert/{{1}}`,
    button_example: `${BASE_URL}/alert/sample-comm-token`,
    button_text: 'प्रतिक्रिया दें',
  },

  // ── community_leader_mobilise (EN + MR + HI) ───────────────────────────
  {
    name: 'community_leader_mobilise_v2',
    language: 'en',
    category: 'UTILITY',
    body: `Hi *{{1}}*, a request for *{{3}}* has been logged in *{{2}}* today and assigned to your community for mobilisation.\n\nTap below to open the request in your community leader dashboard. Your assignment reference is in the URL.`,
    body_example: ['Anita', 'Achalpur', 'O+ PRBC, 2 units'],
    footer: FOOTER_LEADER,
    button_url: `${BASE_URL}/community-leader/mobilise/{{1}}`,
    button_example: `${BASE_URL}/community-leader/mobilise/sample-token`,
    button_text: 'Open assignment',
  },
  {
    name: 'community_leader_mobilise_v2',
    language: 'mr',
    category: 'UTILITY',
    body: `नमस्कार *{{1}}*, आज *{{2}}* मध्ये *{{3}}* साठी एक विनंती नोंदली आहे आणि तुमच्या कम्युनिटीला नियुक्त केली आहे.\n\nतुमच्या कम्युनिटी लीडर डॅशबोर्डवर विनंती पाहण्यासाठी खालील लिंक टॅप करा. तुमचा नियुक्ती संदर्भ URL मध्ये आहे.`,
    body_example: ['अनिता', 'अचलपूर', 'O+ PRBC, 2 युनिट'],
    footer: FOOTER_LEADER,
    button_url: `${BASE_URL}/community-leader/mobilise/{{1}}`,
    button_example: `${BASE_URL}/community-leader/mobilise/sample-token`,
    button_text: 'नियुक्ती उघडा',
  },
  {
    name: 'community_leader_mobilise_v2',
    language: 'hi',
    category: 'UTILITY',
    body: `नमस्ते *{{1}}*, आज *{{2}}* में *{{3}}* के लिए एक अनुरोध दर्ज हुआ है और आपकी कम्युनिटी को सौंपा गया है।\n\nअपने कम्युनिटी लीडर डैशबोर्ड में अनुरोध देखने के लिए नीचे टैप करें। आपका असाइनमेंट संदर्भ URL में है।`,
    body_example: ['अनीता', 'अचलपुर', 'O+ PRBC, 2 यूनिट'],
    footer: FOOTER_LEADER,
    button_url: `${BASE_URL}/community-leader/mobilise/{{1}}`,
    button_example: `${BASE_URL}/community-leader/mobilise/sample-token`,
    button_text: 'असाइनमेंट खोलें',
  },

  // ── camp_organizer_link_v2 (EN + HI + MR — full replacement) ──────────
  {
    name: 'camp_organizer_link_v2',
    language: 'en',
    category: 'UTILITY',
    body: `Hi *{{1}}*, your organizer access for camp *{{2}}* is ready.\n\nTap below to track registrations and prepare for the day. This link is specific to you.`,
    body_example: ['Sushil Patil', 'Blood donation camp - Amravati'],
    footer: FOOTER_ORGANIZER,
    button_url: `${BASE_URL}/camp/{{1}}`,
    button_example: `${BASE_URL}/camp/sample-token`,
    button_text: 'Open dashboard',
  },
  {
    name: 'camp_organizer_link_v2',
    language: 'hi',
    category: 'UTILITY',
    body: `नमस्ते *{{1}}*, आपके द्वारा आयोजित *{{2}}* शिविर के लिए आपका प्रवेश तैयार है।\n\nपंजीकरण ट्रैक करने और दिन की तैयारी के लिए नीचे लिंक टैप करें। यह लिंक आपके लिए विशिष्ट है।`,
    body_example: ['सुशील पाटिल', 'रक्तदान शिविर - अमरावती'],
    footer: FOOTER_ORGANIZER,
    button_url: `${BASE_URL}/camp/{{1}}`,
    button_example: `${BASE_URL}/camp/sample-token`,
    button_text: 'डैशबोर्ड खोलें',
  },
  {
    name: 'camp_organizer_link_v2',
    language: 'mr',
    category: 'UTILITY',
    body: `नमस्कार *{{1}}*, तुम्ही आयोजित केलेल्या *{{2}}* शिबिरासाठी तुमचा प्रवेश तयार आहे.\n\nरजिस्ट्रेशन ट्रॅक करण्यासाठी आणि दिवसाची तयारी करण्यासाठी खालील लिंक टॅप करा. हा दुवा तुम्हाला विशिष्ट आहे.`,
    body_example: ['सुशिल पाटील', 'रक्तदान शिबिर - अमरावती'],
    footer: FOOTER_ORGANIZER,
    button_url: `${BASE_URL}/camp/{{1}}`,
    button_example: `${BASE_URL}/camp/sample-token`,
    button_text: 'डॅशबोर्ड उघडा',
  },
];

function buildComponents(t) {
  const components = [
    { type: 'BODY', text: t.body, example: { body_text: [t.body_example] } },
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
  return components;
}

async function listExisting() {
  const url = `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_WABA_ID}/message_templates?fields=id,name,language,category,status&limit=200`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });
  const j = await res.json();
  if (j.error) throw new Error(`Meta list: ${j.error.message}`);
  return j.data || [];
}

async function deleteTemplateById(id, name) {
  // Meta's delete endpoint lives on the WABA, not the template itself. Pass
  // hsm_id to delete only ONE language variant (leaves other langs intact).
  const params = new URLSearchParams({ hsm_id: id, name });
  const url =
    `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_WABA_ID}/message_templates?` +
    params.toString();
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: j };
}

async function submitOne(t) {
  const url = `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_WABA_ID}/message_templates`;
  const payload = {
    name: t.name,
    language: t.language,
    category: t.category,
    components: buildComponents(t),
  };
  if (DRY_RUN) {
    console.log(`— DRY-RUN — ${t.name} (${t.language}) — new body:`);
    console.log(t.body);
    console.log('');
    return { ok: true, dry: true };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: j };
}

(async () => {
  console.log(
    `${DRY_RUN ? 'DRY-RUN. ' : ''}${TEMPLATES.length} records to rework ` +
      `(${SKIP_DELETE ? 'skipping delete' : 'delete + resubmit'}).\n`,
  );

  let existing = [];
  if (!DRY_RUN && !SKIP_DELETE) {
    existing = await listExisting();
  }

  let deleted = 0;
  let submitted = 0;
  let failed = 0;

  for (const t of TEMPLATES) {
    process.stdout.write(`  ${t.name} (${t.language}) `);

    if (!DRY_RUN && !SKIP_DELETE) {
      const rec = existing.find(
        (e) => e.name === t.name && e.language === t.language,
      );
      if (rec) {
        const d = await deleteTemplateById(rec.id, t.name);
        if (d.ok) {
          process.stdout.write('deleted → ');
          deleted++;
        } else {
          process.stdout.write(`delete failed (${d.status}) → `);
        }
      } else {
        process.stdout.write('(not found) → ');
      }
    }

    const s = await submitOne(t);
    if (s.ok) {
      console.log(s.dry ? '(dry-run)' : `✓ ${s.body?.status || 'submitted'}`);
      submitted++;
    } else {
      const err = s.body?.error || {};
      console.log(
        `✗ HTTP ${s.status}: ${err.message || 'unknown'}` +
          (err.error_user_msg ? ` — ${err.error_user_msg}` : '') +
          (err.error_subcode ? ` (subcode ${err.error_subcode})` : ''),
      );
      failed++;
    }
  }

  console.log(
    `\nDone. deleted=${deleted} submitted=${submitted} failed=${failed}.`,
  );
  console.log(
    'Next: check WhatsApp Manager in ~10 min. Meta usually reviews ' +
      'utility-classification changes in <24h.',
  );
  process.exit(failed);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
