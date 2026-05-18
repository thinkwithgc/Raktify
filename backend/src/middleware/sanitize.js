/**
 * Recursive input sanitiser for req.body / req.query / req.params.
 *
 * Spec §10 security checklist: "all user inputs run through DOMPurify (frontend)
 * and a custom sanitizeInput middleware (backend) before database writes."
 *
 * What this middleware does:
 *   1. Trims trailing/leading whitespace from string values
 *   2. Strips ASCII control characters (NUL, BEL, etc.) that have no business
 *      in user input and can corrupt logs / break parameter binding
 *   3. Strips characters that look like script-tag bookends from text fields
 *      (defence-in-depth — the API never renders user HTML, but stored XSS
 *      could surface through a 3rd-party report tool)
 *   4. Caps string length per top-level field to a generous safety bound
 *
 * What it does NOT do:
 *   - Type coercion (Zod handles that)
 *   - SQL escaping (parameterised queries handle that — see eslint rule
 *     `no-template-literal-sql` for enforcement)
 *   - HTML rendering escape (templating engine / React handles that)
 *
 * The middleware fails open on objects it can't handle (Buffer, Date, etc.)
 * and keeps a fixed depth limit to avoid pathological recursion DOS.
 */

const MAX_STRING_LEN = 8000; // generous; legitimate clinical notes fit in <2KB
const MAX_DEPTH = 6;

// Control-character set is the whole point of the sanitizer; the regex is
// intentional.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g;
// Conservative: strip the literal opening tag bookends. We don't try to be a
// full HTML parser — that's what a renderer is for.
const SCRIPT_BOOKENDS = /<\s*\/?\s*(script|iframe|object|embed)\b/gi;

function sanitizeString(s) {
  if (typeof s !== 'string') return s;
  let out = s.replace(CONTROL_CHARS, '');
  out = out.replace(SCRIPT_BOOKENDS, '');
  out = out.trim();
  if (out.length > MAX_STRING_LEN) out = out.slice(0, MAX_STRING_LEN);
  return out;
}

function sanitizeValue(v, depth) {
  if (v == null) return v;
  if (typeof v === 'string') return sanitizeString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth >= MAX_DEPTH) return v;
  if (Array.isArray(v)) {
    return v.map((item) => sanitizeValue(item, depth + 1));
  }
  // Plain object (don't touch class instances like Buffer, Date)
  if (Object.getPrototypeOf(v) === Object.prototype) {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = sanitizeValue(val, depth + 1);
    }
    return out;
  }
  return v;
}

function sanitizeInput(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body, 0);
  }
  if (req.query && typeof req.query === 'object') {
    // req.query is sometimes a null-prototype object in Express 5; we copy
    // values but keep the same reference shape.
    for (const k of Object.keys(req.query)) {
      req.query[k] = sanitizeValue(req.query[k], 0);
    }
  }
  if (req.params && typeof req.params === 'object') {
    for (const k of Object.keys(req.params)) {
      req.params[k] = sanitizeValue(req.params[k], 0);
    }
  }
  next();
}

module.exports = { sanitizeInput, sanitizeString };
