# The camp module — attendance derivation and blood-bank capacity

Moved out of `CLAUDE.md` on 2 October 2026. That file is loaded into *every*
agent session and had grown to 48 KB, past the startup limit; this detail is read
when someone is about to touch camps, which is not every session. The invariants
stayed behind as one-liners under **Pilot scope** — read those first, open this
when you are about to change the thing they guard.

Nothing below has been edited, only relocated.

### Camp attendance DERIVES ITSELF — nobody ticks a roster (Aug 2026)

Migrations 312–314 moved attendance out of human hands. Before touching camps:

- **`camp_registrations.status` `'AT'` is written by a trigger**, not by a route.
  Recording a donation with `donation_camp_id` set (and `trust_level IN ('V','R')`)
  upserts the roster row to `'AT'`. `POST /camps/:id/registrations/:regId/status`
  and its magic-link twin **reject `'AT'` and `'NS'` with `409
  attendance_is_derived`** — deliberately loud, so an old client says why.
  Settable statuses are `RG` (revert), `DF` (came, could not donate) and `CN`.
- **`'DF'` is an attendance fact only.** It must never write
  `donors.deferral_until` / `next_eligible_date` — a roster tap is not a clinical
  gate (hard rule 1). The clinical deferral stays on the BB's donation path.
- **No-show is derived too**, by the `camp_close_roster` job (02:10 IST) — `RG` →
  `NS` only once the camp is >48h past **and** either its status is `CO` or the
  roster already holds an `AT`/`DF`. The grace exists because blood banks
  batch-enter a camp's donations the next morning; 314's upsert overwrites `NS`,
  so a late entry self-heals.
- **`is_invalidated` (TTI-reactive) does NOT unwind attendance.** The donation is
  discarded; the person still came.
- **`units_collected`** derives from `COUNT(*)` over the camp's donations; the
  manual field at `POST /camps/:id/complete` only wins when larger, and an
  organiser-reported `attended_donor_count` is **filed into `review_notes` as a
  headcount rather than stored** — it must not overwrite the derived value.
- Every camp a person hosts — donor, coordinator or community leader — lists at
  **`GET /camps/mine`**, keyed on their **mobile** (not their session), which is
  what unifies the two auth clusters without bridging them. `PATCH /camps/:id`
  edits details only; verify / decline / complete / cancel stay behind
  password + TOTP.
- **Gate: `npm run smoke:camps`** (`scripts/smoke_test_camps.js`, 117 assertions)
  covers the whole derivation. `smoke_test_phase4.js` is the regression gate —
  314 adds a trigger to `donation_history`, the most safety-critical insert path
  in the system, so if phase 4 fails, the trigger is wrong.

### Blood banks publish camp capacity, and answer per camp (Aug 2026)

Migrations 315–318 + `backend/src/services/camps/capacity.js` + the BB **Camps**
tab. The NGO admin used to partner a blood bank by fiat and every question after
that click was a phone call. Now the BB **declares capacity a month ahead**, so
the organiser's hosting form pre-answers "can you do the 14th"; the per-camp
accept/decline is the exception path, not the normal one.

- **`bb_response` (`PE`/`AC`/`DC`, migration 317) is an axis ORTHOGONAL to
  `donation_camps.status`** — exactly as `crossmatch_confirmed` sits beside
  `blood_requests.status`. `status` gained no value: it is a CHECK-constrained
  enum (`PE`,`PL`,`LV`,`CO`,`CA`,`DC`) read by `campStatus.js`, the admin
  `CampsTab`, `MyCampsSection`, `PublicCampPage`, `GET /camps/collectable`,
  `camp_close_roster` and a long tail of `IN ('PL','LV')` predicates — a new
  value would make every one of them quietly wrong.
- **`bb_response` never changes `status`, and never changes what
  `GET /camps/collectable` returns.** A decline does not cancel the camp (200
  donors may have RSVP'd) and a BB that declined Monday must still be able to
  collect Saturday. **A decline also does not clear
  `partnered_blood_bank_id`** — that would erase who declined. Re-partnering
  resets to `'PE'` and **must clear all four decline/response columns**, or
  317's `bb_decline_reason_needs_decline` CHECK fails.
- **Two `DC`s, unrelated:** `status='DC'` = the NGO declined the application;
  `bb_response='DC'` = the blood bank declined to collect.
- **`bb_response` states:** `NULL` = organiser named this BB but the NGO has not
  promoted it (no Accept/Decline buttons) · `'PE'` = actionable · `'AC'`/`'DC'`
  = answered. Written `'PE'` in exactly two places (verify, re-partner) —
  **apply never writes `'PE'`**; only `auto_accept_within_capacity` writes a
  partner at apply, stamping `'AC'`.
- **Three day-states in capacity, and only one blocks.** No `bb_camp_capacity`
  row = **not published** (`published:false`, `slots_left:null`, `ok:true`,
  never blocks — absence-as-closed would have stopped camp hosting
  platform-wide on ship day, so **branch on `published`, never `max_camps`**);
  **`max_camps = 0` IS the holiday** (no blackout table — "closed" and
  "reduced" are the same edit); `n` = n bookable slots. `PUT /camps/bb/capacity`
  with `max_camps:null` withdraws a day.
- **Two counts:** `confirmed` = `status IN ('PL','LV') AND
  partnered_blood_bank_id = bb` **blocks**; `pending` = `status='PE' AND
  (partnered = bb OR requested = bb)` is a **warning that never blocks** — one
  abandoned application must not hold a day hostage.
- **Overbooking is enforced in `services/camps/capacity.js`, not the DB.** Staff
  misallocation is not patient safety (hard rule 1), it is a cross-row count a
  CHECK cannot express, and a trigger would remove the admin's emergency
  override. That file is the **single source of occupancy truth** — the BB's
  calendar and the organiser's booking gate read the identical structure, which
  is the whole reason it exists. `staff_total`/`staff_per_camp` are **advisory**
  (they suggest `max_camps`); `max_camps` is what binds.
- **Decline reasons `NC`/`ND`/`DT`/`VE`/`OT` go to the NGO admin, NEVER the
  organiser** — the organiser sees only "we're arranging a different blood
  bank", and `PublicCampPage` is deliberately untouched. **Organiser name +
  mobile are revealed to the accepting BB only** — redacted while
  `bb_response='PE'`, returned after `'AC'`, invisible to every other BB.
- **Migration 318 exists only because `fn_audit_row()` (migration 025)
  hardcodes `NEW.id`/`OLD.id`.** `bb_camp_settings` is keyed on
  `blood_bank_id`, so its own audit trigger threw `record "new" has no field
  "id"`; 316 was already applied and migrations are immutable. **Any table you
  pass to `attach_audit_trigger()` must have a column literally named `id`.**
- **Dates are calendar labels, not instants.** Every `date` in
  capacity/availability responses is a plain `'YYYY-MM-DD'` string. A raw
  `RETURNING scheduled_date` serialises as `…T00:00:00.000Z` — use
  `to_char(scheduled_date,'YYYY-MM-DD')`.
- **The roster PII leak that shipped with this fix:** `GET
  /camps/:id/registrations` granted `blood_bank` with **no institution
  scoping**, so any BB could read any camp's roster including mobiles and
  decrypted names. Now `403 not_your_camp`. RLS is inert at runtime, so the
  handler's own `WHERE` **is** the security boundary — 316's header says so
  verbatim.
- **Post-camp results worklist** `GET /camps/:id/donations` — `ScreeningEntry`
  previously had one way in: paste a donation UUID. The screening endpoints are
  reused byte-for-byte (4-eyes + the separate `screening` key kind untouched).
- **Date inputs:** `frontend/src/components/DateOfBirthInput.jsx` (three
  selects, year list mirroring the DB's `age_min`/`age_max` CHECKs at
  `008_donors.sql:105-106`) and `frontend/src/lib/dateBounds.js` (`todayISO()`
  reads **IST explicitly**). The picker mirrors the constraint, it does not
  become it — `donorSchema.date_of_birth` still validates format only, so a
  bulk upload or vendor webhook still hits the CHECK.
  **The three selects are driven by the component's OWN `{y,m,d}` state, never
  by the `value` prop — do not "simplify" that away** (fixed `c9a8c85`, after
  it shipped broken). `onChange` emits `''` for any incomplete triple, so
  `required` fires on a half-filled picker and the form can never post
  `'1998--07'`. That contract is right, and it is precisely why `value` cannot
  drive the selects: for two taps out of three `value` is `''`, so a
  `value`-derived select snaps back to its placeholder the instant the donor
  touches it and **the triple can never be completed**. `value` seeds the state
  and can override it (an edit form loading a saved DOB, a reset); the guarded
  re-seed `useEffect` stays out of the way while the picker is half-filled,
  because both sides are `''` there. One component, four call sites — donor
  register, donor profile, `ThalassemiaTab`, `DonorBulkUpload`.

