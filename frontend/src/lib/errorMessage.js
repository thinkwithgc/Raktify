// Plain-English, actionable error messages.
//
// Our users are hospital clerks, blood-bank technicians, coordinators and
// community leaders — often on a phone, often in a hurry, often mid-emergency.
// Showing them `rate_limit_login` or a Postgres SQLSTATE tells them nothing:
// they can't tell whether they did something wrong, whether to wait, or who to
// call. Every message here says WHAT happened, WHAT to do next, and — when it's
// our fault — HOW to report it.

export const SUPPORT_LINE =
  'If this keeps happening, contact Raktify support: contact@choudhari.ngo or +91 98505 41412.';

const MESSAGES = {
  // ── Sign-in ────────────────────────────────────────────────────────────
  rate_limit_login:
    'Too many sign-in attempts from this device. For security we pause sign-ins for 15 minutes — please wait, then try again.',
  rate_limit_otp:
    'Too many OTP requests for this mobile number. Please wait a while before asking for another code.',
  invalid_credentials:
    'That username or password is not correct. Usernames are all lowercase (for example “irwin-hospital_admin”). Check for typos and try again.',
  invalid_totp:
    'That 6-digit code was not accepted. The code changes every 30 seconds — wait for a fresh one and enter it straight away.',
  totp_required:
    'Enter the 6-digit code from your authenticator app to finish signing in.',
  totp_already_enabled: 'Two-factor authentication is already set up on this account.',
  account_locked:
    'This account is temporarily locked after several failed sign-in attempts. Wait for the lock to expire, or ask your NGO admin to reset it.',
  invalid_otp: 'That OTP is not correct or has expired. Request a new code and try again.',
  otp_expired: 'That OTP has expired. Request a new code.',

  // ── Permissions / access ───────────────────────────────────────────────
  forbidden:
    'Your account does not have permission for this action. If you believe it should, ask your NGO admin to check your role.',
  not_a_party_to_request:
    'You are not part of this case, so you cannot open or post in it. Only the requesting hospital, the matched blood bank, and the coordinator can.',
  not_found_or_no_access:
    'This record does not exist, or it has not been shared with your organisation.',
  blood_bank_user_missing_institution:
    'Your account is not linked to a blood bank yet. Ask your NGO admin to link it before using this screen.',
  donor_profile_required:
    'Please complete your donor registration before raising a request — it takes a minute and lets us keep every request accountable.',
  hospital_not_onboarded:
    'That hospital isn’t active on Raktify. Pick one from the list, or use “My hospital isn’t listed” to name it.',
  not_pending_confirmation:
    'This request is no longer awaiting your confirmation — it may already have been confirmed, declined, or cancelled.',

  // ── Input ──────────────────────────────────────────────────────────────
  invalid_input:
    'Some details are missing or not in the expected format. Check the highlighted fields and try again.',
  load_failed: 'We could not load this screen just now. Please try again in a moment.',
};

// Postgres SQLSTATEs occasionally reach the client on an unhandled server error.
// Never show the raw code — it means nothing to a technician.
const LOOKS_LIKE_SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Turn an axios/fetch error (or a raw code) into something a human can act on.
 * @param {unknown} err   the caught error
 * @param {string} [what] what was being attempted, e.g. 'load the open requests'
 */
export function errorMessage(err, what) {
  // No response at all → almost always the network, not the user.
  if (err && err.request && !err.response) {
    return `Cannot reach Raktify — please check your internet connection and try again. ${SUPPORT_LINE}`;
  }

  const status = err?.response?.status;
  const code = typeof err === 'string' ? err : err?.response?.data?.error;

  if (code && MESSAGES[code]) return MESSAGES[code];

  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return MESSAGES.forbidden;
  if (status === 404) return MESSAGES.not_found_or_no_access;
  if (status === 429) return MESSAGES.rate_limit_login;

  // Server-side failure, or an unrecognised/raw code (including SQLSTATEs).
  // Make it explicit this is not the user's fault, and give them a reference
  // they can quote when reporting it.
  const ref = code && LOOKS_LIKE_SQLSTATE.test(code) ? code : status ? `HTTP ${status}` : code;
  const task = what ? ` while trying to ${what}` : '';
  return `Something went wrong on our side${task} — this is not caused by anything you did. Please try again shortly. ${SUPPORT_LINE}${
    ref ? ` Quote reference: ${ref}.` : ''
  }`;
}
