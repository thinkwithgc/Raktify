# Competitive landscape — TheBloodApp, and what it means for distribution

Researched 2–3 October 2026 from their public website, their App Store listing,
and a walk-through of their iOS app by the founder. **No personal data from that
walk-through is reproduced here**: the captures contained names of people who had
posted blood requests, camp organisers' mobile numbers scraped from eRaktKosh,
and the founder's own contact details. This repository is **public**, so the
captures are gitignored (`docs/thebloodapp/`) and only structural findings are
recorded.

Treat the numbers as of the research date. The strategic conclusion is the part
that matters and it is unlikely to move quickly.

## What they are

`thebloodapp.com` — a classifieds board for blood requests plus a read-only
mirror of eRaktKosh, with iOS and Android apps. Built by **Zarle Infotech Pvt.
Ltd.** (their footer); the App Store seller is a different entity. Their `/about`
names a founder and an advisor, a mission and a vision, and **no legal
registration of any kind** — no Section 8, no NGO-Darpan, no 80G. They are a
private company's product.

Three data layers, all thin:

| Layer | Source | Reality |
|---|---|---|
| Blood requests | user-posted | no verification of any kind |
| Stock | eRaktKosh, daily | labelled "real-time" in-app; the web snapshot was frozen at 10 Jun 2026 |
| Camps | eRaktKosh | honestly labelled "Government blood donation camps" |

## Nine defects, observed directly

1. **No geographic matching.** "Find Blood" served requests **1744 km** and
   **413 km** away, and the app accepted a volunteer response to the 413 km one.
   Whole blood requires the donor to physically attend; a matcher with no radius
   is a feed.
2. **Requests never expire.** An "Urgent" request posted 10 Sep was still live on
   2 Oct; four-month-old ones were observed. Cleanup depends on users tapping
   Report → "Request already fulfilled".
3. **The loop dead-ends on the patient's family.** Contact is revealed only
   "once they accept your response". Six days after volunteering: still
   *Request Sent*, and the profile read **1 Volunteered / 0 Accepted / 0 Donated**.
4. **No verification anywhere.** Anyone can post a request naming any hospital
   from a dropdown, for **up to 50 units**, with no document and no hospital
   confirmation.
5. **They match on self-reported blood group.** The profile's blood group drives
   the request feed, and both the blood group and the last-donation date are
   **user-editable**. This is exactly what hard rule 4 exists to forbid.
6. **Their eligibility engine runs on that editable date** — correct arithmetic on
   unverifiable input.
7. **Eligibility gating is inconsistent** — one Whole Blood request was blocked as
   "Not Eligible" while another, same session and same state, offered Donate Now.
8. **District filtering is broken** — a filter for Amravati returned
   "Showing 1 camp in Akola", organised by an Amravati blood centre.
9. **They republish personal data** — camp organisers' names and personal mobile
   numbers in plain text, taken from eRaktKosh.

## Four things they do better, and one worth copying

1. **A per-component eligibility panel** — Whole Blood / Platelets / Plasma /
   Double Red Cells, each with a countdown or "Ready", plus an honest footnote
   that the donation centre decides. **This is the one feature worth copying.**
   Raktify already holds `min_gap_days` / `min_gap_days_female` per component in
   the medically-signed `002b_seed_blood_components.sql`, but the donor dashboard
   surfaces a single `next_eligible_date`. Ours would also be strictly better:
   theirs computes from a self-declared editable date, ours from
   `donation_history` written by the blood bank.
2. A per-blood-group stock grid with colour coding and a Call button.
3. **Content volume: roughly 50+ unique pages** — ~20 guides, ~25 help-centre
   articles, **80+ blog posts** (20 Nov 2025 → 28 Sep 2026, so ~8–10/month), and
   **16 donor stories** of ~650–700 words each with named people, photos,
   locations, blood groups and three interlinked related stories per page.
4. App-store presence.

Their blog titles are the sharpest thing they have done, because they target
**high-volume curiosity queries rather than donation-intent queries**: blood
group compatibility for marriage, parents' blood group chart, rarest blood type
in India, the Bombay (hh) phenotype, universal donor vs universal recipient. They
also run **city-page editorial** ("Blood Donation in <city>") and national-event
hooks. None of it carries an author byline, and the clinical pieces carry no
reviewer.

## Their traction, from their own screens

- Their own flagship community: **35 members**. Others: 30, 11, 6, 5, 4, 3, 3,
  **1, 1, 1**.
- iOS app: **5.0 stars from 4 ratings**, v1.0.51.
- Their biggest communities trace to **one NGO's network in Himachal Pradesh** —
  their `/about` gives special mention to that NGO's state president, and their
  longest donor story is from the same state. Not organic growth, and it does not
  generalise to Maharashtra.

## The conclusion that matters

**Their website is the product; the app is the shell.** Every number fits that:
four iOS ratings, a 35-member flagship community, requests rotting for months, no
geographic matching. Those are not the metrics of an app business. They are the
metrics of a **content/SEO business** with an app attached for credibility.

So the competition is for **search traffic**, and the scoreboard is
`docs/seo/Search_Console_Baseline_2026-10-02.md`: **15 clicks and 150 impressions
over 90 days, with not one blood-donation query**.

The lesson is **not** "build native apps". Raktify is already an installable PWA,
and it notifies over WhatsApp — which reaches a donor who installed nothing, and
is a better fit for the Indian context than app push. If app-store *presence* is
ever wanted for discovery, Bubblewrap / Trusted Web Activity wraps the existing
PWA into a Play listing with no second codebase.

The lesson is that **they published and we did not**. Their entire asset is ~50
pages of content plus district pages, which is weeks of work rather than years.

## Where Raktify wins, and it is not features

Their stories are deliberately unanchored — no hospital named, no dates, no blood
groups, because the platform holds no donation records. **Ours can be verifiable**:
a named camp, a named partner blood bank, units collected, attendance derived by
trigger from `donation_history`. That is a category of story their architecture
cannot produce.

Same asymmetry on institutional trust: a Section 8 company with a CIN,
NGO-Darpan registration, 80G eligibility, clinical reference data signed by a
consultant haematologist, column-level encryption with a separate screening key,
and an INSERT-only audit ledger. They have none of it and cannot acquire it
quickly. That is why `/about` exists.

## Standing priorities that follow

1. **Name the haematologist** — three written, gated clinical articles publish the
   moment `reviewers:` has a name. Highest-intent content, blocked on one signature.
2. **Publish at their cadence.** The curiosity-query articles are the gap, and
   several are buildable from already-signed data (the compatibility matrix in
   `002c`).
3. **Backlinks** — the list in `Google_Search_Console_Setup.md`, still undone, and
   the lever the baseline says matters most.
4. **District blood-bank directory pages** — directory facts for every district,
   live stock *only* for onboarded banks. Amravati first. Do **not** republish
   scraped stock as if current; that is their weakness, not a model to copy.
   eRaktKosh reuse terms are **unverified** — `data.gov.in` blocks automated
   fetches, so confirm the licence before building on it.
5. **Per-component donor eligibility** — copy their best feature off our own
   signed data.
6. **Finish the BB-capacity prod walk-through.** Still never exercised, and it is
   what makes the directory pages carry real stock.
