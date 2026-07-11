/**
 * Donor pre-screening evaluator.
 *
 * CLINICAL DATA — SIGNED OFF (Medical Review Document, 10-Jul-2026).
 *
 * The permanent-exclusion and temporary-deferral sets below carry the
 * haematologist's confirmed values. Note (advisor Q2): there is NO
 * disease-free exception for cancer, and epilepsy-on-medication is a
 * universal permanent exclusion — both encoded here.
 *
 * AUTHORITY BOUNDARY: this pre-screen is a soft, donor-facing filter. The
 * binding patient-safety gate lives in the database — the donation gap is
 * enforced gender-aware by `fn_donations_update_donor_eligibility` +
 * `blood_components.min_gap_days{,_female}`, and Hb / weight / deferral are
 * validated at collection time in `services/donations/validate.js`. This
 * module never overrides those; a YES here steers the UI, it does not write
 * clinical state.
 *
 * The temporary *_days are operational floors; the blood bank may lengthen a
 * deferral at the chair after assessing the specific cause (e.g. which drug,
 * which vaccine, extent of surgery).
 */

const DRAFT_PENDING_REVIEW = false;

// Permanent exclusions — ANY YES → decline. Confirmed advisor Q2/Q3.
const PERMANENT_QUESTIONS = [
  { id: 'PE1', en: 'Have you ever tested positive for HIV / Hepatitis B / Hepatitis C?' },
  { id: 'PE2', en: 'Do you have a history of cancer? (no disease-free exception)' },
  {
    id: 'PE3',
    en: 'Have you ever had heart disease, insulin-requiring diabetes, or epilepsy on medication?',
  },
  { id: 'PE4', en: 'Have you been told you have haemophilia or a bleeding disorder?' },
  { id: 'PE5', en: 'Are you currently pregnant or breastfeeding (under 12 months postpartum)?' },
  { id: 'PE6', en: 'Have you ever injected recreational drugs?' },
  { id: 'PE7', en: 'Have you ever had a major organ transplant?' },
  { id: 'PE8', en: 'Have you been told you have any chronic infectious illness?' },
];

// Temporary deferrals — each carries its own deferral floor (days). Values
// confirmed by the medical advisor (Q1/Q3). A deferral_days of 0 means the
// answer is a flag for blood-bank assessment, not an automatic wait.
const TEMPORARY_QUESTIONS = [
  { id: 'TD_ALCOHOL', en: 'Have you consumed alcohol in the last 48 hours?', deferral_days: 2 },
  {
    id: 'TD_FEVER',
    en: 'Have you had fever, cold or flu recently? (defer until symptoms fully subside)',
    deferral_days: 7,
  },
  {
    id: 'TD_TATTOO',
    en: 'Have you had a tattoo or piercing in the last 6 months?',
    deferral_days: 180,
  },
  {
    id: 'TD_VACCINE_LIVE',
    en: 'Have you had a LIVE vaccine in the last 28 days? (e.g. MMR, oral polio, yellow fever)',
    deferral_days: 28,
  },
  {
    id: 'TD_VACCINE_INACTIVATED',
    en: 'Have you had any OTHER vaccine in the last 14 days? (e.g. tetanus, flu shot, COVID)',
    deferral_days: 14,
  },
  {
    id: 'TD_DENTAL',
    en: 'Have you had a tooth extraction or major dental work in the last 2 weeks?',
    deferral_days: 14,
  },
  {
    id: 'TD_SURGERY',
    en: 'Have you had any surgery in the last 3 months?',
    deferral_days: 90,
  },
  { id: 'TD_ANTIBIOTICS', en: 'Are you currently on antibiotics?', deferral_days: 14 },
  {
    id: 'TD_MEDICATION',
    en: 'Are you currently taking any prescription medicine? (the blood bank will review it)',
    deferral_days: 0,
  },
  {
    id: 'TD_RECENT_DONATION',
    en: 'Have you donated blood recently? (90 days for men, 120 days for women)',
    deferral_days: 90,
  },
];

function evaluate(answers) {
  // answers shape: { PE1: 'YES'|'NO', ..., TD_ALCOHOL: 'YES'|'NO', ... }
  const permanentBlocks = PERMANENT_QUESTIONS.filter((q) => answers?.[q.id] === 'YES');
  const temporaryHits = TEMPORARY_QUESTIONS.filter((q) => answers?.[q.id] === 'YES');
  const longestDeferral = temporaryHits.reduce((max, q) => Math.max(max, q.deferral_days), 0);

  return {
    permanent_blocks: permanentBlocks.map((q) => q.id),
    temporary_deferrals: temporaryHits.map((q) => ({ id: q.id, days: q.deferral_days })),
    deferral_until_days: longestDeferral || 0,
    eligible: permanentBlocks.length === 0,
    draft: DRAFT_PENDING_REVIEW,
  };
}

module.exports = {
  PERMANENT_QUESTIONS,
  TEMPORARY_QUESTIONS,
  evaluate,
  DRAFT_PENDING_REVIEW,
};
