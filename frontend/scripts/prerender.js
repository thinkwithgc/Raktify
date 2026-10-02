/**
 * Per-route <head> for the SPA's public pages, baked at build time.
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
 * Every public route that is NOT the home page.
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
 * Routes disallowed in public/robots.txt (/onboarding/apply, /setup/, /donor,
 * the staff portals) are deliberately absent: prerendering a head for a page no
 * crawler may fetch is dead weight.
 */
const ROUTES = [
  {
    route: '/register',
    out: 'register.html',
    title: 'Register as a Blood Donor in India | Raktify',
    description:
      'Register free as a voluntary blood donor. Raktify messages you on WhatsApp only when your blood group is needed by a hospital near you - no fees, no spam, and you can opt out any time. An initiative of Choudhari EduHealth India Foundation, Amravati.',
  },
  {
    route: '/camps/host',
    out: 'camps/host.html',
    title: 'Host a Blood Donation Camp | Raktify',
    description:
      'Apply to host a blood donation camp for your college, company, housing society or community. Raktify partners a licensed blood bank for the day, collects donor registrations for you, and gives your camp a shareable page. Free for organisers.',
  },
  {
    route: '/help/community-leader',
    out: 'help/community-leader.html',
    title: 'Community Leader Guide | Raktify',
    description:
      'How community leaders use Raktify to mobilise voluntary blood donors in their district - adopting unfilled requests, coordinating with blood banks, and following a case through to transfusion.',
    // TWO levels, not three, and that is a constraint rather than a choice:
    // every breadcrumb item except the last needs a URL that resolves, and
    // there is no /help index route - only a /help/ path segment. A trail
    // through a non-existent /help would point Google at the 404 page. If a
    // real /help hub is ever built, add it here as the middle item.
    breadcrumbs: [
      { name: 'Raktify', item: '/' },
      { name: 'Community Leader Guide' },
    ],
  },
  {
    route: '/login',
    out: 'login.html',
    title: 'Donor Sign In | Raktify',
    description: 'Sign in to your Raktify donor account.',
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

for (const entry of ROUTES) {
  const html = inject(stripOverridden(shell), buildHead(entry));
  const target = join(DIST, entry.out);

  // The whole point of this script. A silent regression here reintroduces the
  // duplicate-canonical defect across the entire public surface, and nothing
  // else in the build would notice - so assert rather than trust.
  const canonical = ORIGIN + entry.route;
  if (!html.includes('<link rel="canonical" href="' + canonical + '" />')) {
    fail(entry.route + ': canonical was not injected');
  }
  if (html.includes('href="' + ORIGIN + '/"')) {
    fail(entry.route + ': a root canonical survived the strip');
  }
  if (!html.includes('<title>' + esc(entry.title) + '</title>')) {
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

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html, 'utf8');
  console.log('prerender: ' + entry.route.padEnd(26) + ' -> dist/' + entry.out);
}

console.log('prerender: ' + ROUTES.length + ' routes written');
