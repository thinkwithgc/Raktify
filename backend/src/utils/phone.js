/**
 * Indian mobile-number helpers.
 *
 * Format: +91[6-9]XXXXXXXXX (13 chars total).
 * Operators that don't start with 6-9 are landlines / non-mobile and
 * cannot receive SMS or WhatsApp via DLT-registered messaging.
 */
const INDIAN_MOBILE = /^\+91[6-9]\d{9}$/;

function isValidIndianMobile(s) {
  return typeof s === 'string' && INDIAN_MOBILE.test(s);
}

/**
 * Normalise common input variants to the canonical +91XXXXXXXXXX form.
 *   '9876543210'        -> '+919876543210'
 *   '09876543210'       -> '+919876543210'
 *   '919876543210'      -> '+919876543210'
 *   '+919876543210'     -> '+919876543210'
 * Returns null if unparsable as an Indian mobile.
 */
function normaliseIndianMobile(input) {
  if (input == null) return null;
  let s = String(input).trim().replace(/\s+/g, '').replace(/-/g, '');
  if (s.startsWith('+91')) {
    /* keep as-is */
  } else if (s.startsWith('91') && s.length === 12) {
    s = '+' + s;
  } else if (s.startsWith('0') && s.length === 11) {
    s = '+91' + s.slice(1);
  } else if (s.length === 10) {
    s = '+91' + s;
  } else {
    return null;
  }
  return isValidIndianMobile(s) ? s : null;
}

/**
 * Hospital-facing donor-mobile masking (spec §1.2): hospitals never see the
 * full mobile. Show the country code + last 4 digits only.
 *   '+919876543210' -> '+91XXXXX3210'
 */
function maskMobile(s) {
  if (!isValidIndianMobile(s)) return null;
  return '+91XXXXX' + s.slice(-4);
}

module.exports = { isValidIndianMobile, normaliseIndianMobile, maskMobile, INDIAN_MOBILE };
