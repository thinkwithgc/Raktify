# Raktify — documentation & asset map

The one-page "where is everything" index. Nothing is moved here — this just
tells you where each kind of file already lives.

> **TL;DR:** written docs → `docs/`. Brand/logos + public pages →
> `frontend/public/`. Raw research data (LGD, CSV) → **outside the repo**.
> Claude Code memory → **outside the repo** (`~/.claude/…`). Code →
> `backend/` · `frontend/` · `database/` · `scripts/`.

---

## 1. Written docs — `docs/`

### Specs & references (Markdown)
| File | What it is |
|------|-----------|
| [`Raktify_Master_Prompt.md`](Raktify_Master_Prompt.md) | The single complete product spec (8 phases). Source of truth for *intended* behaviour. |
| [`Raktify_Feature_Reference.md`](Raktify_Feature_Reference.md) | Exhaustive catalogue of *what is actually built*. |
| [`Raktify_Demo_Guide.md`](Raktify_Demo_Guide.md) | Step-by-step runbook for a live walk-through / demo. |
| [`Raktify_Design_System.md`](Raktify_Design_System.md) | **LOCKED** brand system — colours, type, wordmark, icon rules. Read before any visual change. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Azure deploy recipe + the real live-deploy workflow. |
| [`Raktify_WhatsApp_Templates.md`](Raktify_WhatsApp_Templates.md) | Source of truth for every Meta WhatsApp template's copy. |
| [`Raktify_Breach_Response_Runbook.md`](Raktify_Breach_Response_Runbook.md) | DPDP §8(6) data-breach response runbook (DRAFT, pending sign-off). |

### Narrative / presentation artifacts (HTML — open in a browser, print to PDF)
| File | What it is |
|------|-----------|
| [`Raktify_System_Overview.html`](Raktify_System_Overview.html) | 16-page illustrated narrative for partners / CSR funders / board. |
| [`Raktify_CSR_Budget.html`](Raktify_CSR_Budget.html) | 2-year budget + roadmap deck. |
| [`Raktify_Request_Lifecycle.html`](Raktify_Request_Lifecycle.html) | Illustrated request-flow explainer (broken into smaller flows). |
| [`Raktify_DHO_Circular_Template.html`](Raktify_DHO_Circular_Template.html) · [`Raktify_DHO_LoC_Template.html`](Raktify_DHO_LoC_Template.html) | District Health Officer circular + letter-of-commitment templates. |

### Sub-folders (already grouped)
| Folder | Contents |
|--------|----------|
| [`azure-cutover/`](azure-cutover/) | Azure provisioning script + cutover runbook. |
| [`external-review/`](external-review/) | Business-analyst overview + QA test plan (`.md` + `.docx` each). |
| [`sample-mou/`](sample-mou/) | Sample MoU (HTML) + notes. |
| [`seo/`](seo/) | Google Search Console setup notes. |

### Local-only research (untracked — on this machine, not in git)
These exist under `docs/` but are **not committed** (so a fresh clone won't have
them). Kept as reference input:
- `preClaudePreps/` — early research: ecosystem SVGs, form mockups, `.docx`/`.pdf` source drafts (Master Prompt, Medical Review, MoU).
- `medical-review/` — clinical Q&A distilled from the medical-review docx.

> Root-level `README.md` and `CLAUDE.md` live at the repo root by convention
> (not in `docs/`). `CLAUDE.md` is the coding-agent instruction file.

---

## 2. Brand assets & public pages — `frontend/public/`

**Do not move these** — the build and `<meta>` tags reference them by path;
moving them breaks the site, favicons, and link previews.

| File | Purpose |
|------|---------|
| `icon.svg` | Favicon / PWA icon (red square + white droplet). |
| `app-icon.svg` / `app-icon.png` | 1024² rounded app icon (PWA / stores). |
| `og-image.svg` / `og-image.png` | 1200×630 link-preview image. |
| `social-avatar.svg` / `social-avatar.png` | 640² circular-crop avatar (WhatsApp/FB/IG/LinkedIn). |
| `how-raktify-works.html` | **Live** public explainer page (served, not a doc). |
| `robots.txt` · `sitemap.xml` | SEO. |

PNGs are generated from the SVG sources by `node scripts/build_og_image.js`
(`npm run og:build`) — **edit the `.svg`, never hand-edit the `.png`.**

---

## 3. Raw data inputs — *outside the repo*

Raw research/import data is intentionally **not committed** (too large / not
source code):

- **LGD geography** (state / district / taluka / village / ward spreadsheets) —
  live in the external folder `…\Raktify\LGD Data`. Imported by
  [`scripts/import_lgd.js`](../scripts/import_lgd.js).
- **Donor CSVs** — bulk-import donor files are uploaded through the app
  (`/donors/bulk-upload`), not stored in the repo.

---

## 4. Code & data layout (for completeness)

| Area | Location |
|------|----------|
| Backend API (Express) | `backend/src/` (`routes/`, `services/`, `config/`, `middleware/`) |
| Frontend PWA (React/Vite) | `frontend/src/` (`pages/`, `components/`) |
| Database | `database/` (`migrations/`, `seeds/`, `rls/`, `triggers/`) |
| Scripts (migrate / import / seed / smoke) | `scripts/` |
| CI/CD | `.github/workflows/` |

---

## 5. Claude Code memory — *outside the repo*

The AI "memory" notes are **not** in this project. They live in Claude Code's
per-project memory dir on this machine:
`~/.claude/projects/…-BloodConnect/memory/` (`MEMORY.md` index + one file per
fact). They travel with your Claude Code install, not with the git repo.
