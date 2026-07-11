# Raktify — Clinical Questions & Answers

**Source of the questions:** [`docs/preClaudePreps/BloodConnect_Medical_Review.docx`](../preClaudePreps/BloodConnect_Medical_Review.docx) §13
**Reviewer:** reviewing haematologist — signed hard copy (handwritten answers) captured as the 18 `WhatsApp Image 2026-07-10 …` scans in this folder; those scans are the authoritative source, this file transcribes them.
**Date answers received:** 10-07-2026

> **STATUS: SIGNED OFF.** All 20 questions answered. The answers below have been
> applied to the repo. The two seed files are no longer `_DRAFT_PENDING_REVIEW`:
>
> - [`database/seeds/002b_seed_blood_components.sql`](../../database/seeds/002b_seed_blood_components.sql) — min-Hb → 12.5 g/dL both genders; gender-based donor gap (90 d M / 120 d F); SDP 48 h. Live values promoted on the running DB by [`migration 297`](../../database/migrations/297_clinical_signoff_component_values.sql).
> - [`database/seeds/002c_seed_compatibility_matrix.sql`](../../database/seeds/002c_seed_compatibility_matrix.sql) — confirmed AS-DRAWN (Q7), no cell changed.
> - [`backend/src/services/donors/eligibility.js`](../../backend/src/services/donors/eligibility.js) — `DRAFT_PENDING_REVIEW = false`; deferral bank updated (drug/medicine-intake question added, vaccine split live/non-live, surgery added, gender-aware recent-donation copy).
> - [`backend/src/services/donations/validate.js`](../../backend/src/services/donations/validate.js) — Hb gate is data-driven off `blood_components` (picks up 12.5 automatically); the donor gap is enforced gender-aware by the DB trigger `fn_donations_update_donor_eligibility` (migration 297).
>
> Remaining protocol placeholders (Q11 24 h timer, Q17 lookback, Q20 HvPI format)
> are confirmed as coded / documented as follow-ups below — none block the MoU.
> **Only the legal review of the MoU remains.**

---

## Q1 — Basic eligibility thresholds

**From §3.2.** Previously coded: 18–65 yrs · ≥45 kg · Hb ≥13 (M) / ≥12.5 (F)
g/dL · BP 100–180 / 60–100 mmHg · pulse 60–100 · no fever · no alcohol in 48 h.

**Question:** Are these basic criteria consistent with current NBTC 2022/2023
guidelines? Have any thresholds changed recently?

**Answer:**

> **Hb = 12.5 g/dL for BOTH genders** (the male floor drops from 13.0 to 12.5).
> Age 18–65 and **weight ≥45 kg** confirmed — ≥45 kg is the floor and is
> specifically the threshold for a **350 ml** collection. Add **"history of
> drug / medicine intake"** to the screening. BP / pulse / fever / alcohol
> unchanged. → Applied: `blood_components.min_donor_hb_{male,female}=12.5`
> (migration 297); drug/medicine-intake question added to `eligibility.js`.
> Weight-vs-draw-volume (45 kg → 350 ml) is a blood-bank-chair rule, logged as a
> wrap-up item (donation form does not capture weight today).

---

## Q2 — Permanent deferrals: cancer exceptions and epilepsy

**From §3.3.** Coded as universal permanent exclusions: HIV, HBsAg+, HCV+, IV
drug use ever, most cancers, chronic cardiac disease, active epilepsy on
anticonvulsants, prior transplant, sickle cell disease (trait OK — Q4).

**Question:** (a) Cancers permitted after a disease-free interval? (b) Is
epilepsy on medication a universal permanent exclusion?

**Answer (a) cancers:**

> **No disease-free exception.** A history of cancer is a permanent exclusion.

**Answer (b) epilepsy:**

> **Epilepsy on medication is a universal permanent exclusion.** → Confirms the
> existing `PERMANENT_QUESTIONS` (PE2 cancer, PE3 epilepsy-on-medication); copy
> tightened in `eligibility.js`.

---

## Q3 — Maharashtra-specific temporary deferrals

**From §3.4.** Coded: alcohol 48 h · fever 2 wk · malaria 3 m · dengue 6 m ·
typhoid 12 m · tattoo 12 m · pregnancy 12 m · WB 90 d / PLT 14 d / SDP 28 d ·
vaccines by type.

**Question:** Commonly encountered deferrals in Maharashtra specifically?

**Answer:**

> - **Whole-blood donation interval: 90 days (men) / 120 days (women)** between
>   two donations. → gender-based; `min_gap_days` (M) + new `min_gap_days_female`
>   column, gender-aware next-eligible trigger (migration 297).
> - **Fever:** defer **until symptoms fully subside** (not a fixed count).
> - **Surgery:** minor surgery **3 months**; **dental cleaning 24–48 h**; **major
>   dental extraction 2 weeks**.
> - **Vaccines:** **live vaccine 28 days**, **non-live / inactivated 14 days**.
> - **Plateletpheresis (SDP):** repeatable after **48 hours**, capped **≤2 per
>   week and ≤4 per month**. → SDP `min_gap_days` 28 → 2; the weekly/monthly cap
>   is a documented follow-up (blood bank enforces at the apheresis chair).
> - **Common in Maharashtra:** typhoid, malaria, dengue.
> → `eligibility.js` updated: vaccine split live/non-live, surgery question
>   added, dental copy → major extraction, recent-donation copy notes 90/120.

---

## Q4 — Sickle cell trait donations

**From §3.7.** Coded: trait donors may donate WB; profile carries a flag; blood
labelled; hospital notified. Amravati has elevated tribal sickle-trait prevalence.

**Question:** Is trait donation permitted? Labelling/disclosure? Component
restrictions?

**Answer:**

> **Permitted if Hb ≥ 12.5 g/dL. No special labelling required.** → The
> `sickle_cell_trait_flag` stays informational; drop any "label the bag /
> restrict" behaviour. Same 12.5 Hb floor as everyone (Q1).

---

## Q5 — Additional component categories

**From §4.1.** Coded: 6 components (WB, PRBC, PLT, SDP, FFP, CRYO).

**Question:** Any commonly used component not listed — leukodepleted / irradiated
PRBC as separate categories, granulocytes, washed RBCs?

**Answer:**

> **Leukodepleted, irradiated and CMV-negative are SEPARATE entities that each
> require a separate product licence** — not merely processing flags on a
> standard PRBC unit. **Leukodepleted PRBC** is used e.g. for **renal
> transplant** recipients. → Follow-up (post-MoU, not blocking): model these as
> distinct inventory items gated by a per-blood-bank product-licence capability,
> rather than boolean flags. Documented; the 6-component seed is unchanged for now.

---

## Q6 — Special requirements: separate inventory or processing step?

**From §4.3.** Coded: leukodepleted / irradiated / CMV-negative as flags on a
PRBC unit.

**Question:** Separate inventory items or on-demand processing steps?

**Answer:**

> **Separate inventory items requiring a separate product licence** (consistent
> with Q5) — not an on-demand "irradiate at request time" capability. → Same
> follow-up as Q5: track separate stock + a per-BB product-licence flag. Not a
> blocker for the MoU.

---

## Q7 — PRBC compatibility matrix

**From §5.1.** Full 8×8 matrix (D = donor row, R = recipient column). This is
what [`002c_seed_compatibility_matrix.sql`](../../database/seeds/002c_seed_compatibility_matrix.sql)
INSERTs.

|D \ R |A+|A−|B+|B−|AB+|AB−|O+|O−|
|---|---|---|---|---|---|---|---|---|
|A+ |✓ |— |— |— |✓ |— |— |— |
|A− |✓ |✓ |— |— |✓ |✓ |— |— |
|B+ |— |— |✓ |— |✓ |— |— |— |
|B− |— |— |✓ |✓ |✓ |✓ |— |— |
|AB+|— |— |— |— |✓ |— |— |— |
|AB−|— |— |— |— |✓ |✓ |— |— |
|O+ |✓ |— |✓ |— |✓ |— |✓ |— |
|O− |✓ |✓ |✓ |✓ |✓ |✓ |✓ |✓ |

**Question:** Confirm this matrix is correct for PRBC and Whole Blood.

**Answer:**

> **Confirmed as drawn** — the grid was ticked with no cell changed. → Seed 002c
> renamed to drop the DRAFT suffix; the 225 rows already live in prod are correct.

---

## Q8 — FFP compatibility (universal donor flipped)

**From §5.2.** Coded: AB is the universal donor for FFP; Rh treated as irrelevant
for plasma.

**Question:** Confirm FFP rules. Is AB FFP the correct universal option? Any Rh
considerations for FFP?

**Answer:**

> **AB is the universal FFP donor — confirmed.** **Rh is considered for repeated
> transfusion** (not wholly irrelevant). → 002c FFP block unchanged (AB
> universal); the repeated-transfusion Rh nuance is a coordinator/clinician note,
> not a hard matcher block.

---

## Q9 — Platelet compatibility + anti-D for Rh-negative females

**From §5.3.** Coded: ABO-preferred-not-absolute; Rh(D) flagged for Rh-negative
females of childbearing age.

**Question:** (a) Block or warn on Rh-positive platelets to Rh-negative females
13–50? (b) Prompt the BB to confirm anti-D was given?

**Answer (a) block or warn:**

> **Apply the Rh restriction** for platelets (ABO stays preferred-not-absolute;
> Rh IS considered). → Matcher keeps the Rh consideration for platelets.

**Answer (b) anti-D confirmation prompt:**

> **Anti-D is decided and given by the treating physician — the platform should
> NOT prompt for it.** → No anti-D confirmation step added.

---

## Q10 — Complete TTI panel

**From §6.2.** Coded panel: HIV (4th-gen), HBsAg, anti-HCV, VDRL (RPR pending),
MP/Malaria. NAAT optional.

**Question:** (a) Complete mandatory panel? (b) Chagas required? (c) RPR
acceptable alternative to VDRL?

**Answer (a) panel completeness:**

> **Complete for India — confirmed.**

**Answer (b) Chagas:**

> **No Chagas screening** required.

**Answer (c) RPR as VDRL alternative:**

> **RPR is now also accepted** — support **both** VDRL and RPR in the entry form.
> → Screening UI/label accepts either test name for syphilis.

---

## Q11 — Reactive TTI: notification timing and legal responsibility

**From §6.4.** Coded: recall immediately · permanent/temporary donor deferral ·
4-eyes verify · counsellor call within 24 h · never auto-message reactive results
· DHO notified for HIV + HBsAg.

**Question:** (a) Correct max notification window post-verify? (b) Who is legally
responsible? (c) HIV referral pathway in Amravati?

**Answer (a) notification window:**

> **24 hours if possible.** → Keeps the `escalate_overdue` 24 h timer as coded.

**Answer (b) legal responsibility:**

> **Both** the blood bank (entered the result) **and** the platform (surfaces it).

**Answer (c) referral pathway:**

> **Refer HIV-reactive donors to ICTC / VCTC.** → Donor-counselling copy points to
> the district ICTC/VCTC; a specific centre + counsellor contact can be seeded later.

---

## Q12 — Urgency tier clinical examples

**From §7.2.** Coded CRITICAL / URGENT / PLANNED example lists.

**Question:** Are the examples clinically appropriate? Any Amravati-specific
scenarios to name explicitly?

**Answer:**

> **Examples confirmed clinically appropriate.** No mandatory additions; local
> scenarios (snakebite coagulopathy, PPH, neonatal exchange) may be surfaced as
> picker hints later — informational, not a blocker.

---

## Q13 — Same-group vs. compatible-but-closer matching

**From §7.4.** Coded: same group first, then compatibility matrix; distance sorts
within a tier.

**Question:** Always prioritise same-group over a closer compatible unit?

**Answer:**

> **Prefer same group.** → Confirms the existing hard-tier matcher (same-group
> first, compatible fallback). No soft-tier override introduced.

---

## Q14 — Massive transfusion protocol (uncrossmatched O− emergency release)

**From §7.5.** Coded: mandatory "crossmatch before transfusion" notice + hospital
confirmation; failure flags a protocol violation.

**Question:** How to handle MTP where uncrossmatched O− is given before
crossmatch?

**Answer:**

> **Yes — support it; same-group units are used** in the MTP path. → Add an "MTP
> / emergency uncrossmatched release" acknowledgement that suppresses the
> crossmatch-violation flag (follow-up UI toggle; documented, not MoU-blocking).

---

## Q15 — Replacement donation

**From §7.6.** Coded: directed donation supported; replacement donation not
explicitly modelled.

**Question:** Explicitly support + log replacement donation for HvPI?

**Answer:**

> **Ethically NO — do not model or encourage replacement donation.** → No
> `donation_type='REPLACEMENT'` path added; voluntary donation only.

---

## Q16 — Self-reported donation history and gap-rule integrity

**From §8.3.** Coded: donor self-enters historical donations (Unverified); they
shape next-eligible-date; BB does an Hb check at donation.

**Question:** Is the BB Hb check sufficient to catch a falsely-old self-reported
prior donation, or impose a stricter rule?

**Answer:**

> **Hb is NOT sufficient** to catch a false self-reported date. → Impose the
> stricter rule: **do not let self-reported donations shorten eligibility** — the
> binding gap is driven only by verified donations (the trigger already gates on
> `trust_level='V'`, so unverified self-reports do not advance next_eligible_date).
> Follow-up: ensure the UI never presents a self-reported entry as gap-clearing.

---

## Q17 — Lookback window, window period, recipient notification chain

**From §9.4.** Coded: trace ALL prior donations (no time cut-off) on reactive
HIV/HBV/HCV.

**Question:** (a) NBTC lookback window in years? (b) 4th-gen ELISA HIV window
period? (c) Who notifies the recipient?

**Answer (a) lookback window:**

> **No specific guideline window** — trace all prior donations (as coded; no
> `INTERVAL 'N years'` filter needed).

**Answer (b) 4th-gen ELISA HIV window period:**

> **~14 days.** → Feeds the counsellor template (recent-window vs chronic).

**Answer (c) notification responsibility:**

> **Blood bank / all three** (BB, hospital, DHO) share responsibility.

---

## Q18 — Thalassemia: advance notice, alloimmunisation, antibody detail

**From §10.2.** Coded: auto-raise PLANNED request 7 days before next transfusion;
single `alloimmunised` boolean.

**Question:** (a) Is 7 days sufficient advance notice? (b) Alloimmunisation
prevalence? (c) Per-antibody detail or a general flag?

**Answer (a) advance notice days:**

> **Yes — 7 days is sufficient** (confirmed by founder follow-up, Q18a = yes).
> → Planned-request scheduler stays at 7 days.

**Answer (b) alloimmunisation prevalence:**

> **No exact figure — sometimes encountered.** Informational only.

**Answer (c) per-antibody detail vs. general flag:**

> **A general "extended crossmatch required" flag is sufficient.** Antibody
> **screening** is done locally; **identification** is referred to higher centres.
> → Keep the single boolean; no per-antibody JSONB needed.

---

## Q19 — Rare blood: reference labs, prevalence, AIIMS registry

**From §11.** Coded: rare-blood registry; national broadcast for Bombay group;
AIIMS registry noted, not integrated.

**Question:** (a) Maharashtra reference labs? (b) Tribal-prevalent rare types?
(c) AIIMS registry contact + process?

**Answer (a) reference labs:**

> **KEM, Mumbai** is the reference laboratory. → Seed KEM Mumbai as the rare-blood
> reference-lab contact.

**Answer (b) tribal-population rare types:**

> **No studies available** for tribal-population-specific rare types beyond sickle.

**Answer (c) AIIMS registry:**

> **No contact yet — can be added later** (founder follow-up, Q19c). Not a
> blocker; wire the AIIMS registry when a contact/MoU exists.

---

## Q20 — Hemovigilance: HvPI format, notification thresholds, generator strategy

**From §12.** Coded: No/Mild/Severe/Suspected-TTI reaction capture; adverse-
reaction table still pending; report returns `{reported:0, note:'…pending'}`.

**Question:** (a) Correct HvPI format & frequency? (b) Which reactions need
immediate DHO/CDSCO notification? (c) Platform-generated HvPI exports or manual?

**Answer (a) HvPI format & frequency:**

> **After investigation, upload to the haemovigilance website;** roughly **6
> months** of data per submission cycle. → Keep raw CSV/JSON export; no bespoke
> HvPI file generator built by the platform.

**Answer (b) immediate-notify thresholds:**

> **A haemolytic reaction → immediate notification.** Others roll up in the
> periodic aggregate.

**Answer (c) generator or manual:**

> **Generation is best done by the blood centres, not the platform** — do NOT
> build an HvPI generator. → Confirms deferring the PDF/Excel HvPI generator; the
> blood bank's medical officer files using our raw export.

---

## Reviewer sign-off

The reviewing haematologist reviewed the BloodConnect / Raktify Medical Review
Document and provided the handwritten answers transcribed above. The signed hard
copy is captured as the 18 image scans in this folder
(`WhatsApp Image 2026-07-10 …`), which are the authoritative record. The
platform's clinical protocols, as conditioned by these answers, are consistent
with current NBTC guidance to the best of the reviewer's knowledge as of the date
below.

**Date answers received:** 10-07-2026
**Signed source:** handwritten scans in `docs/medical-review/` (this folder)

---

## What was applied (traceability)

| Q | Change | Where |
|---|--------|-------|
| Q1 | Hb → 12.5 both genders; drug/medicine-intake question | migration 297, `eligibility.js` |
| Q2 | Cancer no-exception + epilepsy-on-meds permanent (confirm) | `eligibility.js` PE2/PE3 copy |
| Q3 | Gap 90 M / 120 F; SDP 48 h; vaccine live 28 / non-live 14; surgery 3 m; dental extraction 2 wk | migration 297 (`min_gap_days_female` + gender-aware trigger), `002b`, `eligibility.js` |
| Q4 | Trait OK if Hb ≥12.5; no special labelling | `eligibility.js`; matcher note |
| Q5/Q6 | Leukodep/irradiated/CMV-neg = separate licensed products | **Follow-up** (documented) |
| Q7 | PRBC/WB matrix confirmed as-drawn | `002c` renamed |
| Q8 | FFP AB universal; Rh for repeat transfusion | `002c` header |
| Q9 | Platelets: apply Rh; no anti-D prompt | matcher (unchanged) |
| Q10 | Panel complete; no Chagas; accept RPR + VDRL | screening UI/label |
| Q11 | 24 h; BB+platform; ICTC/VCTC referral | `escalate_overdue` (unchanged) |
| Q12/Q13/Q14 | Examples OK; prefer same group; MTP same-group release | matcher/UI (unchanged / follow-up toggle) |
| Q15 | No replacement donation | (no change — not modelled) |
| Q16 | Hb insufficient → only verified donations gate eligibility | trigger already gates `trust_level='V'` |
| Q17 | No fixed lookback; HIV window ~14 d; shared responsibility | lookback (unchanged) + counsellor copy |
| Q18 | 7-day notice OK; general extended-crossmatch flag | scheduler (unchanged); single boolean kept |
| Q19 | KEM Mumbai reference lab; AIIMS later | seed contact; **follow-up** |
| Q20 | Upload to HvPI site; haemolytic → immediate; no generator | reports (unchanged) |
