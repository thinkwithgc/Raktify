# Google Search Console — one-time setup for raktify.choudhari.ngo

Goal: get Raktify indexed by Google so brand searches return our site
instead of the parked `raktify.com` + the brand-squatter at
`raktify.lovable.app`. The technical SEO (meta tags, structured data,
sitemap, noscript fallback) is already shipped — this is the manual
step that tells Google we exist + that we own the domain.

Estimated time: **10 minutes.**

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

Keep this on the personal TODO list for post-trademark.
