# Security response headers

Canonical code: `frontend/staticwebapp.config.json` (`globalHeaders`, plus a
per-route override on `/developers`). Shipped `b980460`, 2 October 2026, after a
DPDP website audit flagged four genuine gaps.

Everything here is served by Azure Static Web Apps for `raktify.choudhari.ngo`.
The backend (`raktify-api.azurewebsites.net`) sets its own headers in
`backend/src/app.js` via helmet and is **not** covered by this file — see the
`crossOriginResourcePolicy` note in the lessons index before touching those.

## The live set

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | see below | was absent entirely |
| `X-Frame-Options` | `SAMEORIGIN` | every page was framable, including `/consent/:token` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | see the HSTS note |
| `X-Content-Type-Options` | `nosniff` | pre-existing |
| `Referrer-Policy` | `no-referrer` | pre-existing |

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self';
form-action 'self'; script-src 'self'; worker-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: https:;
connect-src 'self' https://raktify-api.azurewebsites.net;
upgrade-insecure-requests
```

## Four rules that will bite whoever edits this

**1. `connect-src` MUST list the API origin.** The SPA calls
`https://raktify-api.azurewebsites.net`; drop it and **every API call on the site
fails** — login, registration, camps, everything. Verify against the built bundle
(`grep -o 'https://[a-z0-9.-]*azurewebsites.net' frontend/dist/assets/index-*.js`),
never against memory. If the API ever moves origin, this header moves with it.

**2. `script-src 'self'` means NO inline scripts and NO inline event handlers,
anywhere in a served page.** This is the whole value of the policy, and it is
one careless `onclick=` away from having to be widened.

The one handler that stood in the way was the font loader: `index.html` requested
the Google Fonts stylesheet as `media="print"` so it would not block first paint,
and flipped it to `media="all"` with an inline `onload=` attribute. That flip now
lives in `frontend/src/main.jsx`, which is an external script and therefore
allowed. The `fontLink.sheet` check there is load-bearing: if the CSS arrives
before the bundle runs, the load event has already fired and will never fire
again, so waiting for it would leave the page in the fallback face permanently.

To add behaviour to a static page, put it in a real `.js` file served from the
same origin. Do not reach for `'unsafe-inline'`.

**3. `style-src` needs `'unsafe-inline'`, and that is not laziness.** React emits
18 inline `style` props (animation delays on the landing page and elsewhere), and
every generated `/learn` page embeds its CSS in a `<style>` block. Inline *styles*
are a far weaker vector than inline *scripts*; the trade is deliberate.

**4. `/developers` has its own, looser policy.** It loads Swagger UI from
`unpkg.com` (one stylesheet, two scripts) and carries one inline `<script>`. One
page gets an exemption rather than the whole site being widened. If that page ever
self-hosts Swagger, delete the exemption.

> This exemption was nearly missed. The first check for inline scripts in static
> pages enumerated `privacy`, `terms`, `donate`, `data-deletion`,
> `how-raktify-works`, `learn`, `learn/faq` and `index` — and **omitted
> `developers.html`**. It surfaced only on a second pass that grepped every
> absolute external origin in the tree. When adding a CSP anywhere, enumerate
> origins, not pages.

## HSTS, and the "HTTP does not redirect" warning that is wrong

Azure SWA serves `max-age=10886400` (126 days) by default. That is **below the
one-year minimum the HSTS preload list requires**, so its own `preload` token was
inert. `globalHeaders` now overrides it with one year.

The audit's remaining warning — *"Site is on HTTPS but HTTP does not send a proper
301/302 redirect"* — **is false, and was verified false from outside**:

| Probe | Result |
|---|---|
| `HEAD` and `GET` on `http://raktify.choudhari.ngo/` | 301 to `https://raktify.choudhari.ngo/` |
| no trailing slash / scanner-like User-Agent | 301 |
| query string | 301, preserved |
| `/register` over HTTP | 301, path preserved |
| five consecutive requests | 301 x5, ~284 ms |
| IPv6 | no AAAA record exists; the host is IPv4-only |

**The most likely cause is our own HSTS.** A scanner must fetch the HTTPS URL to
analyse the page; that response carries the HSTS header. An HSTS-aware client then
upgrades any subsequent `http://` request *internally, with no network request*,
so it never observes a 301 and records "no redirect". Supporting evidence: the
same warning appeared before this change, when SWA was already sending a 126-day
HSTS, and the audit now **passes** the HSTS check — so it certainly read the
header that suppresses the plaintext request.

HSTS is also strictly stronger than the redirect being asked for: a 301 requires
one cleartext round trip, which is exactly the window an sslstrip attacker needs.
HSTS removes that request. **Do not weaken HSTS to make a scanner happy.**

## No cookie banner, deliberately

The site sets **zero cookies** — no `Set-Cookie` on `/` or `/register`, no
analytics, no Meta Pixel, no tag manager. `localStorage` holds only the auth
token, role, user id and the chosen language: strictly functional.

DPDP 2023 contains **no cookie-banner provision** — that is GDPR/ePrivacy. The Act
requires notice under S.5 and consent under S.6 for *processing personal data*,
which the donor registration and consent flows do. A banner here would be
theatre, and audits that score its absence as a failure are applying the wrong
framework. This is a decision, not an oversight.

## The notice must survive with JavaScript disabled

`/privacy` used to be linked only from the React footer, so the raw HTML a non-JS
crawler or a regulator sees carried no notice link at all — the same bug class as
the `/learn` orphan (`d0ec55c`). `index.html`'s `<noscript>` block now links the
privacy policy, the terms and `/data-deletion`, names the Foundation as a Data
Fiduciary under the DPDP Act, and gives the contact address. Prerendered routes
inherit it, so `/register`, `/camps/host` and `/login` carry it too.

Keep it there. Anything that must be legally discoverable cannot live only in a
React component.

## Still open: Google Fonts sends every visitor's IP to Google

The one real finding the audit scored as a PASS ("0 third-party script domains" —
true, because stylesheets are not scripts). `fonts.googleapis.com` and
`fonts.gstatic.com` are requested on every page load, before any consent, which is
a genuine S.8(7) data-minimisation point and the only third-party data flow left
on the site.

Self-hosting Inter and Noto Sans Devanagari would remove it, allow both font
origins to be dropped from the CSP, and save two DNS+TLS round trips on LCP.
**It is deliberately not done yet**: Google serves Devanagari via `unicode-range`
splitting, and a careless self-host risks breaking Marathi rendering across the
app — a visible regression on a locked design surface. That change needs its own
pass with visual verification, not a tail-end addition to a headers commit.
