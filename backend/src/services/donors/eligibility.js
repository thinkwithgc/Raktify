/**
 * Donor pre-screening evaluator.
 *
 * ⚠ CLINICAL DATA — PENDING MEDICAL ADVISOR SIGN-OFF ⚠
 *
 * The 8 permanent-exclusion questions and the temporary-deferral question
 * set are clinical decisions that must be confirmed in writing by the
 * haematologist before this module is wired into the live registration
 * flow.
 *
 * Until sign-off:
 *   - This module exposes the full QUESTION_BANK with provisional copy
 *     drawn from spec §5 + the Master Prompt, all marked DRAFT.
 *   - The evaluate() function returns the structural answer (which
 *     questions a YES would block on) but is not authoritative for
 *     real registrations.
 *   - The /donors/register route does NOT invoke this evaluator yet —
 *     it accepts the raw answers and stores them on a TODO field.
 *
 * Once the medical advisor confirms:
 *   1. Replace QUESTION_BANK with the signed-off version
 *   2. Drop the DRAFT_PENDING_REVIEW flag
 *   3. Wire evaluate() into /donors/register at Step 1 (pre-screening)
 *      and Step 3 (temporary-deferral)
 *   4. Add an integration test that exercises each question
 */

const DRAFT_PENDING_REVIEW = true;

// Spec §5 step 1 — permanent exclusions. ANY YES → soft decline.
const PERMANENT_QUESTIONS = [
  { id: 'PE1', en: 'Have you ever tested positive for HIV / Hepatitis B / Hepatitis C?' },
  { id: 'PE2', en: 'Do you have a history of cancer (under treatment)?' },
  { id: 'PE3', en: 'Have you ever had heart disease, diabetes requiring insulin, or epilepsy?' },
  { id: 'PE4', en: 'Have you been told you have haemophilia or a bleeding disorder?' },
  { id: 'PE5', en: 'Are you currently pregnant or breastfeeding (under 12 months postpartum)?' },
  { id: 'PE6', en: 'Have you ever injected recreational drugs?' },
  { id: 'PE7', en: 'Have you ever had a major organ transplant?' },
  { id: 'PE8', en: 'Have you been told you have any chronic infectious illness?' },
];

// Spec §5 step 3 — temporary deferrals. Each carries its own deferral days.
// The *_days values are CLINICAL and must be confirmed by the medical advisor.
const TEMPORARY_QUESTIONS = [
  { id: 'TD_ALCOHOL', en: 'Have you consumed alcohol in the last 48 hours?', deferral_days: 2 },
  { id: 'TD_FEVER', en: 'Have you had fever in the last 7 days?', deferral_days: 7 },
  {
    id: 'TD_TATTOO',
    en: 'Have you had a tattoo or piercing in the last 6 months?',
    deferral_days: 180,
  },
  {
    id: 'TD_VACCINATION',
    en: 'Have you received any vaccination in the last 14 days?',
    deferral_days: 14,
  },
  { id: 'TD_DENTAL', en: 'Have you had dental work in the last 7 days?', deferral_days: 7 },
  { id: 'TD_ANTIBIOTICS', en: 'Are you currently on antibiotics?', deferral_days: 14 },
  {
    id: 'TD_RECENT_DONATION',
    en: 'Have you donated blood in the last 90 days?',
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
