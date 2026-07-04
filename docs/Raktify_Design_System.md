# Raktify — Design System (LOCKED)

> **This is the single source of truth for Raktify's visual identity.**
> These decisions are **locked**. Do not introduce new colours, fonts,
> icon variants, or wordmark treatments without the founder's explicit
> sign-off in writing. When building any surface — React page, static
> HTML doc, email, OG image, PPT — pull tokens from here. If a value you
> need isn't here, ask; don't invent one.
>
> Canonical implementations already in the repo (copy these, don't re-derive):
> - Colours + fonts + shadows → `frontend/tailwind.config.js`
> - Component classes (`.rk-*`) → `frontend/src/index.css`
> - Wordmark → `frontend/src/components/Wordmark.jsx`
> - App icon → `frontend/public/icon.svg` (favicon) + `app-icon.svg` (1024²)

---

## 1. Colour — the `rk` red scale

The Raktify hero colour is a **warm, human red** (not a cold emergency red).
The whole palette is one scale plus two warm neutrals. **Do not add blue,
green, purple, etc. as brand colours** — those appear only as functional
status colours (see §7).

| Token | Hex | Use |
|-------|-----|-----|
| `rk-50` | `#fff5f3` | tints, hover backgrounds, pills |
| `rk-100` | `#ffe7e1` | subtle fills, ring-1 accents |
| `rk-200` | `#ffccc0` | borders on tinted cards |
| `rk-300` | `#ffa794` | — |
| `rk-400` | `#fb7458` | — |
| `rk-500` | `#ef4a32` | pulse-ring animation, droplet gradient mid |
| `rk-600` | `#dc2f1d` | droplet fill, icon gradient top |
| **`rk-700`** | **`#b8231a`** | **THE ACCENT** — primary buttons, links, brand red |
| `rk-800` | `#971f1b` | button hover (also `rk-900`) |
| `rk-900` | `#7c1d1b` | deepest red, icon gradient bottom, shadow tint |

**Warm neutrals** (replace cold slate on marketing surfaces):
| Token | Hex | Use |
|-------|-----|-----|
| `cream` | `#fdf8f4` | page background on landing / marketing |
| `sand` | `#f5ece4` | dividers, borders, subtle surfaces |

**Ink / text:** use Tailwind `stone-*` (warm grey), **not** `slate-*` on
marketing surfaces. Body text `stone-700/800`, headings `stone-900`.
(Legacy app screens still use `slate-*` for form chrome — that's fine
inside the portal; new marketing/public surfaces use `stone`.)

**THE ACCENT is `rk-700` = `#b8231a`.** When a doc/CSS uses a `--rk`
variable, it must equal `#b8231a`.

---

## 2. Typography

- **One family everywhere:** **Inter**, with **Noto Sans Devanagari** as
  the immediate fallback (so Marathi/Hindi render in a matching face),
  then `system-ui`.
  ```
  font-family: 'Inter', 'Noto Sans Devanagari', system-ui, -apple-system, sans-serif;
  ```
- `sans` and `display` are the **same** family — there is no separate
  display face. Weight + size create hierarchy, not a second font.
- Weights in use: 400 (body), 500 (labels), 600 (semibold, most UI),
  700 (bold headings), 800 (extrabold — wordmark, hero numerals).
- Headings use `tracking-tight`. The wordmark uses `tracking-tight` too.
- **Do not** add a serif, a second sans, or a "fancy" display font.

---

## 3. The wordmark

**Canonical component: `frontend/src/components/Wordmark.jsx`. Use it in
React — never hand-type the wordmark in JSX.**

The rule, in words (for non-React surfaces — HTML docs, email, PPT):

- **"Rakt"** → brand red (`rk-700` / `#b8231a`)
- **"ify"** → warm near-black (`stone-900` / `#1a1a1a`)
- The dot of the **i** is a **blood droplet** in `rk-600`. (In the React
  component this is a dotless‑ı with an SVG droplet as the tittle. In
  plain-HTML fallbacks you may simplify to two-tone text without the
  droplet, but the colour split is mandatory.)

**LOCKED — the single most-repeated mistake:**
> **"Rakt" is RED. "ify" is BLACK. Never the reverse.**
> In HTML, the red half goes in the `.accent`/red span:
> `<span class="accent">Rakt</span>ify` — NOT `Rakt<span class="accent">ify</span>`.

Never: all-red, all-black, gradient text, outline, drop-shadow, or a
different colour split.

---

## 4. The app icon / logo mark

**Canonical files:**
- `frontend/public/icon.svg` — 512², the favicon + PWA manifest icon.
- `frontend/public/app-icon.svg` — 1024², store/social. Rendered to
  `app-icon.png` via `npm run og:build` (sharp). **Edit the SVG, then
  rebuild the PNG — never hand-edit the PNG.**

**The mark is: a red rounded-square with a white blood droplet. Nothing
else.**

- Background: brand-red rounded square (radial gradient `rk-600 → rk-700
  → rk-900`), corner radius ≈ 21% (Apple/Android convention).
- Foreground: a single **white droplet**, centred.
- Optional subtle detail already in the 1024 version: three faint white
  concentric rings behind the droplet (opacity 0.08) + a soft inner
  highlight on the droplet. Keep these subtle or omit — never loud.

**LOCKED:**
> **No letters on the icon.** No "R", no "Raktify" text, no monogram.
> The droplet IS the mark. (An "R" was added once and removed — do not
> re-add it or any glyph.)
> Icon stays flat/subtle — no heavy shadows, no 3D, no photographic
> textures.

Every page's `<link rel="icon">` should point at **`/icon.svg`** (the
clean droplet), for consistency.

---

## 5. Shape, elevation, motion

- **Radius:** `rounded-lg` (buttons, inputs), `rounded-xl`/`rounded-2xl`
  (cards), `rounded-full` (pills). Icon square ≈ 21%.
- **Shadows** (warm, red-tinted — defined in tailwind config):
  - `shadow-soft` — cards, resting elevation
  - `shadow-lift` — hero CTAs, hover lift
  - Do not use default cold Tailwind `shadow-lg` on marketing surfaces.
- **Animations** (config): `fade-up`, `fade-in`, `float`, `pulse-ring`.
  Subtle, ease-out, one-shot on entry (`both`). No bounce, no spin, no
  attention-grabbing loops except the single brand `pulse-ring`.

---

## 6. Component classes (`.rk-*`, in `frontend/src/index.css`)

Use these instead of re-styling from scratch:

| Class | What it is |
|-------|-----------|
| `.rk-button` | base button (inline-flex, gap-2, rounded-lg, px-4 py-2, semibold) |
| `.rk-button-primary` | `rk-700` fill, white text, hover `rk-900` |
| `.rk-button-secondary` | white, slate border, hover slate-50 |
| `.rk-input` | bordered input, `rk-700` focus ring |
| `.rk-card` | white, rounded-xl, soft shadow, ring-1 |
| `.rk-label` | form label (sm, medium, slate-700) |
| `.rk-legal *` | long-form legal/doc typography (h2/h3/p/ul/table…) |

---

## 7. Functional status colours (NOT brand colours)

These are allowed **only** to convey state, never as decoration or a
second brand colour:

| Meaning | Colour family |
|---------|--------------|
| Success / available / verified | `emerald` / `green` |
| Warning / deferral / pending | `amber` |
| Danger / critical / error | the brand `rk` red (it doubles as danger) |
| Info / neutral chrome | `stone` / `slate` |
| PESA / tribal-area badge | `amber` |

In the request-lifecycle diagrams there's a fixed actor palette (hospital
= blue, coordinator = purple, blood bank = red, donor = green, camp =
amber, system = grey). Those are **diagram-only** legends for
explainer docs — not part of the product UI palette.

---

## 8. Public contact + identity (also locked)

- Product name: **Raktify** (never "BloodConnect" in user-facing copy —
  that's the internal/legacy name).
- Run by: **Choudhari EduHealth India Foundation** (Section 8 non-profit,
  Amravati).
- Public email: **contact@choudhari.ngo** · NGO email **gaurav@choudhari.ngo**
- Public phone: **+91 98505 41412** (never a personal number).
- Footer credit: "An initiative of Choudhari EduHealth India Foundation".

---

## Change log

- 2026-07-04 — Document created. Locked palette, Inter typography,
  wordmark colour split (Rakt=red / ify=black), droplet-only icon
  (removed the "R" overlay). Tokens sourced from the live
  tailwind.config.js + index.css + Wordmark.jsx.
