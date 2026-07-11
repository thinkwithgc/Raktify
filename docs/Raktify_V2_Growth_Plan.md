# Raktify V2 — Public Growth Layer (Donations + Knowledge Center)

**Status:** structure FINAL (founder decisions, 11 Jul 2026). Implementation to
follow in phases. This doc is the source of truth for the growth layer so
nothing from the planning conversation is lost.

The growth layer is the **acquisition + funding funnel** that lives *around* the
operational app (the SPA stays a lean tool for people who already joined). It is
built as **static, crawlable HTML on the main domain** — the same approach as the
legal pages — so every page ranks in search + is citable by LLMs.

---

## Decisions locked

| # | Decision | Choice |
|---|----------|--------|
| 1 | Knowledge center location | **Static `/learn` subdirectory on the main domain** (not a subdomain — that splits SEO authority; not SPA routes — client-rendered = invisible to crawlers) |
| 2 | Content authoring + provenance | **Markdown + a small static generator**, with a **"written by → reviewed by" authenticity trail** on every article (see §2) |
| 3 | Donations | **A static `/donate` page → give.do** (give.do auto-issues the 80G receipt). Own gateway later (§1) |
| 4 | Launch scope | **~12 cornerstone articles**, deep + high-search, then grow toward 50–100 |
| 5 | Tagline | Add **"An AI-powered digital infrastructure for India's blood ecosystem."** as the primary positioning line |

Guiding principle: the app is for people who already joined; the growth layer is
where **new** people arrive from search. So the "Become a donor" and "Support us"
CTAs live on the content/donate pages — that captures acquisition **without**
crowding the platform, and (because static pages rank) drives both donors and funds.

---

## 1. Donations

- **Now — static `/donate` page** (on-brand, crawlable):
  - Tells the funding story honestly: built and self-funded by the Foundation's
    directors; public support keeps Raktify free and funds expansion.
  - Primary **"Donate via give.do"** button (give.do issues the 80G receipt →
    zero receipt/certificate admin for us).
  - **CSR / large gifts → "contact us"** path (email). Bank details are shared
    privately on that path only — never posted publicly (avoids the manual-80G
    hassle + fraud risk).
  - **"Donate" button added to the top nav + footer.**
- **Later (own mechanism) — trigger: 10,000 donors.** Payment gateway
  (Razorpay / Cashfree) + automated 80G-receipt generation + a donation ledger.
  Keep India-donations-only unless the Foundation registers under **FCRA**
  (foreign-contribution law) — flagged so it isn't missed.

## 2. Knowledge Center (`/learn`) — the organic-growth engine

The articles are the **main organic-growth actors**. What makes health content
("Your Money or Your Life", which Google scrutinizes hardest) actually rank is
**demonstrated expertise** — named authors + independent medical review +
citations. That is precisely the founder's workflow, and it is our edge.

### 2.1 Authenticity trail + versioned medical-KB metadata (the moat)
Build to **medical-publishing standards** (NHS / Mayo / Cochrane), which almost
no NGO does. Every article carries, visibly and in structured data:
- **Written by** — author name + credentials + affiliation (e.g. "Dr. A. Mehta,
  MD Transfusion Medicine, XYZ Blood Bank").
- **Medically reviewed by** — one or more empanelled medical advisors + credentials.
- **Editorial reviewer** — the Raktify editor who checked clarity/structure.
- **Published · Last updated · Next review date** — signals the content is
  maintained and current (default review cadence: every 6 months).
- **Evidence level** — for clinical pages (e.g. "NBTC guideline" / "peer-reviewed"
  / "expert consensus"); omitted on soft/awareness pages.
- **Sources / citations** (NBTC, WHO, ICMR, peer-reviewed) + **read time** +
  **related articles**.
- Rendered to `schema.org/MedicalWebPage` JSON-LD with `author`, `reviewedBy`,
  `lastReviewed`, `citation`, `publisher` = the Foundation. This is what Google +
  LLMs read to trust and rank the page.

> **Why "versioned":** these last-updated / next-review / reviewer fields are the
> single biggest differentiator vs generic awareness sites, and the strongest
> trust signal for both Google's health-content ranking and AI/LLM citation. Treat
> the Knowledge Center as **India's maintained blood encyclopedia**, not a blog.

### 2.2 Contribution + review workflow
1. **Submit** — any doctor / specialist / blood-bank in-charge / community leader
   can contribute. **Phase 1:** a `/learn/contribute` ("Write for us") page invites
   them to email a Word/PDF to a submissions address, with guidance (accuracy,
   citations, no promotion). **Phase 2 (later):** an upload form → Azure Blob →
   review queue in `/admin`.
2. **Review** — the empanelled medical-advisor team reviews for accuracy.
3. **Publish** — on sign-off, the piece is converted to a Markdown article (with
   author + reviewer front-matter) and generated to a static page. **Nothing
   clinical publishes without a named reviewer** — same discipline as our
   clinical reference data.

### 2.3 Technical structure
- Content: `content/learn/<slug>.md` with front-matter
  (`title, slug, category, summary, author, reviewers[], published, lastReviewed,
  status: draft|published, sources[]`).
- Generator: `scripts/build_learn.js` renders every `status: published` article
  through the shared static template → `frontend/public/learn/<slug>.html`, builds
  the **`/learn` index** (by category), injects provenance + JSON-LD + the two
  CTAs, and adds each URL to `sitemap.xml`. Wired into the frontend build.
- Categories: donation basics · blood groups & compatibility · donation types
  (whole blood, platelets/SDP, plasma) · conditions & patients (thalassemia,
  sickle cell, trauma, surgery) · for hospitals & blood banks · FAQs ·
  practitioner stories.

### 2.4 Information architecture — topic clusters + pillar pages
Think **India's blood-donation encyclopedia**, not "N blog posts." Structure as
**hub-and-spoke**: each pillar is a comprehensive "Complete Guide", with shorter
cluster articles linking up to it (and the pillar linking down). This is how
Google + LLMs recognise topical authority.

**Pillars (authoritative hubs):**
1. **Complete Guide to Blood Donation in India** → cluster: first donation ·
   eligibility · weight/age limits · Hb requirement · recovery · side effects ·
   women donors · seniors · athletes · myths · FAQs
2. **Complete Guide to Blood Groups** → cluster: A+ · A− · B+ · B− · O+ · O− ·
   AB+ · AB− · Bombay (hh) · Rh-null · compatibility (who gives to whom)
3. **Complete Guide to Platelet Donation** → cluster: what platelets are · SDP /
   apheresis · plasma · platelet shortages · dengue · cancer patients · FAQs
4. **Complete Guide to Thalassemia** → cluster: what it is · why regular donors
   matter · transfusion schedule · sickle cell disease & trait
5. **Complete Guide to Blood Banks in India** → cluster: what a blood bank does ·
   TTI testing · components & storage · how Raktify's request/matching works ·
   for hospitals · for blood banks

**Structured (non-article) page types** — high featured-snippet + LLM-extraction value:
- **Blood-group database** (one page per group) · **compatibility tables** ·
  **medical glossary** · **FAQ hub** · **emergency guides** ("need blood now") ·
  **hospital / blood-bank resource pages**.

Founder to approve / adjust the pillar + cluster list — these are the growth actors.

## 3. Tagline
"**An AI-powered digital infrastructure for India's blood ecosystem.**"
Defensible (matching is genuinely AI-integrated; Google's AI Overview already
calls Raktify that). Placement: **landing hero + site meta/description**; retire
the two overlapping footer lines so the message is one clear thing.

---

## Sequencing

- **Phase A (fast, no medical review needed) — CONFIRMED, building now:** `/donate`
  page → give.do (`https://r.give.do/I_pTRrzh`) + Donate nav/footer button + the
  final tagline ("An AI-powered digital infrastructure for India's blood ecosystem").
- **Phase B (the engine):** `/learn` generator + article/pillar template + category
  index + `/learn/contribute` page + sitemap wiring + provenance/versioned-KB
  metadata + JSON-LD + structured page types (§2.4). Draft-vs-published gating so we
  can build the whole thing **privately** and flip pages live at launch.
- **Phase C (content — build privately, launch a credible foundation):** draft the
  pillars + clusters, interlink them, run each through **medical-advisor review**,
  and **launch 2–3 fully-covered pillars (~25–40 reviewed pages) at once** — not a
  thin handful. Non-clinical pages (how-it-works, why-donate, myths, stories) can go
  live first while clinical pillars await reviewer sign-off.
- **Phase D (grow):** steady cadence (~2–3 new articles/week), refresh 5–10 pages/month
  (update the "last reviewed" date), add new sections quarterly.

## Inputs still needed from the founder
1. ~~give.do URL~~ ✅ `https://r.give.do/I_pTRrzh`
2. ~~Tagline~~ ✅ "An AI-powered digital infrastructure for India's blood ecosystem."
3. **Submissions email** for contributions (e.g. `contact@choudhari.ngo` or a dedicated `knowledge@`).
4. **Approve / adjust the pillar + cluster architecture** (§2.4) — the growth actors.
5. Names + credentials of the **empanelled medical advisors** (for the "reviewed by"
   trail) — on the critical path for publishing any *clinical* page.
