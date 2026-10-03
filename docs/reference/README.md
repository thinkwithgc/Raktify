# docs/reference/ — third-party reference material

Everything in this directory is **MIT-licensed prose from
[msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)**,
pinned at commit `d3f71c4bb8922d3eea7576237a870dd59b3cdd52` and kept
**byte-verbatim** so it can be re-diffed against upstream.

**These are not Claude Code agents and must not be installed as any.** Upstream
`scripts/install.sh` writes to `~/.claude/agents/`, which would put 230+ personas
user-wide, competing for subagent selection in every project. They are reading
material. Each file's header states where it came from and why it was taken.

**They are advice, not capability.** Not one of them renders a video, cuts a
clip, uploads a file, publishes a post, or reads a database. The pipelines are
still ours to build.

## Raktify constraints that override anything in here

1. **Hard rules 1–6 in `CLAUDE.md` win, always.** Especially **6**: a clinical
   value or claim comes only from the medical advisor's signed document.
   `build_learn.js` fails the build on a `clinical: true` article with no named
   reviewer — no retention or citation tactic in here outranks that.
2. **The design system is LOCKED** (`docs/Raktify_Design_System.md`). No new
   colours, fonts, icon variants or wordmark treatments without founder sign-off.
3. **The wordmark is always the vector** — including a video title card. Import
   the paths from `frontend/public/wordmark-tm.svg`; never re-type it as text.
4. **™, never ®. "trade mark", never "registered".**
5. **Donor PII is masked from hospitals** (hard rule 3) and **self-reported blood
   group is never used in matching** (hard rule 4). No growth tactic touches these.
6. **Jurisdiction is India.** Where a file names a regulator, a statute or a
   currency, assume it is wrong for us until checked — see the table.

## What is here, and what to distrust in it

| File | Stage | Why it was taken | Distrust |
|---|---|---|---|
| `Video_Editing_Craft_Reference.md` | now | Shot grammar, pacing, colour, audio, subtitle and per-platform export craft | Leans CapCut / Douyin ecosystem; brand rules above override its visual advice |
| `YouTube_Optimization_Reference.md` | now | Retention, chaptering, thumbnail CTR, first-30-seconds pacing | Generic but sound |
| `AI_Citation_Strategy.md` | now | AEO/GEO — being the source an assistant cites. Builds on our JSON-LD + `sameAs` | Admits its own results are non-deterministic and point-in-time |
| `Government_Mandate_Engagement.md` | 1 | Treats a health ministry as a mandate-holder, not a customer. UHC alignment, sovereign launch sequencing | **No India specifics.** NBTC / NACO / SBTC, Drugs & Cosmetics Act licensing, ABDM/ABHA are ours to write |
| `Clinical_Evidence_Standards.md` | 1 | Credible clinical claims without claiming diagnostic authority | Written partly for investor audiences; our bar is harder — hard rule 6 names a reviewer |
| `Healthcare_Narrative_Strategy.md` | 1 | One coherent story across clinical, regulatory, sovereign and funder audiences | Investor-deck gravity; we are a Section 8 nonprofit, so read "capital" as grants and CSR |
| `Geospatial_Data_Engineering.md` | 1 | ETL for messy government geodata — the LGD / NBTC-directory problem | Tool-agnostic (GDAL/PostGIS), but nothing on LGD, Census or Survey of India |
| `Geospatial_Analysis.md` | 1 | Catchment and coverage analysis — where the district-level blood bank gaps are | Same |
| `Grant_Writing.md` | 1 | Prospect research, LOI, proposal, budget narrative, post-award reporting | **US-federal framing.** Ours is CSR under Companies Act §135, NGO-Darpan, 80G, FCRA if foreign |
| `Operations_Management.md` | 2 | Process mapping, capacity planning, KPI governance, SOPs, business continuity for a blood bank network | Generic Lean/Six Sigma; no blood-banking specifics |
| `Cold_Chain_Fleet_Engineering.md` | 2 | Devices you cannot reach on networks that drop — blood-bag temperature telemetry nationally | No blood storage regulation (2–6 °C, Drugs & Cosmetics Rules Schedule F Part XII-B) |
| `Minimal_Change_Discipline.md` | meta | Smallest-diff discipline; refuses scope creep. Matches our immutable migrations and "logged, deliberately not fixed" habit | Generic; CLAUDE.md's own tripwires are sharper and name real files |
| `Codebase_Onboarding_Method.md` | meta | Cold-starting a repo from source, facts only. Every phase runs in a fresh session | Generic; our real entry point is CLAUDE.md plus `npm run migrate:status` |

Stages follow the founder's sequence: **digital platform → own blood bank network
→ public-funded multispeciality / super-speciality hospitals.** `meta` means it is
about how a session works, not what it knows - relevant because CLAUDE.md requires
each phase to run in a **fresh agent session**.

## Screened out, and why

Everything below was read and rejected — recorded so nobody re-proposes it.

- **Wrong jurisdiction, China:** `marketing-multi-platform-publisher` (publishes
  to 19+ Chinese platforms via Wechatsync), `healthcare-marketing-compliance`
  (China's Advertising Law), `government-digital-presales-consultant` (China ToG,
  Xinchuang, classified protection), `supply-chain-strategist` (China
  manufacturing sourcing), `corporate-training-designer` (Chinese LMS vendors,
  **PIPL instead of DPDP**, yuan — downloaded, screened, deleted).
- **Wrong jurisdiction, US:** `engineering-section-508-specialist` (India's bar is
  GIGW; the WCAG core transfers, the statute does not), `engineering-uswds-developer`.
- **Collides with a locked decision:** `design-brand-guardian`,
  `design-whimsy-injector`, `design-ui-designer` — all would propose colour and type.
- **Collides with hard rule 6:** `marketing-content-creator` — thin, and aimed at
  volume over a clinical gate.
- **We already do it harder:** `testing-reality-checker` (CLAUDE.md counts
  assertions and measures page counts), `strategy/playbooks/phase-0..6`
  (duplicates our 8-phase structure), `marketing-seo-specialist`.
- **Mis-named for our purpose:** `specialized-master-plan-architect` is *software*
  planning and red-teaming, not facility master planning.
- **Right topic, a decade early:** `specialized-civil-engineer` — it does cover
  **IS** codes alongside Eurocode/ACI, so revisit it at stage 3.

## Stage 3 (hospitals) is essentially uncovered

230 agents produced nothing directly useful for building and running public-funded
hospitals. No NABH accreditation, no Clinical Establishments Act, no hospital
information system, no Indian medical billing (its billing agent is US CPT/ICD),
no biomedical waste rules. Expect to write this ourselves.

## Three gaps no file here closes — these are the real blockers

1. **RLS is inert at runtime — verified on prod 2026-10-03.** `raktify-db`
   connects as `raktify_admin`, which holds `rolbypassrls = TRUE` and owns all 50
   tables, while all 116 policies target four `NOLOGIN` roles. Isolation is real
   but is carried by handler `WHERE` clauses, not the database. At one blood bank
   that is a latent bug; at thousands of institutions holding government-reported
   transfusion data it is existential. See the memory note and `CLAUDE.md`'s camps
   section — including the `SET LOCAL ROLE` lever and why it is not a one-liner.
2. **No India blood-regulation coverage anywhere** — NBTC/SBTC/NACO reporting
   formats, Drugs & Cosmetics Act licensing for blood centres, ABDM/ABHA. This is
   the literal path to government trust.
3. **No contributor-submission policy.** Offering backlinks to doctors and writers
   invites SEO link farms. Needs `rel=author`, `nofollow` on author-site links
   until trust is earned, and clinical submissions still gated on a named
   reviewer — enforced in `build_learn.js` beside the three existing gates.
