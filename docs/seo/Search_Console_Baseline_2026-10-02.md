# Search Console baseline — 2 October 2026, BEFORE the SEO work deployed

Captured via the `gsc` MCP server against `sc-domain:choudhari.ngo`, with the
per-route metadata, `/learn` and the bundle split all still **uncommitted**.
Search Console reports are not retroactive, so this file is the only record of
what the site looked like before the change. Do not edit the numbers.

Window: **2026-07-04 → 2026-10-02** (90 days). Property permission: `siteOwner`.

## Totals

| Metric | Value |
|---|---|
| Clicks | **15** |
| Impressions | **150** |
| CTR | 10% |
| Average position | 9.6 |

## By page

| Page | Clicks | Impressions | CTR | Position |
|---|---|---|---|---|
| `raktify.choudhari.ngo/` | 10 | 51 | 19.6% | 8.5 |
| `www.choudhari.ngo/` | 2 | 66 | 3.0% | 10.7 |
| `raktify…/data-deletion` | 2 | 29 | 6.9% | 5.5 |
| `raktify…/donate` | 1 | 19 | 5.3% | 8.2 |
| `raktify…/terms` | 0 | 26 | 0% | 6.6 |
| `raktify…/privacy` | 0 | 20 | 0% | 5.2 |
| `raktify…/camps/host` | 0 | 16 | 0% | 3.1 |
| `raktify…/register` | 0 | 13 | 0% | 4.5 |
| `raktify…/how-raktify-works.html` | 0 | 7 | 0% | 6.9 |
| `http://choudhari.ngo/` | 0 | 1 | 0% | 10 |

## By query — the finding that matters

Only five queries cleared Google's reporting threshold in 90 days. **None of
them is a blood-donation query, and none is a brand search for Raktify.**

| Query | Clicks | Impressions | Position |
|---|---|---|---|
| `("cdsco" or "drug regulator" or …) and ("hcg" or …)` | 0 | 8 | 7.6 |
| `site:.ngo` | 0 | 2 | 3 |
| `rakt` | 0 | 1 | 74 |
| `rakt innovations pvt ltd` | 0 | 1 | 53 |
| `in india?` | 0 | 1 | 14 |

The first is somebody's media-monitoring boolean string and the second is a
`site:` operator - neither is a person looking for us. The two `rakt` rows are
people looking for an unrelated company, at positions 74 and 53. The 5 reported
queries account for 13 of 150 impressions; the rest come from queries too rare
for Google to report, which is normal at this volume.

## Index coverage — the plan's premise was WRONG, and this is the correction

`docs`/the plan asserted that six sitemap URLs were "structurally incapable of
ranking for their own queries" because every URL returned byte-identical HTML
canonicalised to the site root. **Google indexed them anyway.** URL inspection,
2026-10-02:

| URL | Verdict | Coverage state | Last crawled | Rich results |
|---|---|---|---|---|
| `/` | PASS | Submitted and indexed | 2026-09-09 | none |
| `/register` | PASS | Submitted and indexed | 2026-08-21 | none |
| `/camps/host` | PASS | Submitted and indexed | 2026-09-10 | none |
| `/donate` | PASS | Submitted and indexed | 2026-08-10 | Breadcrumbs, PASS |
| `/privacy` | PASS | Submitted and indexed | 2026-08-21 | Breadcrumbs, PASS |

A page Google had collapsed into the home page would report *"Duplicate, Google
chose different canonical than user"*, not *"Submitted and indexed"*. So the
duplicate canonical was costing **snippet quality and distinct page identity**,
not inclusion in the index. The per-route metadata fix is still correct - a page
whose title and description describe a different page cannot compete on intent -
but it should not be expected to unlock traffic on its own, and this file exists
partly so that expectation is not quietly rewritten later.

**What NOT to conclude from this table.** `/camps/host` at position 3.1 and
`/register` at 4.5 with zero clicks looks like proof that the home page's
snippet is repelling searchers. It is not: 0 clicks on 13-16 impressions is
statistically unremarkable at that position, and those positions are averages
over a handful of long-tail impressions rather than evidence of competitive
ranking. Reading it as signal would be fitting noise to a fix already built.

## Sitemap

| Field | Value |
|---|---|
| Path | `https://raktify.choudhari.ngo/sitemap.xml` |
| Status | Valid |
| Errors / warnings | 0 / 0 |
| Last downloaded | 2026-09-21 22:52 |
| `indexed_urls` as reported | 10 |

**Treat that last row as the submitted count, not an indexed count.** It equals
the sitemap's URL count exactly, and Google deprecated the API's `indexed`
field years ago. The five URLs inspected above are genuinely indexed; nothing
here establishes that all ten are.

## What this says about the work

1. **Indexing and crawling are not the bottleneck.** Coverage is clean, the
   sitemap is valid, and robots.txt already passes every AI-bot check.
2. **The bottleneck is that no page targets any query a blood donor types, and
   nothing links here.** 150 impressions in 90 days with zero donation-intent
   queries is an authority-and-content problem, not a plumbing one.
3. Therefore `/learn` (Phase 4) and the backlinks already listed in
   `Google_Search_Console_Setup.md` are the levers. The per-route metadata,
   schema and bundle split are prerequisites that make ranking *possible*; they
   are not themselves expected to move these numbers.
4. **Legal boilerplate is currently the site's best content** - `/terms`,
   `/privacy` and `/data-deletion` draw 75 impressions between them against 29
   for `/register` + `/camps/host`. That is a content gap, stated numerically.
5. **Crawl cadence is roughly monthly** (last-crawled spread 2026-08-10 to
   2026-09-10), so new metadata takes weeks to surface. Use section 4's
   *Request indexing* on `/register` and `/camps/host` after deploying, rather
   than waiting for a natural recrawl.

## How to re-read this later

```
mcp__gsc__get_performance_overview(site_url="sc-domain:choudhari.ngo", days=90)
mcp__gsc__get_search_analytics(site_url="sc-domain:choudhari.ngo", days=90, dimensions="page")
mcp__gsc__get_search_analytics(site_url="sc-domain:choudhari.ngo", days=90, dimensions="query")
mcp__gsc__batch_url_inspection(site_url="sc-domain:choudhari.ngo", urls="…")
```

`sc-domain:choudhari.ngo`, never `https://raktify.choudhari.ngo/` - the URL form
against a domain property returns an empty result rather than an error, which
reads exactly like "nothing is indexed yet". The domain property also covers
`www.choudhari.ngo` and the bare apex, which is why foundation-site rows appear
above; filter by page prefix to isolate Raktify.

For a like-for-like comparison after the work ships, use
`compare_search_periods` with this window as **Period 2** (the baseline) and the
post-deploy window as Period 1.
