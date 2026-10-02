# Google Search Console — one-time setup for raktify.choudhari.ngo

Goal: get Raktify indexed by Google so brand searches return our site
instead of the parked `raktify.com` + the brand-squatter at
`raktify.lovable.app`. The technical SEO (meta tags, structured data,
sitemap, noscript fallback) is already shipped — this is the manual
step that tells Google we exist + that we own the domain.

Estimated time: **10 minutes.**

> **Status, 2 October 2026: sections 1-5 are DONE, backlinks included.** They are
> kept below as the record of what was set up and how, not as a to-do list. The
> brand-squatter section is parked, waiting on the trade mark application to
> clear. Section 6 - the mcp-gsc server, which reads this property's data
> straight into a Claude Code session - is the only live task, and it needs one
> file from the founder.

## 1. Add the property

1. Open [search.google.com/search-console](https://search.google.com/search-console/).
2. Sign in with the Google account that owns `choudhari.ngo` (or any
   Google account — you can transfer ownership later).
3. Click **Add property** → pick **Domain** (not "URL prefix").
4. Enter `choudhari.ngo` (the apex, not `raktify.choudhari.ngo`).
   Choosing the apex automatically covers every subdomain (raktify,
   www, future ones).

## 2. Verify ownership via DNS

Google shows a TXT record to add. It looks like:

```
google-site-verification=abc123def456...
```

Add it on your DNS provider (the same one where you set up the CNAME
for `raktify.choudhari.ngo` pointing at Azure Static Web Apps):

| Type | Name | Value | TTL |
|---|---|---|---|
| TXT | `@` (or `choudhari.ngo`) | `google-site-verification=...` (paste from console) | 3600 (or default) |

Save. Return to Search Console and click **Verify**. Usually works in
1-5 min (DNS propagation). If it doesn't, wait an hour and retry.

## 3. Submit the sitemap

1. In Search Console left nav: **Sitemaps**.
2. Add a new sitemap: `https://raktify.choudhari.ngo/sitemap.xml`
3. Submit. Status should flip to **Success** within a few minutes.

The sitemap lives at `frontend/public/sitemap.xml` — Vite copies it to
the SWA root at build time so the URL above is real.

## 4. Request initial indexing

For each page you want crawled urgently:

1. Top bar: paste the URL (start with `https://raktify.choudhari.ngo/`)
2. Click **Request indexing**
3. Repeat for `/register`, `/onboarding/apply`, `/camps/host` (the high-
   intent landing destinations)

Google rate-limits this to ~10 per day per property. Don't burn it on
low-value pages.

## 5. Monitor weekly

Check **Performance** (clicks + impressions) and **Pages** (which are
indexed) every Monday for the first 4 weeks. The site should appear for
its own brand name within **3-7 days** of submission. Long-tail blood-
donor queries take 2-8 weeks to surface.

## Backlinks — the bigger lever

Search rank for new domains is gated more by backlinks than by
on-page SEO. To accelerate:

- Link Raktify from the [Choudhari Foundation main site](https://choudhari.ngo)
  in the navbar + footer.
- Update the NGO-Darpan profile (MH/2025/0643345) with the Raktify URL.
- Add Raktify to the Foundation's social media bios (Instagram, FB,
  LinkedIn).
- Issue a press note via local Amravati news outlets when the first
  hospital onboards — local news sites usually link back.
- Reach out to NGO directories (GuideStar India, GiveIndia, etc.) and
  list Raktify.

Each high-DA backlink moves us up faster than any meta-tag tweak.

## Brand-squatter on Lovable.dev

`raktify.lovable.app` is currently outranking us on the brand search.
Once the Raktify trademark application clears, file:

- A DMCA / trademark complaint via Lovable.dev's abuse contact
- A "Remove brand-impersonation result" request via Google Search
  Console → **Removals** → **New request** → **Outdated content removal**

**Parked, waiting on the trade mark.** Both of those filings need the
registration to have cleared - the application is still PENDING, and claiming a
mark you do not hold yet is the weaker position to file from. Nothing to do here
until it lands; the (TM)-not-(R) rule in CLAUDE.md applies meanwhile.

## 6. The mcp-gsc server — step by step

What this buys: index coverage per URL, sitemap processing errors, and a
query/impression baseline, read straight from Search Console in this session
instead of by hand in the browser. **Take the baseline before the per-route
metadata reaches prod** — Search Console reports are not retroactive, so a
before-reading is the only way this SEO work can later be shown to have
changed anything.

### Already done on this machine

**Section 6 is COMPLETE as of 2 October 2026 - all seven steps.** Consent was
granted, the server answers, and `list_properties` returns
`sc-domain:choudhari.ngo` at `siteOwner`. Kept below as the record of how it was
set up, and as the recovery procedure if the credential is ever lost.

**The baseline has been taken**, before any of the SEO work deployed - see
`Search_Console_Baseline_2026-10-02.md`. That reading is unrepeatable, so treat
the file as an archive rather than a document to refresh.

As built:

| Thing | Value |
|---|---|
| Cloud project | `raktify-seo`, in the `kafelaali.com` organisation |
| Consent screen user type | **Internal** - so no 7-day refresh-token expiry |
| OAuth client type | Desktop app (`installed`, redirect `http://localhost`) |
| Credential | `C:\Users\GauravChoudhari\.secrets\gsc-oauth.json`, outside the repo |
| MCP server | `gsc`, **local** scope (this project only), Connected and authorised |

The Cloud account and the Search Console owner account were confirmed to be the
same address by the founder - which is what makes Internal safe here.


- `uv` / `uvx` **0.11.16** installed, via `python -m pip install uv` (auditable,
  rather than piping `astral.sh/uv/install.ps1` into `iex`).
- `uvx mcp-search-console` run once — resolved and installed cleanly.
- `C:\Users\GauravChoudhari\.secrets\` created as the drop point for the
  credential.

The binaries are **not on PATH**. Every command below uses the absolute path:

```
C:\Users\GauravChoudhari\AppData\Roaming\Python\Python314\Scripts\uvx.exe
```

### Step 1 — Google Cloud project

**The domain is never added to Google Cloud Console - there is nothing to add.**
Cloud Console manages projects, APIs and credentials; Search Console manages
properties. The ONLY thing linking them is the signed-in Google account: because
that account is already a verified owner of `choudhari.ngo`, consenting to the
OAuth client is what makes the API return `sc-domain:choudhari.ngo`. Looking for
a place to register the domain here is the natural wrong assumption and there is
no such place.

The organisation chip at the top of the console (`kafelaali.com`) is the Cloud
org + project picker, not a property list. Click it to create the project.

**No billing needed.** The Search Console API is free; dismiss the $300 free
trial banner rather than starting a trial.

1. Open [console.cloud.google.com](https://console.cloud.google.com/).
2. **Sign in with the same Google account that owns the Search Console
   property.** This is the one step that silently produces a server that
   connects fine and then reports no properties: OAuth grants only what the
   consenting account can already see.
3. Create a project (name it anything — `Raktify SEO`), or reuse an existing one.

### Step 2 — enable the API

**APIs & Services** → **Library** → search `Search Console` → open
**Google Search Console API** → **Enable**.

Without this the server authenticates successfully and then every call fails
with `accessNotConfigured`.

### Step 3 — OAuth consent screen

**APIs & Services** → **OAuth consent screen**.

**The one decision that matters: User type.**

| If the project sits in a Cloud organisation | Pick **Internal** |
|---|---|
| If there is no organisation | You are forced to **External** |

**Settled for this project: Internal is available**, because the Cloud project
lives under the `kafelaali.com` organisation (confirmed from the console,
2 October 2026). So the 7-day expiry below does not apply here.

The one caveat: Internal only lets accounts *inside that organisation* consent.
If the account that is a verified owner in Search Console is not a
`kafelaali.com` account, Internal locks it out and External is the only option -
so confirm the signed-in address matches in both consoles before picking.

Why the distinction matters: an **External** app left in publishing status
*Testing* - which is where it stays unless you submit it for Google
verification - **expires its refresh token after 7 days**, so the browser
consent screen comes back roughly weekly, forever. Internal apps have no such
expiry, need no verification, and need no test-user list.

Fill in app name, user support email and developer contact email. Scopes can be
left empty. If you were forced to External, also add your own Google address
under **Test users**, or consent fails with `access_denied`.

### Step 4 — create the OAuth client

**APIs & Services** → **Credentials** → **Create credentials** → **OAuth client
ID**.

- **Application type: Desktop app.** Not "Web application" — a desktop client is
  what gets the loopback redirect a local CLI flow needs. A web client fails at
  the final hop with `redirect_uri_mismatch`, and the error arrives in the
  browser rather than in the terminal, which makes it look like a server bug.
- Name it anything, **Create**, then **Download JSON**.

### Step 5 — put the file outside the repo

Save it as exactly:

```
C:\Users\GauravChoudhari\.secrets\gsc-oauth.json
```

It is a credential. It must not live in the repo — `.gitignore` says nothing
about it, so a repo-local copy is one `git add -A` away from being published,
and this project's rule is that real secrets only ever live in a gitignored
`.env`. The `.secrets` directory above is outside the working tree for that
reason.

### Step 6 — register the server

One line. PowerShell does not take a backslash as a line continuation, and
these paths are nothing but backslashes, so do not try to wrap it:

```
claude mcp add gsc --env GSC_OAUTH_CLIENT_SECRETS_FILE=C:\Users\GauravChoudhari\.secrets\gsc-oauth.json -- "C:\Users\GauravChoudhari\AppData\Roaming\Python\Python314\Scripts\uvx.exe" mcp-search-console
```

Then `claude mcp list` should show `gsc`.

### Step 7 — consent once

MCP servers load at startup, so **restart Claude Code** after registering. The
first tool call opens a browser consent screen: choose the same account as Step
1, allow. The token is cached afterwards and the prompt does not return (unless
you were forced to External/Testing — see Step 3).

### The property name to query

Section 1 added `choudhari.ngo` as a **Domain** property, not a URL-prefix
property. Its API identifier is therefore:

```
sc-domain:choudhari.ngo
```

Not `https://raktify.choudhari.ngo/`. Passing the URL form against a
domain-verified property returns an empty result rather than an error, which
reads exactly like "nothing is indexed yet". Raktify's pages are then filtered
by page path within that property.

### Alternative: a service account, no browser

Supported, and worth it if the weekly External/Testing re-consent applies:
create a service account, download its JSON key, add the service account's
email under Search Console → **Settings** → **Users and permissions** with full
access, then register with `GSC_CREDENTIALS_PATH` plus `GSC_SKIP_OAUTH=true`
instead of `GSC_OAUTH_CLIENT_SECRETS_FILE`. No consent screen and no token
expiry; the cost is one more identity to keep track of.
