/**
 * Per-route <head> AND static <body> for the SPA's public pages, baked at build
 * time.
 *
 * THE PROBLEM THIS SOLVES
 * =======================
 * frontend/index.html carries ONE static head, canonicalised to the site root.
 * Azure SWA's navigationFallback then serves that same file for every SPA
 * route, so before this script every URL on the site returned byte-identical
 * HTML - same <title>, same description, and the same
 * <link rel="canonical" href="https://raktify.choudhari.ngo/">. Six of the ten
 * URLs in sitemap.xml were therefore telling Google they were duplicates of the
 * home page, including /register at priority 0.9. A crawler does not execute
 * the SPA, so no amount of client-side routing can fix that; the head has to be
 * correct in the bytes the server returns.
 *
 * WHY PRERENDER RATHER THAN A MANAGED FUNCTION
 * ============================================
 * frontend/api/camp-og does per-camp heads at request time because a camp's
 * name is only known then. These routes are static, so a build-time file is
 * strictly better: no cold start, no API dependency, nothing to fail at request
 * time - and, critically, NO navigateFallbackDenylist entry. A path that a
 * managed function rewrites must be on that denylist or a precached shell wins
 * (the bug class of 7d1def8 and 26d32bf). A real file on disk has no such
 * hazard.
 *
 * HOW IT IS SERVED
 * ================
 * Each entry writes dist/<out>, and staticwebapp.config.json rewrites the clean
 * URL to it - exactly the pattern /privacy -> /privacy.html already uses. If
 * this script is ever skipped the rewrite 404s into responseOverrides, which
 * serves index.html: degraded to the old behaviour, never broken. The assertion
 * block below is what stops it being skipped silently.
 *
 * A VISITOR WITH THE SERVICE WORKER INSTALLED still gets the precached root
 * shell for these routes, because Workbox's navigateFallback answers the
 * navigation and these files are written after vite build, so they are not in
 * the precache manifest. That is intended: the SPA renders identically either
 * way, and crawlers - which have no service worker - are the audience for the
 * head. Do NOT "fix" this by adding these routes to navigateFallbackDenylist;
 * that would cost every repeat visitor a network round trip to gain nothing.
 *
 * THE BODY HALF, ADDED LATER
 * ==========================
 * Getting the head right left the body still empty: every route above shipped
 * `<div id="root"></div>` and nothing else outside the <noscript> block, so a
 * GPTBot fetch of / returned ZERO words and ZERO headings. Googlebot renders JS
 * and Search Console therefore never complained, which is exactly why this
 * survived the whole Oct 2-3 SEO batch. GPTBot, ClaudeBot, PerplexityBot and
 * CCBot largely do not render JS.
 *
 * Entries flagged `body: true` are now rendered by src/entry-static.jsx (a
 * second Vite build, see vite.config.ssr.js) and the markup injected into #root.
 * React's createRoot - not hydrateRoot - discards those children on its first
 * commit, silently and with no mismatch warning, so the cost is a brief styled
 * repaint and nothing more. Nothing is hydrated and nothing needs to match.
 *
 * THE HOME PAGE IS A SEPARATE FILE, AND THAT IS THE WHOLE DESIGN
 * =============================================================
 * / is flagged `root: true` and written to dist/home.html, with
 * staticwebapp.config.json rewriting / to it. dist/index.html's body MUST stay
 * empty, for two independent reasons:
 *
 *   1. SHELL INHERITANCE. Every entry below copies dist/index.html as its shell,
 *      so home-page content there would give /register and /camps/host the HOME
 *      PAGE's body.
 *   2. SOFT-404 AMPLIFICATION, the worse one. navigationFallback serves
 *      /index.html for unmatched navigations, and its `exclude` list covers
 *      *.{js,css,svg,png,ico,webmanifest,json,txt,xml,yaml,yml,md} - so a
 *      request for a MISSING file of those extensions skips the fallback, 404s,
 *      and lands on responseOverrides.404 -> /index.html at statusCode 200.
 *      That is the documented mechanism behind the GEO audit reporting
 *      `/.well-known/ai.txt found` for a file that has never existed (see
 *      src/pages/NotFound.jsx). Content in index.html would therefore return the
 *      full home page, HTTP 200, for every missing .txt/.json/.xml/.md/.svg URL
 *      on the origin - and those are not navigations, so React's NotFound
 *      noindex never gets to run. The assertion below is what holds that line.
 *
 * Do NOT "fix" this by moving the home body back into index.html, and do NOT
 * move navigationFallback to a contentless shell.html instead: the service
 * worker binds createHandlerBoundToURL("index.html"), so home-page markup would
 * then flash on every SPA route for repeat visitors.
 *
 * The strip-and-inject regexes below are deliberately DUPLICATED from
 * frontend/api/camp-og/index.js rather than shared. That function is a
 * zero-dependency Azure managed function whose deploy surface is its own
 * folder, and it is field-proven on real handsets; importing across that
 * boundary would either break its packaging or require editing it. Keep the two
 * in sync by hand - the subtleties are commented in both.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ORIGIN = 'https://raktify.choudhari.ngo';
const PLACEHOLDER = '__BUILD_DATE__';

/**
 * Every public route that gets a build-time file.
 *
 * `out` is the file written under dist/, and staticwebapp.config.json must
 * carry a matching rewrite from `route` to it. Descriptions are the text a
 * searcher reads in the result, so they are written for a human and must stay
 * factually true: registration and camp hosting are both free, and the donor
 * alert promise ("only when your blood group is needed nearby") is the same
 * promise index.html's noscript block and the consent flow already make.
 *
 * `noindex` is for pages that are real and public but useless as a search
 * result - a login form ranks for nothing and dilutes the site's own keywords.
 *
 * `body: true` renders the route's React tree into #root (see the BODY HALF
 * section above). `minWords` is its floor, set to roughly 60-70% of what the
 * route measured when it was added, so ordinary copy edits cannot flake the
 * build while a tree that collapsed to nothing still fails it.
 *
 * `root: true` marks the home page. It keeps index.html's head verbatim - that
 * head is already correct for / - and skips the root-canonical strip assertion,
 * because home.html is the one file that is SUPPOSED to carry the root
 * canonical. It is what dedupes home.html against /.
 *
 * /login gets no body: it is noindex, so static content would be dead weight on
 * a page that must not rank. Routes disallowed in public/robots.txt
 * (/onboarding/apply, /setup/, /donor, the staff portals) are absent entirely -
 * prerendering anything for a page no crawler may fetch is dead weight too.
 */
const ROUTES = [
  {
    route: '/',
    out: 'home.html',
    root: true,
    body: true,
    // ~550 words measured: nav, hero, how-it-works x3, trust band x3,
    // Knowledge Center x3, final CTA, and the whole Footer.
    minWords: 350,
  },
  {
    route: '/register',
    out: 'register.html',
    title: 'Register as a Blood Donor in India | Raktify',
    description:
      'Register free as a voluntary blood donor. Raktify messages you on WhatsApp only when your blood group is needed nearby - no fees, no spam, opt out any time.',
    body: true,
    // ~150 words measured, and genuinely a form: a title, a one-line intro, a
    // stepper and field labels. It stays in because the marginal cost is this
    // flag, not because it is expected to rank. The ~310 words of prose it
    // inherits from index.html's <noscript> block are the better content here,
    // which is exactly why that block is NOT stripped from body routes.
    minWords: 90,
  },
  {
    route: '/camps/host',
    out: 'camps/host.html',
    title: 'Host a Blood Donation Camp | Raktify',
    description:
      'Host a blood donation camp for your college, company or society. Raktify partners a licensed blood bank and collects registrations. Free for organisers.',
    body: true,
    // ~300 words measured: a five-line intro plus the blood-bank, taluka,
    // target and consent explainers. The organiser-acquisition page.
    minWords: 180,
  },
  {
    route: '/help/community-leader',
    out: 'help/community-leader.html',
    title: 'Community Leader Guide | Raktify',
    description:
      'How community leaders mobilise voluntary blood donors in their district - adopting unfilled requests and following a case through to transfusion.',
    // TWO levels, not three, and that is a constraint rather than a choice:
    // every breadcrumb item except the last needs a URL that resolves, and
    // there is no /help index route - only a /help/ path segment. A trail
    // through a non-existent /help would point Google at the 404 page. If a
    // real /help hub is ever built, add it here as the middle item.
    breadcrumbs: [
      { name: 'Raktify', item: '/' },
      { name: 'Community Leader Guide' },
    ],
    body: true,
    // A prose help page, and the one target route that was never in
    // public/sitemap.xml - which is why a sitemap-driven sweep for empty pages
    // missed it. It is indexable (no noindex) and was serving zero words.
    minWords: 150,
  },
  {
    route: '/login',
    out: 'login.html',
    title: 'Donor Sign In | Raktify',
    // Short is fine on a noindex page - nothing ranks here - but a one-line tag 
    // reads badly if the URL is ever shared, so it says what the page is for.
    description:
      'Sign in to your Raktify donor account to update your details, see your donation history, or change which alerts you receive.',
    noindex: true,
  },
];

/**
 * Single-value head properties this script replaces.
 *
 * Each becomes /<meta[^>]*\sATTR="VALUE"[^>]*>/gi. Three details are
 * load-bearing, all three learned the hard way in camp-og:
 *   - [^>] matches newlines, so this covers Prettier's multi-line <meta> tags
 *     in index.html without needing a second pattern.
 *   - the closing quote sits inside the pattern, so a property cannot also eat
 *     its own longer siblings (og:image vs og:image:width).
 *   - the leading \s before the attribute name is what stops name="description"
 *     from matching property="og:description".
 * Requiring the <meta prefix keeps the JSON-LD block's own "description" key
 * out of range - never match a loose `description`.
 *
 * og:image and its siblings are deliberately NOT here: the site card is the
 * right card for all of these pages, and leaving it alone is one fewer thing
 * that can go wrong.
 */
const STRIP = [
  ['name', 'description'],
  ['name', 'robots'],
  ['property', 'og:url'],
  ['property', 'og:title'],
  ['property', 'og:description'],
  ['name', 'twitter:title'],
  ['name', 'twitter:description'],
];

function stripOverridden(html) {
  let out = html;
  for (const [attr, value] of STRIP) {
    out = out.replace(new RegExp('<meta[^>]*\\s' + attr + '="' + value + '"[^>]*>', 'gi'), '');
  }
  out = out.replace(/<title>[\s\S]*?<\/title>/i, '');
  out = out.replace(/<link[^>]*\srel="canonical"[^>]*>/i, '');
  return out;
}

/** For an HTML attribute value. */
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHead(entry) {
  const url = ORIGIN + entry.route;
  const lines = [
    '',
    '    <!-- per-route head, injected by frontend/scripts/prerender.js -->',
    '    <title>' + esc(entry.title) + '</title>',
    '    <link rel="canonical" href="' + esc(url) + '" />',
    '    <meta name="description" content="' + esc(entry.description) + '" />',
  ];
  if (entry.noindex) {
    // follow, not nofollow: the links out of a login form are the public pages
    // we do want crawled, and there is no reason to dead-end a crawler here.
    lines.push('    <meta name="robots" content="noindex, follow" />');
  }
  if (entry.breadcrumbs && entry.breadcrumbs.length) {
    // The last item is the current page and may omit `item` per Google's
    // reference; every earlier one must carry a URL that actually resolves.
    const crumbs = entry.breadcrumbs.map((c, i) => {
      const node = { '@type': 'ListItem', position: i + 1, name: c.name };
      if (c.item) node.item = ORIGIN + c.item;
      return node;
    });
    // JSON, so JSON-encode - esc() is for attribute values and would corrupt
    // this. `<` is escaped because a literal </script> inside an inline JSON-LD
    // block would end the script element early.
    const json = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs,
    }).split('<').join('\u003c');
    lines.push('    <script type="application/ld+json">' + json + '</script>');
  }
  lines.push(
    '    <meta property="og:url" content="' + esc(url) + '" />',
    '    <meta property="og:title" content="' + esc(entry.title) + '" />',
    '    <meta property="og:description" content="' + esc(entry.description) + '" />',
    '    <meta name="twitter:title" content="' + esc(entry.title) + '" />',
    '    <meta name="twitter:description" content="' + esc(entry.description) + '" />',
    '',
  );
  return lines.join('\n');
}

/** Immediately after the <head> open tag, so these are the first values seen. */
function inject(html, block) {
  return html.replace(/<head[^>]*>/i, (tag) => tag + block);
}

/**
 * The empty mount point, matched as an exact literal.
 *
 * A regex would be worse here. If index.html's markup ever changes shape, a
 * literal .replace() that finds nothing is a SILENT no-op: the build stays green
 * and ships the blank page this script exists to replace. So every body route
 * asserts this string is present BEFORE injecting, and dist/index.html asserts
 * it is still there UNTOUCHED afterwards.
 */
const ROOT_ANCHOR = '<div id="root"></div>';

/**
 * The root canonical, matched tightly enough to mean only a canonical.
 *
 * The original check was a bare includes('href="' + ORIGIN + '/"') over the whole
 * document, which would also fire on any <a href="https://raktify.choudhari.ngo/">
 * - and body injection puts real anchors into these files. Pinning the rel= in
 * front keeps the assertion about what it is actually guarding. Both index.html
 * and buildHead() emit this attribute order, so a literal beats a regex.
 */
const ROOT_CANONICAL = 'rel="canonical" href="' + ORIGIN + '/"';

/** Put the rendered tree inside the mount point. */
function injectBody(html, markup) {
  return html.replace(ROOT_ANCHOR, '<div id="root">' + markup + '</div>');
}

/**
 * Readable words in a fragment of markup.
 *
 * Counted on the RENDERED MARKUP, never on the finished document. Counting the
 * document would let index.html's inherited ~310-word <noscript> block satisfy
 * the floor for a route whose #root is empty - the gate would pass on exactly
 * the defect it is meant to catch. React output contains no <noscript>, so
 * measuring the markup excludes it for free.
 */
function wordCount(markup) {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

function fail(msg) {
  console.error('prerender: ' + msg);
  process.exit(1);
}

let shell;
try {
  shell = readFileSync(join(DIST, 'index.html'), 'utf8');
} catch (err) {
  fail('cannot read dist/index.html (' + err.message + ') - run vite build first');
}
if (!/<head[\s>]/i.test(shell)) fail('dist/index.html has no <head>');

/**
 * The WebSite JSON-LD in index.html carries dateModified, and a hardcoded date
 * is a claim that silently becomes false a week later. Build time is the
 * closest honest proxy: SWA rebuilds on every deploy, so the stamp moves when
 * the site actually changes. Offset to IST, the timezone every other date in
 * this codebase is reasoned in (see frontend/src/lib/dateBounds.js).
 */
const BUILD_DATE = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

if (shell.includes(PLACEHOLDER)) {
  shell = shell.split(PLACEHOLDER).join(BUILD_DATE);
  // dist/index.html is both the home page and the source every route below
  // copies, so the stamp has to land on disk, not only in memory.
  writeFileSync(join(DIST, 'index.html'), shell, 'utf8');
  console.log('prerender: stamped ' + PLACEHOLDER + ' = ' + BUILD_DATE);
} else {
  // Not fatal - the dateModified claim may have been removed deliberately -
  // but always worth a line, because the silent alternative is a stale date
  // shipping for months.
  console.log('prerender: note - no ' + PLACEHOLDER + ' in dist/index.html');
}

/**
 * dist/index.html's mount point must be EMPTY. See the SOFT-404 AMPLIFICATION
 * note in the header: this file is what navigationFallback and
 * responseOverrides.404 both serve, so body content here returns the full home
 * page at HTTP 200 for every missing .txt/.json/.xml/.md/.svg URL on the origin.
 * The home page's content goes to dist/home.html instead.
 */
if (!shell.includes(ROOT_ANCHOR)) {
  fail(
    'dist/index.html does not contain the exact string ' +
      ROOT_ANCHOR +
      ' - either index.html changed shape (body injection would silently no-op) ' +
      'or someone put content in the mount point, which turns every missing ' +
      'file URL into a 200 serving the whole home page. Read the header.',
  );
}

/**
 * The / rewrite is what makes home.html reachable. Without it / silently falls
 * back to the contentless index.html again and NOTHING fails - the same class of
 * silent gap build_learn.js asserts against for /learn.
 */
const SWA_CONFIG = join(ROOT, 'staticwebapp.config.json');
let swa;
try {
  swa = readFileSync(SWA_CONFIG, 'utf8');
} catch (err) {
  fail('cannot read staticwebapp.config.json (' + err.message + ')');
}
// The closing quote is load-bearing: it stops this matching "/index.html".
if (!swa.includes('"route": "/"')) {
  fail(
    'staticwebapp.config.json has no rewrite for "/" - add ' +
      '{"route": "/", "rewrite": "/home.html", "headers": {"cache-control": "no-cache"}} ' +
      'or / serves the empty shell with nothing failing.',
  );
}

/**
 * Browser globals the React tree reaches DURING RENDER.
 *
 * Installed here, before the SSR bundle is imported, so no module in that graph
 * can be evaluated without them. Only two are needed, and the omissions matter
 * as much as the inclusions:
 *
 *   - localStorage: useT() calls useLocalLang() UNCONDITIONALLY (hooks cannot be
 *     conditional), and that hook runs detectInitialLang() + persistLang() in its
 *     state initialiser. So EVERY component calling useT() touches localStorage
 *     while rendering, whether or not a LangProvider sits above it - wrapping the
 *     tree in a provider with a forced language would not help. AuthProvider also
 *     reads tokenStore.token here; returning null is what makes isAuthenticated
 *     false, so HomeRedirect renders <Landing/> - the real anonymous crawler path.
 *   - document.documentElement: strings.js setLang() assigns to .lang, and
 *     persistLang is setLang.
 *
 * Returning 'en' for rk.lang is HOW ENGLISH IS BAKED IN: detectInitialLang()
 * returns at its first branch and never reaches navigator. That is deliberate -
 * `globalThis.navigator = {...}` THROWS on Node 22, where navigator is a
 * getter-only accessor, so short-circuiting through localStorage avoids the
 * problem instead of needing defineProperty. English also matches migration 320
 * (English is the default, Marathi is a choice) and index.html's own lang="en".
 *
 * NEVER add a `window` stub. @tanstack/query-core decides isServer by
 * `typeof window === 'undefined'`; defining it flips react-query into browser
 * mode and starts its focus and online managers. Nothing in the render path
 * needs it - every listener and request lives in a useEffect, and
 * renderToStaticMarkup runs no effects.
 */
globalThis.localStorage = {
  getItem: (key) => (key === 'rk.lang' ? 'en' : null),
  setItem() {},
  removeItem() {},
};
globalThis.document = { documentElement: {} };

/**
 * The SSR bundle from `vite build --config vite.config.ssr.js`.
 *
 * The catch MUST end in fail(). Skipping body injection on an import error would
 * ship zero-word pages with a green build - the exact failure this whole change
 * exists to remove - so the only permitted outcomes here are a working render or
 * a dead build.
 */
/**
 * react-router's <Link> calls useLayoutEffect, and React warns once per element
 * that it "does nothing on the server". These pages render well over a hundred
 * links between them, so the unfiltered build log was hundreds of lines of
 * identical stack traces - which is not a cosmetic problem: a log nobody can
 * read is a log where a real warning goes unnoticed.
 *
 * Suppressed by exact message only, and console.error is restored in a finally,
 * so anything else React or the components emit still reaches the log. The
 * warning itself is sound but does not apply here: it is about hydration
 * mismatches, and nothing hydrates - createRoot discards this markup.
 */
const LAYOUT_EFFECT_NOISE = 'useLayoutEffect does nothing on the server';

function renderQuietly(path) {
  const realError = console.error;
  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes(LAYOUT_EFFECT_NOISE)) return;
    realError(...args);
  };
  try {
    return render(path);
  } finally {
    console.error = realError;
  }
}

let render;
try {
  ({ render } = await import('../dist-ssr/entry-static.js'));
} catch (err) {
  fail(
    'cannot import dist-ssr/entry-static.js (' +
      err.message +
      ') - the SSR build must run before this script. It is chained in ' +
      "package.json's build script; do not move it to a lifecycle hook, Oryx " +
      'cannot be relied on to honour those.',
  );
}

for (const entry of ROUTES) {
  // The home page keeps index.html's head VERBATIM - it is already canonicalised
  // to / with the correct title, description and og:url, so there is nothing to
  // strip and nothing to override. Every other route gets its own head.
  let html = entry.root ? shell : inject(stripOverridden(shell), buildHead(entry));
  const target = join(DIST, entry.out);

  // The whole point of this script. A silent regression here reintroduces the
  // duplicate-canonical defect across the entire public surface, and nothing
  // else in the build would notice - so assert rather than trust.
  const canonical = ORIGIN + entry.route;
  if (!html.includes('<link rel="canonical" href="' + canonical + '" />')) {
    fail(entry.route + ': canonical was not injected');
  }
  // Skipped for the home page, which is the one file that MUST carry the root
  // canonical - that is what dedupes home.html against /.
  if (!entry.root && html.includes(ROOT_CANONICAL)) {
    fail(entry.route + ': a root canonical survived the strip');
  }
  if (!entry.root && !html.includes('<title>' + esc(entry.title) + '</title>')) {
    fail(entry.route + ': title was not injected');
  }
  if ((html.match(/<title>/gi) || []).length !== 1) {
    fail(entry.route + ': expected exactly one <title>');
  }
  if ((html.match(/rel="canonical"/gi) || []).length !== 1) {
    fail(entry.route + ': expected exactly one canonical');
  }
  if ((html.match(/name="description"/gi) || []).length !== 1) {
    fail(entry.route + ': expected exactly one meta description');
  }
  if (html.includes(PLACEHOLDER)) {
    fail(entry.route + ': ' + PLACEHOLDER + ' was never stamped');
  }
  if (entry.breadcrumbs) {
    const m = html.match(/<script type="application\/ld\+json">(\{"@context[^<]*BreadcrumbList[^<]*)<\/script>/);
    if (!m) fail(entry.route + ': breadcrumbs were requested but no BreadcrumbList was emitted');
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed.itemListElement.length !== entry.breadcrumbs.length) {
        fail(entry.route + ': BreadcrumbList has the wrong number of items');
      }
    } catch (err) {
      fail(entry.route + ': BreadcrumbList is not valid JSON (' + err.message + ')');
    }
  }
  // The shell's module script must have survived, or this is a blank page.
  if (!/<script[^>]+src="[^"]+\.js"/i.test(html)) {
    fail(entry.route + ': no module script in output - the shell was mangled');
  }

  /**
   * Body LAST, after every head assertion above has run on the head-only
   * string. The rendered tree contains <title>-free but attribute-rich markup,
   * and the gates above count things like name="description" and <title> across
   * the whole document - injecting first would let page content interact with
   * those counts and with stripOverridden's [^>] patterns, which match newlines.
   */
  let words = 0;
  if (entry.body) {
    if (!html.includes(ROOT_ANCHOR)) {
      fail(entry.route + ': ' + ROOT_ANCHOR + ' not present, so body injection would no-op');
    }

    let markup;
    try {
      markup = renderQuietly(entry.route);
    } catch (err) {
      // The frontend has no ESLint config, no no-undef gate and no error
      // boundary, so a render throw used to reach production as a blank page
      // (the /register regression behind c9a8c85). This is the gate that was
      // missing: it must kill the build, never degrade to the empty shell.
      fail(entry.route + ': render threw - ' + (err && err.stack ? err.stack : err));
    }

    words = wordCount(markup);
    if (!/<h1[\s>]/i.test(markup)) {
      fail(entry.route + ': rendered body has no <h1>');
    }
    if (words < entry.minWords) {
      fail(entry.route + ': rendered body has ' + words + ' words, floor is ' + entry.minWords);
    }
    // Keeps the CSP promise true: script-src is 'self' with no 'unsafe-inline',
    // so an inline script reaching a served page would be blocked anyway - but
    // it would be blocked SILENTLY, which is worse than failing here.
    if (/<script/i.test(markup)) {
      fail(entry.route + ': rendered body contains a <script>');
    }
    // A broken t() key or a bad interpolation renders as literal text rather
    // than throwing, so nothing above would catch it.
    for (const marker of ['undefined', 'NaN', '[object Object]']) {
      if (markup.includes(marker)) {
        fail(entry.route + ': rendered body contains the literal "' + marker + '"');
      }
    }

    html = injectBody(html, markup);
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html, 'utf8');
  console.log(
    'prerender: ' +
      entry.route.padEnd(26) +
      ' -> dist/' +
      entry.out.padEnd(28) +
      (entry.body ? words + ' words' : 'head only'),
  );
}

/**
 * Re-read from disk rather than trusting `shell`: the loop writes four files and
 * this proves none of them was dist/index.html. An index.html carrying body
 * content is the soft-404 amplification described in the header.
 */
if (!readFileSync(join(DIST, 'index.html'), 'utf8').includes(ROOT_ANCHOR)) {
  fail('dist/index.html no longer has an empty ' + ROOT_ANCHOR + ' - see the header');
}

console.log('prerender: ' + ROUTES.length + ' routes written');
