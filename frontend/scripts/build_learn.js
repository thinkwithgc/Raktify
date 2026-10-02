/**
 * The Knowledge Center: content/learn/*.md -> real static HTML in dist/.
 *
 * WHAT THIS IS FOR
 * ================
 * docs/Raktify_V2_Growth_Plan.md §2 specifies a maintained public reference
 * library ("India's maintained blood encyclopedia, not a blog"). Before this
 * script there was no /learn at all: the URL returned the SPA shell, React
 * Router's catch-all redirected it to the home page, and it answered 200 - a
 * soft 404 at a path the growth plan treats as a pillar.
 *
 * /learn is NOT robots-disallowed (checked: public/robots.txt blocks only the
 * portals and the magic-link paths), so nothing there needs editing. This
 * script adds the pages to the sitemap and to llms.txt itself, in dist/.
 *
 * WHY STATIC HTML AND NOT A REACT ROUTE
 * ====================================
 * A reference article is read once, often by a crawler or an LLM, and never
 * needs the app bundle. Shipping it as a real file means the bytes a crawler
 * receives already contain the whole article - no JS execution, no hydration,
 * and nothing in frontend/src to keep in sync. Same reasoning as the existing
 * public/how-raktify-works.html, whose stylesheet conventions this follows.
 *
 * WHY dist/ AND NOT public/
 * =========================
 * §2.3 says public/learn/<slug>.html. Writing there instead, deliberately:
 *   1. public/ is committed, so every build would dirty the working tree with
 *      generated artefacts and every content edit would land twice in git.
 *   2. vite-plugin-pwa globs public/ into the Workbox precache manifest, so
 *      the whole library would be downloaded by every app visitor who will
 *      never read it - and a precached copy is a copy from an arbitrarily old
 *      build (the 7d1def8 / 26d32bf bug class).
 * The source of truth stays content/learn/*.md; dist/ is output, like
 * scripts/prerender.js already treats it. Both run chained inside
 * `npm run build`, because Oryx invokes that on SWA deploy and cannot be
 * relied on to honour npm lifecycle hooks.
 *
 * THE SERVICE WORKER *DOES* NEED A DENYLIST ENTRY HERE
 * ===================================================
 * Opposite of prerender.js, and the difference matters. A prerendered route is
 * a real React route, so a repeat visitor served the precached shell still
 * sees the right page. /learn is NOT a React route: a shell-answered
 * navigation hits App.jsx's catch-all and silently redirects to the home page.
 * So frontend/vite.config.js carries /^\/learn$/ and /^\/learn\// in
 * navigateFallbackDenylist, exactly as it does for /how-raktify-works.html.
 *
 * CLEAN URLS COST ONE REWRITE PER PAGE
 * ====================================
 * Azure SWA `rewrite` has no capture groups, so /learn/* cannot be mapped to
 * per-slug files by one rule. Every page therefore needs its own route entry
 * in staticwebapp.config.json - and because forgetting one would serve the SPA
 * shell at a URL this script also put in the sitemap, the build ASSERTS that
 * every page it writes has a matching rewrite and fails loudly otherwise.
 * Flat files (learn/faq.html), never directory indexes, because a directory
 * index invites SWA's trailing-slash redirect and a redirect is itself a
 * canonical mismatch.
 *
 * PROVENANCE IS A HARD GATE, NOT A FIELD
 * =====================================
 * CLAUDE.md hard rule 6 and growth-plan §2.1/§2.2: nothing clinical publishes
 * without a named reviewer. An article with `clinical: true` and
 * `status: published` but no `reviewers` FAILS THE BUILD. That is the whole
 * moat - a blood-donation page that is merely plausible is worth less than
 * nothing. Clinical articles therefore sit at `status: draft` until the
 * haematologist's name and credentials are recorded, and flipping one word
 * publishes them.
 *
 * A NOTE ON REGEXES IN THIS FILE
 * ==============================
 * Regex LITERALS only. Do not rewrite one as new RegExp('...') - the string
 * form needs doubled backslashes and this file is edited through tooling that
 * has collapsed them before now, which turns \s into a literal "s" silently.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '..');
const DIST = join(ROOT, 'dist');
const SRC = join(REPO, 'content', 'learn');
const SWA_CONFIG = join(ROOT, 'staticwebapp.config.json');
const LANDING = join(ROOT, 'src', 'pages', 'Landing.jsx');
const ORIGIN = 'https://raktify.choudhari.ngo';
const FOUNDATION = 'Choudhari EduHealth India Foundation';

/** Category order on the hub. An unknown category fails the build. */
const CATEGORIES = [
  ['basics', 'Donation basics'],
  ['groups', 'Blood groups and compatibility'],
  ['types', 'Types of donation'],
  ['conditions', 'Conditions and patients'],
  ['institutions', 'For hospitals and blood banks'],
  ['faq', 'Questions and answers'],
  ['about', 'About this library'],
];

function fail(msg) {
  console.error('build_learn: ' + msg);
  process.exit(1);
}

/** For an HTML attribute value or text node. */
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Front matter: --- fenced, one `key: value` per line, plus block lists
 * written as indented `- item`. A deliberately tiny subset of YAML - adding a
 * parser dependency to read eight scalar fields is not a trade worth making,
 * and anything this cannot express belongs in the body.
 */
function parseFrontMatter(text, file) {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') fail(file + ': must open with a --- front-matter fence');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) fail(file + ': front matter is never closed');

  const meta = {};
  let listKey = null;
  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      meta[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(raw);
    if (!kv) fail(file + ': cannot parse front-matter line: ' + raw);
    const key = kv[1];
    const value = kv[2].trim();
    if (value === '') {
      listKey = key;
      meta[key] = [];
    } else if (value === 'true' || value === 'false') {
      listKey = null;
      meta[key] = value === 'true';
    } else {
      listKey = null;
      meta[key] = unquote(value);
    }
  }
  return { meta, body: lines.slice(end + 1).join('\n') };
}

function unquote(s) {
  const t = s.trim();
  if (t.length > 1 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1);
  if (t.length > 1 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1);
  return t;
}

/* ───────────────────────────── markdown subset ─────────────────────────── */

const BT = String.fromCharCode(96);
const CODE_RE = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');

/**
 * Inline markup. Code first so a backtick span cannot be re-processed, then
 * strong before em (otherwise ** is eaten as two * pairs).
 */
function mdInline(s) {
  return esc(s)
    .replace(CODE_RE, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * The supported block grammar, in full - there is no markdown library here and
 * this list is the contract an article may rely on:
 *
 *   ## / ### / ####    headings (a single # is reserved: the h1 comes from the
 *                      front matter, so an article can never ship two)
 *   - item             unordered list
 *   1. item            ordered list
 *   > quote            callout
 *   | a | b |          table; the ---|--- separator row is optional
 *   ---                horizontal rule
 *   <div>...           a line starting with < at column 0 passes through
 *                      VERBATIM until the next blank line, which is how an
 *                      article gets a styled callout or a hand-built table
 *   anything else      paragraph, consecutive lines joined
 *
 * Deliberately absent: nested lists, reference links, footnotes, inline HTML
 * mid-paragraph. Each needs real parsing, and an article wanting one can drop
 * into a raw HTML block instead.
 */
function md(body, file) {
  const lines = body.split(/\r?\n/);
  const out = [];
  let i = 0;

  const isTable = (l) => l.trim().startsWith('|');
  const isRule = (l) => /^-{3,}\s*$/.test(l.trim());

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (line[0] === '<') {
      const buf = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
      out.push(buf.join('\n'));
      continue;
    }

    const h = /^(#{2,4})\s+(.*)$/.exec(trimmed);
    if (h) {
      const level = h[1].length;
      out.push('<h' + level + '>' + mdInline(h[2]) + '</h' + level + '>');
      i++;
      continue;
    }

    if (isRule(line)) {
      out.push('<hr />');
      i++;
      continue;
    }

    if (isTable(line)) {
      const rows = [];
      while (i < lines.length && isTable(lines[i])) {
        const bar = lines[i].trim();
        if (!/^[\s|:-]+$/.test(bar)) {
          rows.push(
            bar
              .replace(/^\|/, '')
              .replace(/\|$/, '')
              .split('|')
              .map((c) => c.trim()),
          );
        }
        i++;
      }
      if (!rows.length) fail(file + ': a table had no content rows');
      const head = rows.shift();
      const thead = '<tr>' + head.map((c) => '<th>' + mdInline(c) + '</th>').join('') + '</tr>';
      const tbody = rows
        .map((r) => '<tr>' + r.map((c) => '<td>' + mdInline(c) + '</td>').join('') + '</tr>')
        .join('');
      out.push(
        '<div class="tablewrap"><table><thead>' +
          thead +
          '</thead><tbody>' +
          tbody +
          '</tbody></table></div>',
      );
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
        items.push('<li>' + mdInline(lines[i].trim().replace(/^-\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ul>' + items.join('') + '</ul>');
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push('<li>' + mdInline(lines[i].trim().replace(/^\d+\.\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ol>' + items.join('') + '</ol>');
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + mdInline(buf.join(' ')) + '</blockquote>');
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      lines[i][0] !== '<' &&
      !isTable(lines[i]) &&
      !isRule(lines[i]) &&
      !/^(#{2,4}\s|-\s|>|\d+\.\s)/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) out.push('<p>' + mdInline(para.join(' ')) + '</p>');
    else i++;
  }
  return out.join('\n');
}

/* ──────────────────────────── page chrome ──────────────────────────────── */

/**
 * The wordmark, as a same-document <symbol>, extracted from the real SVG file.
 *
 * The locked design rule (CLAUDE.md) is that the wordmark is ALWAYS the vector
 * and is never re-typed as text, because a text approximation drifts with
 * whatever font the renderer happens to have - and these pages get saved,
 * emailed and printed, where a webfont link fails silently.
 *
 * Reading frontend/public/wordmark-tm.svg at build time rather than pasting the
 * paths here is what makes "copied verbatim" true by construction: the artwork
 * cannot drift from the source file because there is only one copy. A
 * same-document <use> prints exactly as it screens, which an external
 * <use href="file.svg#id"> and an <img src> do not.
 */
function wordmarkSprite() {
  const svg = readFileSync(join(ROOT, 'public', 'wordmark-tm.svg'), 'utf8');
  const vb = /viewBox="([^"]+)"/.exec(svg);
  if (!vb) fail('wordmark-tm.svg has no viewBox - cannot build the sprite');
  const open = svg.indexOf('>', svg.indexOf('<svg'));
  const close = svg.lastIndexOf('</svg>');
  if (open === -1 || close === -1 || close < open) fail('wordmark-tm.svg is not parseable');
  const inner = svg.slice(open + 1, close).trim();
  if (!inner.includes('<path')) fail('wordmark-tm.svg yielded no paths');
  return (
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">' +
    '<symbol id="rk-wordmark" viewBox="' +
    vb[1] +
    '">' +
    inner +
    '</symbol></svg>'
  );
}

/**
 * Tokens and layout, copied from public/how-raktify-works.html so the library
 * reads as the same site. Font stack is 'Segoe UI'/system-ui on purpose - see
 * wordmarkSprite() above for why a webfont is not wanted on these pages.
 *
 * Only the tokens actually used here are carried over; the role colours
 * (--hospital, --coord, ...) belong to that page's diagrams.
 */
const CSS = [
  ":root{--rk:#b8231a;--ink:#1a1a1a;--ink-2:#44403c;--ink-3:#78716c;",
  "--muted:#64748b;--line:#e2e8f0;--cream:#fdf8f4;--sand:#f5ece4;}",
  "*{box-sizing:border-box}",
  "body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:var(--ink);",
  "margin:0;background:#fff;line-height:1.65;-webkit-text-size-adjust:100%}",
  ".skip{position:absolute;left:-9999px}",
  ".skip:focus{left:8px;top:8px;z-index:9;background:#fff;padding:8px 12px;border:2px solid var(--rk)}",
  ".topbar{border-bottom:1px solid var(--line);background:var(--cream)}",
  ".topbar .in{max-width:860px;margin:0 auto;padding:14px 24px;display:flex;",
  "align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}",
  ".topbar svg.wm{height:22px;width:69px;display:block}",
  ".topbar nav{display:flex;gap:18px;font-size:14px;flex-wrap:wrap}",
  ".topbar a{color:var(--ink-2);text-decoration:none}",
  ".topbar a:hover{color:var(--rk);text-decoration:underline}",
  ".page{max-width:860px;margin:0 auto;padding:36px 24px 72px}",
  ".crumbs{font-size:13px;color:var(--ink-3);margin:0 0 18px}",
  ".crumbs a{color:var(--ink-3)}",
  "h1{font-size:32px;line-height:1.25;margin:0 0 10px;letter-spacing:-.01em}",
  "h2{font-size:23px;margin:38px 0 10px;line-height:1.3}",
  "h3{font-size:18px;margin:28px 0 8px}",
  "h4{font-size:16px;margin:22px 0 6px;color:var(--ink-2)}",
  ".summary{font-size:18px;color:var(--ink-2);margin:0 0 22px}",
  "p{margin:0 0 14px}",
  "a{color:var(--rk)}",
  "ul,ol{margin:0 0 14px;padding-left:22px}",
  "li{margin:0 0 6px}",
  "code{background:var(--sand);padding:1px 5px;border-radius:4px;font-size:.92em}",
  "blockquote{margin:18px 0;padding:12px 16px;background:var(--cream);",
  "border-left:3px solid var(--rk);color:var(--ink-2)}",
  "blockquote p:last-child{margin:0}",
  "hr{border:0;border-top:1px solid var(--line);margin:30px 0}",
  ".tablewrap{overflow-x:auto;margin:0 0 16px}",
  "table{border-collapse:collapse;width:100%;font-size:15px;min-width:420px}",
  "th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}",
  "th{background:var(--cream);font-weight:600}",
  ".prov{margin:0 0 26px;padding:14px 16px;border:1px solid var(--line);",
  "border-radius:10px;background:var(--cream);font-size:14px;color:var(--ink-2)}",
  ".prov dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 14px}",
  ".prov dt{color:var(--ink-3)}",
  ".prov dd{margin:0}",
  ".draft{margin:0 0 24px;padding:14px 16px;border:1px solid #fcd34d;",
  "border-radius:10px;background:#fffbeb;font-size:15px;color:#713f12}",
  ".cat{margin:34px 0 0}",
  ".cat h2{margin:0 0 12px}",
  ".cards{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}",
  ".card{border:1px solid var(--line);border-radius:12px;padding:16px;background:#fff}",
  ".card a{font-weight:600;text-decoration:none;font-size:17px}",
  ".card a:hover{text-decoration:underline}",
  ".card p{margin:6px 0 0;font-size:14px;color:var(--ink-2)}",
  ".card .soon{display:inline-block;margin-top:8px;font-size:12px;color:var(--ink-3)}",
  ".related{margin-top:44px;border-top:1px solid var(--line)}",
  ".related h2{margin:20px 0 12px}",
  ".sources{font-size:14px;color:var(--ink-2)}",
  "footer{border-top:1px solid var(--line);margin-top:48px;padding-top:18px;",
  "font-size:13px;color:var(--ink-3)}",
  "footer a{color:var(--ink-3)}",
  ".tm{margin-top:14px;font-size:11px;color:var(--ink-3)}",
  "@media(max-width:560px){h1{font-size:26px}h2{font-size:20px}.page{padding:26px 18px 56px}}",
].join('');

/**
 * The wordmark STANDS ALONE in the top bar - no icon square beside it. It
 * already carries the droplet as the i tittle, so pairing it with the icon
 * duplicates the droplet. Locked rule; do not build a lockup here.
 */
function topbar() {
  return [
    '<header class="topbar"><div class="in">',
    '<a href="/" aria-label="Raktify home"><svg class="wm" role="img" aria-label="Raktify">',
    '<use href="#rk-wordmark" /></svg></a>',
    '<nav aria-label="Primary"><a href="/learn">Learn</a>',
    '<a href="/register">Become a donor</a>',
    '<a href="/camps/host">Host a camp</a>',
    '<a href="/how-raktify-works.html">How it works</a></nav>',
    '</div></header>',
  ].join('');
}

/**
 * The owner note is FINE PRINT, not a claim: one muted line, the page's LAST
 * element, below the footer rule, smaller than the footer, no bold on the mark
 * and no prohibition clause. The founder's instruction, verbatim: "dont put
 * trademark notice like we are screamng. just a gentel subtle note is
 * sufficient. even the TM mark give the hint that its already trademarked."
 * It says "trade mark", never "registered", and never the R glyph - the filing
 * is pending and printing R is a section 107 offence.
 */
function footer(updated) {
  return [
    '<footer><p>',
    'Raktify is a free, non-profit blood donation platform by ',
    FOUNDATION,
    ', Amravati, Maharashtra. ',
    '<a href="/learn">Knowledge Center</a> · ',
    '<a href="/learn/contribute">Write for us</a> · ',
    '<a href="/privacy">Privacy</a> · ',
    '<a href="/terms">Terms</a> · ',
    'contact@choudhari.ngo',
    '</p>',
    updated ? '<p>This page was last updated on ' + esc(updated) + '.</p>' : '',
    '<p class="tm">Raktify&#8482; &middot; a trade mark of ',
    FOUNDATION,
    ' (application pending)</p>',
    '</footer>',
  ].join('');
}

/**
 * The head. Canonical is the CLEAN url (/learn/slug), never the .html file the
 * rewrite serves, because the clean url is what the sitemap submits and what
 * every link points at - two spellings of one page is the duplicate-identity
 * defect this whole body of work exists to remove.
 *
 * og:image is the shared site card. A per-article card would mean a second
 * renderer, and the one lesson the camp OG work bought (see
 * docs/Raktify_Engineering_Lessons.md) is that a second renderer drifts.
 */
function head(opts) {
  const url = ORIGIN + opts.path;
  const lines = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="theme-color" content="#b8231a" />',
    '<title>' + esc(opts.title) + '</title>',
    '<meta name="description" content="' + esc(opts.description) + '" />',
    '<link rel="canonical" href="' + esc(url) + '" />',
    '<link rel="icon" type="image/svg+xml" href="/icon.svg" />',
  ];
  if (opts.noindex) {
    lines.push('<meta name="robots" content="noindex, follow" />');
  }
  lines.push(
    '<meta property="og:type" content="article" />',
    '<meta property="og:site_name" content="Raktify" />',
    '<meta property="og:url" content="' + esc(url) + '" />',
    '<meta property="og:title" content="' + esc(opts.title) + '" />',
    '<meta property="og:description" content="' + esc(opts.description) + '" />',
    '<meta property="og:image" content="' + ORIGIN + '/og-image.png" />',
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:type" content="image/png" />',
    '<meta property="og:locale" content="en_IN" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:title" content="' + esc(opts.title) + '" />',
    '<meta name="twitter:description" content="' + esc(opts.description) + '" />',
    '<meta name="twitter:image" content="' + ORIGIN + '/og-image.png" />',
    '<style>' + CSS + '</style>',
  );
  for (const block of opts.jsonld || []) {
    lines.push('<script type="application/ld+json">' + JSON.stringify(block, null, 2) + '</script>');
  }
  lines.push('</head>', '<body>');
  lines.push('<a class="skip" href="#main">Skip to content</a>');
  lines.push(SPRITE);
  lines.push(topbar());
  return lines.join('\n');
}

/* ───────────────────────────── structured data ─────────────────────────── */

/**
 * Question/answer pairs DERIVED from the article's own visible headings.
 *
 * Google's structured-data policy requires FAQ content to be visible on the
 * page carrying the markup, and the only way to guarantee that is to not have a
 * second source: every pair here comes from an h2 and the prose underneath it,
 * so the schema cannot claim a question the reader does not see. This is why
 * FAQPage ships here and not on index.html, whose SPA home page renders no FAQ.
 */
function faqPairs(body) {
  const lines = body.split(/\r?\n/);
  const pairs = [];
  let current = null;
  for (const line of lines) {
    const h2 = /^##\s+([^#].*)$/.exec(line.trim());
    if (h2) {
      if (current) pairs.push(current);
      current = { q: h2[1].trim(), parts: [] };
      continue;
    }
    if (!current) continue;
    if (/^#{3,4}\s/.test(line.trim())) continue;
    if (line[0] === '<') continue;
    if (!line.trim()) continue;
    current.parts.push(line.trim().replace(/^[->]\s*/, '').replace(/^\d+\.\s*/, ''));
  }
  if (current) pairs.push(current);
  return pairs
    .map((p) => ({ q: p.q, a: plain(p.parts.join(' ')) }))
    .filter((p) => p.q && p.a.length > 20);
}

/** Markdown inline markup removed, for a JSON-LD string value. */
function plain(s) {
  return String(s)
    .replace(CODE_RE, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function breadcrumbs(title, path) {
  const items = [
    { name: 'Raktify', item: ORIGIN + '/' },
    { name: 'Knowledge Center', item: ORIGIN + '/learn' },
  ];
  if (path !== '/learn') items.push({ name: title, item: ORIGIN + path });
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.item,
    })),
  };
}

/**
 * MedicalWebPage for a clinical article, Article for everything else.
 *
 * The distinction is not cosmetic: MedicalWebPage is the type that carries
 * reviewedBy and lastReviewed, which is how a search engine and an LLM can tell
 * a reviewed clinical page from a blog post. Emitting it for a page with no
 * named reviewer would be a provenance claim with nothing behind it - which is
 * exactly why `clinical: true` without `reviewers` fails the build rather than
 * quietly degrading to Article.
 */
function articleSchema(meta, path) {
  const url = ORIGIN + path;
  const node = {
    '@context': 'https://schema.org',
    '@type': meta.clinical ? 'MedicalWebPage' : 'Article',
    '@id': url + '#article',
    name: meta.title,
    headline: meta.title,
    description: meta.summary,
    url: url,
    inLanguage: 'en-IN',
    isPartOf: { '@id': ORIGIN + '/#website' },
    publisher: { '@id': ORIGIN + '/#organization' },
    author: meta.author
      ? { '@type': 'Organization', name: meta.author }
      : { '@id': ORIGIN + '/#organization' },
  };
  if (meta.published) node.datePublished = meta.published;
  if (meta.lastReviewed) node.dateModified = meta.lastReviewed;
  if (meta.clinical) {
    node.lastReviewed = meta.lastReviewed;
    node.reviewedBy = (meta.reviewers || []).map((r) => ({ '@type': 'Person', name: r }));
    node.audience = { '@type': 'Audience', audienceType: 'Patients and voluntary blood donors' };
  }
  if ((meta.citations || []).length) {
    node.citation = meta.citations.map((c) => ({ '@type': 'CreativeWork', name: c }));
  }
  return node;
}

function faqSchema(pairs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question',
      name: p.q,
      acceptedAnswer: { '@type': 'Answer', text: p.a },
    })),
  };
}

/* ───────────────────────────── page renderers ──────────────────────────── */

/**
 * The visible provenance block - who wrote it, who reviewed it, when, and what
 * it is sourced from.
 *
 * This is the human-readable twin of the JSON-LD above, and it is the point of
 * the whole library: docs/Raktify_V2_Growth_Plan.md §2 asks for "India's
 * maintained blood encyclopedia, not a blog", and what separates the two is
 * that a reader can see the provenance without reading the markup. An LLM
 * quoting this page gets the reviewer and the date from the visible text too.
 */
function provenance(meta) {
  const rows = [];
  if (meta.author) rows.push(['Written by', esc(meta.author)]);
  if ((meta.reviewers || []).length) {
    rows.push(['Medically reviewed by', esc(meta.reviewers.join(', '))]);
  }
  if (meta.published) rows.push(['Published', esc(meta.published)]);
  if (meta.lastReviewed) rows.push(['Last reviewed', esc(meta.lastReviewed)]);
  if (meta.nextReview) rows.push(['Next review due', esc(meta.nextReview)]);
  if (!rows.length) return '';
  return (
    '<div class="prov"><dl>' +
    rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') +
    '</dl></div>'
  );
}

function sourcesBlock(meta) {
  const list = meta.citations || [];
  if (!list.length) return '';
  return (
    '<h2 id="sources">Sources</h2><div class="sources"><ul>' +
    list.map((c) => '<li>' + mdInline(c) + '</li>').join('') +
    '</ul></div>'
  );
}

/**
 * A clinical article with no named reviewer never reaches this function - the
 * build fails first. This banner is for the opposite case: an article that is
 * deliberately NOT clinical but still awaits review of some element, flagged
 * with `advisory: "..."` in the front matter.
 */
function advisory(meta) {
  if (!meta.advisory) return '';
  return '<div class="draft"><strong>Note.</strong> ' + mdInline(meta.advisory) + '</div>';
}

/** How many sibling links a reader gets at the foot of an article. */
const RELATED_MAX = 3;

/**
 * "Related reading" at the foot of each article.
 *
 * WHY THIS EXISTS. Before it, /learn/faq linked to the hub and to
 * /learn/contribute and to no other article - measured on the deployed pages,
 * not assumed. The hub pointed at every article and every article pointed back
 * at the hub, so the library was a STAR, not a cluster: nothing connected two
 * articles on the same subject. Lateral links are what tell a search engine
 * that these pages are one body of work on one topic, and they are what a
 * reader who just finished an article actually wants next.
 *
 * SELECTION IS DETERMINISTIC, deliberately. A build that reordered these on
 * every run would produce a diff with no change of meaning, which is noise in
 * a repo where the sitemap and llms.txt are generated too. Rules:
 *   - same category first, then the rest in slug order;
 *   - self excluded;
 *   - DRAFTS EXCLUDED - `published` is the only pool, so an unreviewed
 *     clinical page can never be linked from anywhere (the hub lists drafts
 *     without a link for the same reason);
 *   - `about` meta pages (contribute, editorial-policy) are excluded UNLESS
 *     this article is itself an `about` page, so a reader-facing article never
 *     recommends the editorial policy as further reading.
 */
function relatedBlock(meta, published) {
  const isAbout = meta.category === 'about';
  const pool = published.filter(
    (a) => a.meta.slug !== meta.slug && (isAbout || a.meta.category !== 'about'),
  );
  pool.sort((x, y) => {
    const sx = x.meta.category === meta.category ? 0 : 1;
    const sy = y.meta.category === meta.category ? 0 : 1;
    return sx - sy || x.meta.slug.localeCompare(y.meta.slug);
  });
  const picks = pool.slice(0, RELATED_MAX);
  if (!picks.length) return '';
  return (
    '<div class="related"><h2 id="related">Related reading</h2><div class="cards">' +
    picks
      .map(
        (a) =>
          '<div class="card"><a href="/learn/' +
          a.meta.slug +
          '">' +
          esc(a.meta.title) +
          '</a><p>' +
          esc(a.meta.summary) +
          '</p></div>',
      )
      .join('') +
    '</div></div>'
  );
}

/**
 * PRINT CSS for the review pack. Deliberately NOT the web stylesheet and
 * deliberately NOT Inter: this document is opened offline and printed, where a
 * Google Fonts link fails silently and the text would render in Times - the
 * same trap recorded for docs/*.html in CLAUDE.md. System stack only.
 */
const REVIEW_CSS = [
  "@page{size:A4;margin:18mm 16mm 20mm}",
  "*{box-sizing:border-box}",
  "body{margin:0;font:15px/1.65 'Segoe UI',system-ui,-apple-system,sans-serif;color:#1c1917}",
  ".wm{height:11mm;width:auto;display:block}",
  ".banner{border:2px solid #b8231a;border-radius:8px;padding:12px 14px;margin:14px 0 20px;",
  "background:#fff5f4}",
  ".banner h2{margin:0 0 6px;font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:#b8231a}",
  ".banner p{margin:0;font-size:13.5px;color:#44403c}",
  "h1{font-size:26px;line-height:1.2;margin:0 0 6px}",
  ".sum{font-size:16px;color:#57534e;margin:0 0 18px}",
  "h2{font-size:19px;margin:26px 0 8px;padding-top:2px}",
  "h3{font-size:16px;margin:18px 0 6px}",
  "p,li{orphans:3;widows:3}",
  "table{border-collapse:collapse;width:100%;font-size:14px;margin:12px 0}",
  "th,td{border:1px solid #e7e5e4;padding:7px 9px;text-align:left;vertical-align:top}",
  "th{background:#faf9f8;font-weight:600}",
  ".meta{font-size:13.5px;background:#faf9f8;border:1px solid #e7e5e4;border-radius:8px;",
  "padding:10px 12px;margin:0 0 18px}",
  ".meta dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:3px 12px}",
  ".meta dt{color:#78716c}",
  ".meta dd{margin:0}",
  ".ask{border-left:3px solid #b8231a;padding:2px 0 2px 12px;margin:14px 0}",
  ".ask li{margin:4px 0}",
  ".signoff{page-break-before:always;border:1px solid #d6d3d1;border-radius:8px;padding:16px 18px}",
  ".signoff h2{margin-top:0}",
  ".rule{border-bottom:1px solid #a8a29e;height:26px;margin:4px 0 14px}",
  ".verdict li{margin:10px 0;list-style:none}",
  ".box{display:inline-block;width:13px;height:13px;border:1.5px solid #57534e;margin-right:8px;",
  "vertical-align:-2px}",
  ".fine{margin-top:16px;font-size:11px;color:#78716c}",
  "footer{margin-top:28px;border-top:1px solid #e7e5e4;padding-top:12px;font-size:12px;color:#78716c}",
].join('');

/**
 * One print-ready page per DRAFT article, for the reviewing haematologist.
 *
 * WHY A SEPARATE RENDERER AND NOT renderArticle(): that function emits the
 * public page - nav, canonical, JSON-LD, Related reading - none of which a
 * clinician signing a clinical claim needs, and some of which (a canonical to a
 * URL that does not resolve, because the article is unpublished) would be
 * actively wrong in a PDF. This reuses md(), provenance() and sourcesBlock(),
 * so the PROSE AND THE NUMBERS are the same renderer the live page uses and
 * cannot drift from what will publish. Only the framing differs.
 *
 * It writes OUTSIDE dist/ and is reachable only via an explicit
 * --review-pack flag, so no deploy can ever pick up an unreviewed article.
 */
function renderReviewPage(meta, body) {
  const asks = (meta.reviewNotes || []).map((q) => '<li>' + mdInline(q) + '</li>').join('');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<title>' + esc(meta.title) + ' - for medical review</title>',
    '<style>' + REVIEW_CSS + '</style>',
    '</head>',
    '<body>',
    wordmarkSprite(),
    '<svg class="wm" role="img" aria-label="Raktify"><use href="#rk-wordmark" /></svg>',
    '<div class="banner">',
    '<h2>Draft for medical review &mdash; not published</h2>',
    '<p>This article is written but <strong>not live</strong>, and is not linked from ',
    'anywhere on the site. It cannot publish until a reviewing clinician is named: the ',
    'build refuses an article marked <code>clinical</code> with no named reviewer, which ',
    'is why this page exists rather than a live URL. Please read it as the page a donor ',
    'will see, mark anything that is wrong or that you would word differently, and ',
    'complete the sign-off on the last page.</p>',
    '</div>',
    '<h1>' + esc(meta.title) + '</h1>',
    '<p class="sum">' + esc(meta.summary) + '</p>',
    '<div class="meta"><dl>',
    '<dt>Intended URL</dt><dd>' + ORIGIN + '/learn/' + esc(meta.slug) + '</dd>',
    '<dt>Written by</dt><dd>' + esc(meta.author || FOUNDATION) + '</dd>',
    '<dt>Status</dt><dd>' + esc(meta.status) + ' (clinical)</dd>',
    '<dt>Reviewer</dt><dd>none named &mdash; this is what is being requested</dd>',
    '</dl></div>',
    asks ? '<h2>Specific questions for the reviewer</h2><ul class="ask">' + asks + '</ul>' : '',
    '<h2>The article, as it will publish</h2>',
    md(body, meta.slug),
    sourcesBlock(meta),
    '<div class="signoff">',
    '<h2>Reviewer sign-off</h2>',
    '<p>Raktify records the reviewing clinician by name on the published page, with the ',
    'review date. Nothing below is optional &mdash; an unnamed review cannot be recorded.</p>',
    '<p><strong>Full name</strong></p><div class="rule"></div>',
    '<p><strong>Qualification</strong> (e.g. MD Pathology / MD Transfusion Medicine)</p>',
    '<div class="rule"></div>',
    '<p><strong>Medical council registration number</strong></p><div class="rule"></div>',
    '<p><strong>Verdict</strong></p><ul class="verdict">',
    '<li><span class="box"></span>Approved as written.</li>',
    '<li><span class="box"></span>Approved with the amendments I have marked on this document.</li>',
    '<li><span class="box"></span>Not approved &mdash; see my notes.</li>',
    '</ul>',
    '<p><strong>Review date</strong></p><div class="rule"></div>',
    '<p><strong>Next review due</strong> (we default to 12 months unless you say otherwise)</p>',
    '<div class="rule"></div>',
    '<p><strong>Signature</strong></p><div class="rule" style="height:34px"></div>',
    '<p class="fine">Returned sign-offs are filed in <code>docs/medical-review/</code> ',
    'alongside the reference-data review of 10 July 2026, and the reviewer name is ',
    'published on the article itself.</p>',
    '</div>',
    '<footer>',
    FOUNDATION + ' &middot; Amravati, Maharashtra &middot; contact@choudhari.ngo',
    '</footer>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function renderArticle(meta, body, published) {
  const path = '/learn/' + meta.slug;
  const pairs = meta.faq ? faqPairs(body) : [];
  if (meta.faq && pairs.length < 3) {
    fail(meta.slug + ': faq: true but only ' + pairs.length + ' usable question/answer pairs');
  }
  const jsonld = [articleSchema(meta, path), breadcrumbs(meta.title, path)];
  if (pairs.length) jsonld.push(faqSchema(pairs));

  return [
    head({
      path: path,
      title: meta.title + ' | Raktify',
      description: meta.summary,
      jsonld: jsonld,
    }),
    '<main class="page" id="main">',
    '<p class="crumbs"><a href="/">Raktify</a> &rsaquo; <a href="/learn">Knowledge Center</a> &rsaquo; ' +
      esc(meta.title) +
      '</p>',
    '<h1>' + esc(meta.title) + '</h1>',
    '<p class="summary">' + esc(meta.summary) + '</p>',
    provenance(meta),
    advisory(meta),
    md(body, meta.slug),
    sourcesBlock(meta),
    relatedBlock(meta, published || []),
    footer(meta.lastReviewed || meta.published),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * The hub at /learn. Published articles get a link; drafts get a visible
 * "in review" line with no link.
 *
 * Listing the drafts is deliberate. The library's credibility rests on saying
 * what it has not reviewed yet as plainly as what it has, and a reader who came
 * looking for a topic learns it is coming rather than that it does not exist. A
 * draft is never linked and never enters the sitemap, so nothing unreviewed is
 * ever crawlable.
 */
function renderHub(articles) {
  const byCat = new Map(CATEGORIES.map(([k]) => [k, []]));
  for (const a of articles) byCat.get(a.meta.category).push(a);

  const sections = [];
  for (const [key, label] of CATEGORIES) {
    const list = byCat.get(key);
    if (!list.length) continue;
    list.sort((x, y) => x.meta.title.localeCompare(y.meta.title));
    sections.push(
      '<section class="cat"><h2>' +
        esc(label) +
        '</h2><div class="cards">' +
        list
          .map((a) => {
            const m = a.meta;
            if (m.status === 'published') {
              return (
                '<div class="card"><a href="/learn/' +
                esc(m.slug) +
                '">' +
                esc(m.title) +
                '</a><p>' +
                esc(m.summary) +
                '</p></div>'
              );
            }
            return (
              '<div class="card"><strong>' +
              esc(m.title) +
              '</strong><p>' +
              esc(m.summary) +
              '</p><span class="soon">In medical review &mdash; not yet published</span></div>'
            );
          })
          .join('') +
        '</div></section>',
    );
  }

  const published = articles.filter((a) => a.meta.status === 'published');
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': ORIGIN + '/learn#collection',
    name: 'Raktify Knowledge Center',
    description:
      'A maintained public reference library on blood donation, blood groups, and how blood banks and hospitals work in India.',
    url: ORIGIN + '/learn',
    inLanguage: 'en-IN',
    isPartOf: { '@id': ORIGIN + '/#website' },
    publisher: { '@id': ORIGIN + '/#organization' },
    hasPart: published.map((a) => ({
      '@type': a.meta.clinical ? 'MedicalWebPage' : 'Article',
      '@id': ORIGIN + '/learn/' + a.meta.slug + '#article',
      name: a.meta.title,
      url: ORIGIN + '/learn/' + a.meta.slug,
    })),
  };

  return [
    head({
      path: '/learn',
      title: 'Knowledge Center — Blood Donation in India | Raktify',
      description:
        'A maintained reference library on blood donation in India: who can donate, blood group compatibility, what a blood bank does, and how donors are matched to patients. Free, non-profit, by Choudhari EduHealth India Foundation.',
      jsonld: [itemList, breadcrumbs('Knowledge Center', '/learn')],
    }),
    '<main class="page" id="main">',
    '<p class="crumbs"><a href="/">Raktify</a> &rsaquo; Knowledge Center</p>',
    '<h1>Knowledge Center</h1>',
    '<p class="summary">Plain, sourced answers about blood donation in India &mdash; written for donors, patients and the people who organise camps. Every clinical page names who reviewed it and when.</p>',
    '<p>Raktify is a free, non-profit platform run by ' +
      FOUNDATION +
      '. If you want to help, you can <a href="/register">register as a donor</a>, <a href="/camps/host">host a camp</a>, or <a href="/learn/contribute">write for this library</a>.</p>',
    sections.join(''),
    footer(null),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/* ───────────────────────────── validation ──────────────────────────────── */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORY_KEYS = CATEGORIES.map(([k]) => k);

/**
 * Front-matter validation. Every one of these fails the build rather than
 * warning, because the alternative is a published page with a missing field
 * that nobody notices until a reader or a crawler does.
 *
 * THE PROVENANCE GATE IS THE IMPORTANT ONE. CLAUDE.md hard rule 6 and
 * growth-plan §2.2: nothing clinical publishes without a named reviewer. Making
 * that a build failure rather than a documented convention is the difference
 * between a rule and a hope - a future session that writes a clinical article
 * and forgets the reviewer cannot ship it.
 */
function validate(meta, file) {
  for (const key of ['title', 'slug', 'category', 'summary', 'status']) {
    if (!meta[key]) fail(file + ': missing required front-matter field `' + key + '`');
  }
  if (!SLUG_RE.test(meta.slug)) fail(file + ': slug `' + meta.slug + '` is not url-safe lowercase');
  if (!CATEGORY_KEYS.includes(meta.category)) {
    fail(file + ': unknown category `' + meta.category + '` (expected one of ' + CATEGORY_KEYS.join(', ') + ')');
  }
  if (meta.status !== 'published' && meta.status !== 'draft') {
    fail(file + ': status must be `published` or `draft`, got `' + meta.status + '`');
  }
  for (const key of ['published', 'lastReviewed', 'nextReview']) {
    if (meta[key] && !DATE_RE.test(meta[key])) {
      fail(file + ': ' + key + ' must be YYYY-MM-DD, got `' + meta[key] + '`');
    }
  }
  if (meta.status === 'published') {
    if (!meta.published) fail(file + ': a published article needs a `published` date');
    if (!meta.lastReviewed) fail(file + ': a published article needs a `lastReviewed` date');
    if (meta.clinical && !(meta.reviewers || []).length) {
      fail(
        file +
          ': clinical: true with status: published requires a named reviewer in `reviewers`. ' +
          'CLAUDE.md hard rule 6 - nothing clinical publishes without one. Set status: draft ' +
          'until the reviewing haematologist is named.',
      );
    }
  }
}

/* ────────────────────────────── build ──────────────────────────────────── */

const SPRITE = wordmarkSprite();

let files;
try {
  files = readdirSync(SRC).filter((f) => f.endsWith('.md')).sort();
} catch (err) {
  fail('cannot read ' + SRC + ' (' + err.message + ')');
}
if (!files.length) fail('no articles in content/learn/');

const articles = [];
const seen = new Set();
for (const file of files) {
  const raw = readFileSync(join(SRC, file), 'utf8');
  const { meta, body } = parseFrontMatter(raw, file);
  validate(meta, file);
  if (seen.has(meta.slug)) fail(file + ': duplicate slug `' + meta.slug + '`');
  seen.add(meta.slug);
  if (!body.trim()) fail(file + ': the article has no body');
  articles.push({ file, meta, body });
}

const published = articles.filter((a) => a.meta.status === 'published');
if (!published.length) fail('every article is a draft - there is nothing to publish');

/**
 * REVIEW-PACK MODE - node scripts/build_learn.js --review-pack <outdir>
 *
 * Renders every DRAFT article as a print-ready page for the reviewing
 * haematologist and exits. It runs AFTER validate(), so a malformed draft still
 * fails loudly rather than reaching a clinician.
 *
 * Three properties make this safe to keep in the publishing script:
 *   - it writes only to <outdir>, never to dist/;
 *   - it does not touch sitemap.xml, llms.txt or staticwebapp.config.json;
 *   - it exits before any of the publish work, so `npm run build` - which
 *     passes no arguments - cannot reach it.
 */
const reviewAt = process.argv.indexOf('--review-pack');
if (reviewAt !== -1) {
  const outDir = process.argv[reviewAt + 1];
  if (!outDir || outDir.startsWith('--')) {
    fail('--review-pack needs an output directory, e.g. --review-pack docs/medical-review/pending');
  }
  const drafts = articles.filter((a) => a.meta.status === 'draft');
  if (!drafts.length) fail('--review-pack: there are no drafts; every article is published');
  mkdirSync(outDir, { recursive: true });
  for (const a of drafts) {
    const out = join(outDir, a.meta.slug + '.html');
    writeFileSync(out, renderReviewPage(a.meta, a.body), 'utf8');
    console.log('build_learn: review -> ' + out);
  }
  console.log(
    'build_learn: ' + drafts.length + ' draft(s) rendered for review; dist/ untouched',
  );
  process.exit(0);
}

/**
 * Azure SWA `rewrite` has NO capture groups, so /learn/* cannot be mapped to
 * per-slug files by one rule: every page needs its own route entry. Forgetting
 * one is silent and bad - the clean URL falls through navigationFallback to the
 * SPA shell, React Router's catch-all redirects to the home page, and the URL
 * this script just put in the sitemap becomes a soft 404. So assert.
 */
const swa = readFileSync(SWA_CONFIG, 'utf8');
const missing = [];
for (const a of published) {
  const want = '"route": "/learn/' + a.meta.slug + '"';
  if (!swa.includes(want)) missing.push('/learn/' + a.meta.slug);
}
if (!swa.includes('"route": "/learn"')) missing.push('/learn');
if (missing.length) {
  fail(
    'staticwebapp.config.json has no rewrite for: ' +
      missing.join(', ') +
      '\n  Add one per page, mapping the clean URL to its .html file - SWA rewrite has no\n' +
      '  capture groups, so /learn/* cannot cover them. Without it the URL serves the SPA\n' +
      '  shell and redirects to the home page, while the sitemap still advertises it.',
  );
}

/**
 * The home page hardcodes three article slugs (LEARN_FEATURED in Landing.jsx),
 * because build_learn.js runs AFTER vite build and so there is no manifest the
 * bundle could import. That coupling is only acceptable because it is checked
 * here: a slug that is not published would be a dead link on the busiest page
 * on the site, and the unpublished articles are the CLINICAL drafts, which must
 * never be linked from anywhere (hard rule 6).
 */
const landing = readFileSync(LANDING, 'utf8');
const lfAt = landing.indexOf('const LEARN_FEATURED = [');
if (lfAt === -1) {
  fail(
    'Landing.jsx has no LEARN_FEATURED array. Either the home page Knowledge Center ' +
      'section was removed - in which case delete this check too - or it was renamed, ' +
      'in which case the home page is no longer verified against published articles.',
  );
}
const lfBlock = landing.slice(lfAt, landing.indexOf('];', lfAt));
const featured = lfBlock
  .split("slug: '")
  .slice(1)
  .map((chunk) => chunk.slice(0, chunk.indexOf("'")));
if (!featured.length) fail('Landing.jsx LEARN_FEATURED lists no slugs');
const unpublishedFeatured = featured.filter(
  (slug) => !published.some((a) => a.meta.slug === slug),
);
if (unpublishedFeatured.length) {
  fail(
    'the HOME PAGE features ' +
      unpublishedFeatured.join(', ') +
      ', which is not published. Landing.jsx LEARN_FEATURED may only list articles ' +
      'with status: published - a draft there is a dead link on the home page, and ' +
      'the drafts are the clinical articles.',
  );
}
console.log('build_learn: home page features ' + featured.length + ' articles, all published');

mkdirSync(join(DIST, 'learn'), { recursive: true });
writeFileSync(join(DIST, 'learn.html'), renderHub(articles), 'utf8');
console.log('build_learn: /learn' + ' '.repeat(28) + ' -> dist/learn.html');

const publishedSlugs = new Set(published.map((a) => a.meta.slug));
let relatedLinks = 0;

for (const a of published) {
  const out = join(DIST, 'learn', a.meta.slug + '.html');
  const html = renderArticle(a.meta, a.body, published);

  /**
   * The invariant worth asserting: a Related-reading link must never point at a
   * draft. relatedBlock() is only ever handed `published`, so it cannot happen
   * today - which is the point, because the cost of it happening later is a
   * crawlable link to an unreviewed CLINICAL page, and hard rule 6 is the whole
   * reason this library has a draft state.
   */
  // Bound the slice to the related block itself. Taking everything after the
  // opening div also swept up the FOOTER, which links /learn/contribute - that
  // inflated the count from 18 to 24 and would have let a footer link satisfy
  // (or trip) a check about Related reading. Cards end '</p></div>', so the
  // first '</div></div>' is the end of .cards plus .related and nothing else.
  const block = (html.split('<div class="related">')[1] || '').split('</div></div>')[0];
  if (block) {
    for (const m of block.matchAll(/href="\/learn\/([a-z0-9-]+)"/g)) {
      if (!publishedSlugs.has(m[1])) {
        fail(a.meta.slug + ': Related reading links /learn/' + m[1] + ', which is NOT published');
      }
      relatedLinks += 1;
    }
  }

  writeFileSync(out, html, 'utf8');
  console.log(
    'build_learn: ' + ('/learn/' + a.meta.slug).padEnd(34) + ' -> dist/learn/' + a.meta.slug + '.html',
  );
}

/**
 * Sitemap and llms.txt, patched in dist/ only.
 *
 * The committed public/sitemap.xml stays hand-maintained for the app's own
 * routes and carries a note saying these URLs are appended at build time. Two
 * reasons not to write the committed copy: a generated artefact in git dirties
 * the tree on every build, and the article set is derived from content/learn/ -
 * so a hand-edited list is a second source of truth that will drift the first
 * time somebody adds an article and forgets.
 *
 * lastmod comes from each article's own lastReviewed. That is an honest
 * freshness signal: it is the date a human last checked the page, not the date
 * a build ran, which is the mistake that makes dateModified meaningless.
 */
function patchSitemap(pages) {
  const file = join(DIST, 'sitemap.xml');
  let xml;
  try {
    xml = readFileSync(file, 'utf8');
  } catch (err) {
    fail('cannot read dist/sitemap.xml (' + err.message + ') - run vite build first');
  }
  if (!xml.includes('</urlset>')) fail('dist/sitemap.xml has no </urlset>');
  if (xml.includes('/learn<')) {
    console.log('build_learn: sitemap already carries /learn - left alone');
    return;
  }
  const entries = pages
    .map(
      (p) =>
        '  <url>\n' +
        '    <loc>' +
        ORIGIN +
        p.path +
        '</loc>\n' +
        (p.lastmod ? '    <lastmod>' + p.lastmod + '</lastmod>\n' : '') +
        '    <changefreq>' +
        p.changefreq +
        '</changefreq>\n' +
        '    <priority>' +
        p.priority +
        '</priority>\n' +
        '  </url>\n',
    )
    .join('');
  xml = xml.replace(
    '</urlset>',
    '  <!-- Knowledge Center, appended by frontend/scripts/build_learn.js -->\n' +
      entries +
      '</urlset>',
  );
  writeFileSync(file, xml, 'utf8');
  console.log('build_learn: sitemap += ' + pages.length + ' Knowledge Center URLs');
}

function patchLlms(pages) {
  const file = join(DIST, 'llms.txt');
  let txt;
  try {
    txt = readFileSync(file, 'utf8');
  } catch (err) {
    console.log('build_learn: note - no dist/llms.txt (' + err.message + '), skipped');
    return;
  }
  const MARK = '## Knowledge Center';
  if (txt.includes(MARK)) {
    console.log('build_learn: llms.txt already carries the Knowledge Center - left alone');
    return;
  }
  // Before "## Legal + governance" if it is there, so the reference library sits
  // with the other content sections rather than after the legal boilerplate.
  const block =
    MARK +
    '\n\n' +
    'Maintained reference pages on blood donation in India. Every clinical page\n' +
    'carries a visible "Medically reviewed by" line and a last-reviewed date; a page\n' +
    'without one is still in review and is not published.\n\n' +
    pages
      .filter((p) => p.title)
      .map((p) => '- [' + p.title + '](' + ORIGIN + p.path + ')' + (p.note ? ': ' + p.note : ''))
      .join('\n') +
    '\n\n';
  const anchor = '## Legal + governance';
  txt = txt.includes(anchor) ? txt.replace(anchor, block + anchor) : txt.trimEnd() + '\n\n' + block;
  writeFileSync(file, txt, 'utf8');
  console.log('build_learn: llms.txt += the Knowledge Center section');
}

const sitemapPages = [
  { path: '/learn', changefreq: 'weekly', priority: '0.8', lastmod: null },
].concat(
  published.map((a) => ({
    path: '/learn/' + a.meta.slug,
    changefreq: 'monthly',
    priority: '0.7',
    lastmod: a.meta.lastReviewed,
  })),
);
patchSitemap(sitemapPages);

patchLlms(
  [{ path: '/learn', title: 'Knowledge Center', note: 'index of every reference page' }].concat(
    published.map((a) => ({
      path: '/learn/' + a.meta.slug,
      title: a.meta.title,
      note: a.meta.summary,
    })),
  ),
);

console.log('build_learn: related reading: ' + relatedLinks + ' sibling links');

console.log(
  'build_learn: ' +
    published.length +
    ' published, ' +
    (articles.length - published.length) +
    ' in review',
);
