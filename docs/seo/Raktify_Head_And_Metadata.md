# The `<head>`, per-route metadata, and structured data

Why this doc exists: the rationale below used to live as long HTML comments
inside `frontend/index.html`. AI crawlers ingest comments verbatim, and an
instruction-shaped comment in shipped markup is read as content, so the
reasoning moved here and the markup keeps one-line pointers. Same discipline as
the `a1d94b9` docs split — move, don't lose.

Canonical code:

| File | Owns |
|---|---|
| `frontend/index.html` | the home page's head; the `<noscript>` crawler fallback |
| `frontend/scripts/prerender.js` | the per-route head for every other public route |
| `frontend/api/camp-og/index.js` | the per-camp head for `/c/:slug` (request-time) |
| `frontend/staticwebapp.config.json` | the rewrites that serve the prerendered files |

---

## 1. Why the title reads the way it does

`Raktify — Blood Donor Network by Choudhari Foundation`

SEO-friendly, under 60 chars, and it leads with the brand plus the literal
keyword phrase people actually type. The previous poetic title ("mission-critical
operating system for India's blood ecosystem") was beautiful and invisible to
anyone searching *blood donor network*. The foundation name stays in the title
because brand searches for "Choudhari Foundation" should land here; Amravati —
the geographic root — drops to the description, which is where a location
qualifier still earns the click without eating title characters.

## 2. Why there is a `<noscript>` block, and what it is for

It is visible to search engines on first crawl before they execute the SPA, to
the rare user with JavaScript disabled, and to accessibility scrapers and
indexers that never run JS. The SPA mounts into `#root` and visually replaces
it, so it never appears for a user on a modern browser.

Keep it keyword-rich **and factually correct** — it is what a first-pass ranking
actually reads. It once linked to `/host-camp`, which is not a route
(`App.jsx` has `/camps/host`), so the only crawlable content on the site was
feeding Google a dead URL. Every link in that block must resolve.

## 3. Per-route metadata: the defect and the fix

**The defect.** `index.html` carries one static head canonicalised to the site
root, and Azure SWA's `navigationFallback` serves that same file for every SPA
route. So every URL on the site returned byte-identical HTML — same `<title>`,
same description, and the same `<link rel="canonical" href="…/">`. Six of the
ten URLs in `sitemap.xml` were therefore declaring themselves duplicates of the
home page, `/register` (priority 0.9) and `/camps/host` (0.7) among them. A
crawler does not execute the SPA, so no client-side routing could fix it.

**The fix.** `frontend/scripts/prerender.js` runs chained inside
`npm run build` (`vite build && node scripts/prerender.js`) and writes one real
HTML file per public route with its own title, description, canonical and OG
block. `staticwebapp.config.json` rewrites the clean URL to each file, exactly
the pattern `/privacy` to `/privacy.html` already used.

**Chained, not a `postbuild` hook.** Oryx runs `npm run build` on SWA deploy;
chaining cannot be skipped by a runner that ignores npm lifecycle hooks.

**Flat files, not directory indexes.** `dist/camps/host.html` rather than
`dist/camps/host/index.html`, because the latter invites SWA's trailing-slash
redirect, and a redirect is itself a canonical mismatch.

**It asserts, then writes.** Seven checks per route — canonical injected, no root
canonical surviving, title injected, exactly one `<title>`, exactly one
canonical, exactly one meta description, and the module script still present.
A silent regression here reintroduces the defect across the whole public
surface and nothing else in the build would notice.

**`.html` is NOT in `navigationFallback.exclude`.** The exclude list is
`js,css,svg,png,ico,webmanifest,json,txt,xml,yaml,yml,md`. The explicit route
rewrites are what make this work.

**No `navigateFallbackDenylist` entry, deliberately.** The prerendered files are
written *after* `vite build`, so they are not in the Workbox precache manifest
(12 entries, none of them a prerendered file). A visitor with the service worker
installed gets the precached **root** shell for these routes and the SPA renders
identically — which is fine, because crawlers have no service worker and are the
entire audience for the head. Adding denylist entries would cost every repeat
visitor a network round trip to gain nothing. The `7d1def8` / `26d32bf`
precached-shell bug class cannot recur here: a real file on disk is never
rewritten by a managed function.

**Why the regexes are duplicated from `camp-og`.** That function is a
zero-dependency Azure managed function whose deploy surface is its own folder,
and it is field-proven on real handsets. Sharing a module across that boundary
would either break its packaging or require editing it. The two copies are kept
in sync by hand; the subtleties are commented in both.

## 4. Structured data

### `NGO` (shipped earlier)

Drives the Google Knowledge Panel and "About this result" snippets. Updates flow
through within days of the next crawl.

### `WebSite` (added with this work)

Binds the site entity to the organisation by reference, not by repetition:
`.../#website` has `publisher: { @id: .../#organization }`, which is why the
`NGO` node gained an `@id` in the same change. One entity, two nodes pointing
at it, no duplicated facts to drift apart.

`dateModified` is **stamped at build time, not hardcoded**. `index.html` ships
the literal `__BUILD_DATE__`; `prerender.js` substitutes the IST build date into
`dist/index.html` before the routes copy it, and asserts per route that the
placeholder never survives. A hardcoded date is a claim that quietly becomes
false the following week, and a wrong freshness signal is worse than none.

**No `WebPage` node, deliberately.** A `WebPage` names one specific URL, and
every prerendered route is a copy of the same shell - so a single `WebPage` node
in `index.html` would leave all five pages claiming to be the home page, which
is precisely the duplicate-identity defect this work exists to remove. Emitting
a correct per-route one would mean teaching `prerender.js` to strip and re-emit
a JSON-LD `<script>` block: new regex surface in the one file whose failure mode
is the entire public surface, bought for almost nothing, since Google already
derives page identity from the canonical, title and description - all three now
correct per route.

### `sameAs` — OPEN, needs real URLs

The array binds the brand to verified profiles and is what moves Social Trust
off 0/5. It must hold **real, live** profile URLs (Facebook page, Instagram,
LinkedIn, the foundation site). Do not populate it with guesses: `sameAs`
pointing at a 404, or at an account somebody else controls, is worse than an
absent array. Blocked on the founder supplying the URLs.

### `FAQPage` — belongs on a page with a VISIBLE FAQ

Not on `index.html`. Google's structured-data policy requires FAQ content to be
visible to the user on the page carrying the markup, and the SPA home page
renders no FAQ. It ships instead on the static `/learn` FAQ page, where the
questions and answers are real visible HTML.

**Every clinical value in that FAQ is quoted from an already-signed source** —
CLAUDE.md hard rule 6. The sources, with what each one licenses:

| Value | Source | Signed |
|---|---|---|
| Age band 18 to 65 | `008_donors.sql:105-106` CHECKs (`age_min`, `age_max`), NBTC band | yes |
| Haemoglobin floor 12.5 g/dL | `database/seeds/002b_seed_blood_components.sql`, `min_donor_hb_male/female` | yes (10-Jul-2026) |
| Gap 90 days male / 120 days female | same seed, `min_gap_days` / `min_gap_days_female` | yes |
| Whole blood 450 mL, 35-day shelf life | same seed | yes |
| Platelets 5 days; plasma and cryo 365 days | same seed | yes |
| Tattoo 180d, fever 7d, live vaccine 28d, other vaccine 14d, dental 14d, surgery 90d, antibiotics 14d, alcohol 48h | `services/donors/eligibility.js`, `TEMPORARY_QUESTIONS` | yes (advisor Q1/Q3) |
| Permanent exclusions, including no disease-free exception for cancer | same file, `PERMANENT_QUESTIONS` | yes (advisor Q2/Q3) |

**A minimum donor weight is NOT stated anywhere in this codebase** — not in
`eligibility.js`, not in `validate.js`, not as a CHECK. The commonly-quoted
45 kg / 50 kg figure is therefore unsigned here, so no public page may state a
weight until the haematologist signs one. This is exactly the kind of number
that looks harmless and is not.

## 5. Fonts

Inter + Noto Sans Devanagari, one family pair, loaded from Google Fonts.

**The weight list is already minimal — measured, not assumed.** Every weight in
the request is genuinely used across `frontend/src`:

| Weight | Tailwind class | Uses |
|---|---|---|
| 400 | `font-normal` | 3, plus the body default |
| 500 | `font-medium` | 185 |
| 600 | `font-semibold` | 393 |
| 700 | `font-bold` | 54 |
| 800 | `font-extrabold` | 3 |

Nothing to trim. Noto Sans Devanagari costs only the shared CSS request on an
English page — Google Fonts splits it by `unicode-range`, so the glyph files
download only when Devanagari actually renders.

The stylesheet is therefore loaded **non-blocking**, by the `media="print"` to
`onload` swap: the browser fetches a print stylesheet without holding up first
paint, and `onload` flips it to `all` once it lands. With `display=swap`
already in the URL, text paints immediately in the fallback face and swaps when
Inter arrives.

**No `rel="preload" as="style"` alongside it.** That is the other common recipe,
but doubled up it fetches the same URL twice in some browsers, and on its own it
needs the identical `onload` swap anyway — so it adds a request and buys
nothing here. The `<noscript>` copy is the plain blocking link, because with JS
off nothing would ever flip `media`.

The inline `onload` handler is safe because there is **no CSP** on this site —
`staticwebapp.config.json`'s `globalHeaders` carries only
`X-Content-Type-Options` and `Referrer-Policy`, and no meta CSP is emitted. If
a CSP is ever added, that handler is the first thing it breaks: it needs
`'unsafe-inline'` for attributes, or the swap has to move into a script.

That is the only remaining font lever.

## 6. Bundle: the split is drawn at `RequireAuth`

Not strictly head or metadata, but it is the other half of what a crawler and a
first-time visitor pay for, so it is recorded with them.

The SPA shipped as one 1.09 MB chunk (286 KB gzip), so landing on `/` or
`/register` downloaded every admin table, blood-bank worklist and
community-leader screen before anything painted — none of which that visitor can
run, since all of it sits behind `RequireAuth`. `App.jsx` now `React.lazy`s
exactly the components behind that guard, which took the entry chunk to 588 kB
(**183 KB gzip**) with the dashboards split out as their own files.

**Public routes stay eager, deliberately.** They are what LCP is measured on and
what crawlers fetch; a lazy boundary there would add a round trip to the only
pages that are indexed. A signed-in user pays one small chunk fetch on their
first navigation instead — already past the landing page.

The pages are **named** exports, so each loader maps `.Name` onto `default`.
A wrong name there renders `undefined` and React throws "Element type is
invalid" — a blank page, which this frontend has no `no-undef` gate and no error
boundary to catch. Verify the export exists when adding a route to that block.

Workbox now precaches 34 entries rather than 12, because the new chunks match
its glob. That is wanted, not a regression: precaching happens after paint, so
the first visit is unaffected and a repeat visitor's dashboard is already local.
