-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 289: donor_alert_choices
--
-- When a donor accepts an alert AND picks a BB from the routing list, we
-- record their choice here. This is the linkage that later lets a BB's
-- donation-recording flow auto-attribute the fresh unit to the right request
-- (spec §V2 refinement 2 — auto-attribute on donation).
--
-- State machine:
--
--   'PE' (Pending)  — donor accepted, chose BB, hasn't arrived yet
--   'AR' (Arrived)  — BB confirmed donor is on premises
--   'DO' (Donated)  — donation recorded, unit tied to this choice
--   'NS' (No-show)  — deadline elapsed without arrival
--   'DE' (Deferred) — donor arrived, BB deferred them at intake
--   'CN' (Cancelled)— donor cancelled or coord cancelled
--
-- GPS capture: donor's current lat/lng at accept time, used for distance
-- sorting in the BB list they saw. Stored for audit ("was donor genuinely
-- close to the BB they picked?") — not exposed back to any other role.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE donor_alert_choices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_alert_id        UUID NOT NULL REFERENCES donor_alerts(id) ON DELETE CASCADE,
  donor_id              UUID NOT NULL REFERENCES donors(id),
  request_id            UUID NOT NULL REFERENCES blood_requests(id),
  chosen_blood_bank_id  UUID NOT NULL REFERENCES institutions(id),

  -- Acceptance metadata
  accepted_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expected_arrival_at   TIMESTAMPTZ,        -- donor may declare intended time
  deadline_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '48 hours',

  -- Snapshot at acceptance time
  donor_lat             NUMERIC(9,6),       -- from browser Geolocation API
  donor_lng             NUMERIC(9,6),
  distance_to_bb_km     NUMERIC(6,2),       -- computed at pick time

  -- State
  status                CHAR(2) NOT NULL DEFAULT 'PE'
                        CHECK (status IN ('PE','AR','DO','NS','DE','CN')),
  arrived_at            TIMESTAMPTZ,
  donation_id           UUID REFERENCES donation_history(id),   -- set when DO
  no_show_at            TIMESTAMPTZ,
  deferred_reason       TEXT,
  cancelled_at          TIMESTAMPTZ,
  cancelled_reason      TEXT,

  -- One acceptance per (donor, request); re-picking a BB updates the row.
  UNIQUE (donor_id, request_id)
);

CREATE INDEX idx_choices_donor_active
  ON donor_alert_choices(donor_id, status)
  WHERE status IN ('PE','AR');
CREATE INDEX idx_choices_bb_upcoming
  ON donor_alert_choices(chosen_blood_bank_id, status, deadline_at)
  WHERE status IN ('PE','AR');
CREATE INDEX idx_choices_request
  ON donor_alert_choices(request_id, status);

SELECT attach_audit_trigger('donor_alert_choices');

-- ── RLS ────────────────────────────────────────────────────────────────────
-- donor          can INSERT + SELECT + UPDATE own rows only
-- blood_bank     can SELECT + UPDATE rows where they are the chosen BB
--                (mark AR, DE, NS at intake time)
-- coordinator    can SELECT all + UPDATE (mark CN if needed)
-- ngo_admin      full
-- system         can SELECT all (auto-attribute logic on donation recording)

ALTER TABLE donor_alert_choices ENABLE ROW LEVEL SECURITY;

CREATE POLICY choice_read ON donor_alert_choices FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'system')
    OR (fn_actor_role() = 'blood_bank' AND chosen_blood_bank_id = fn_actor_institution_id())
    OR (fn_actor_role() = 'donor' AND donor_id = (
          SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id() LIMIT 1
        ))
  );

CREATE POLICY choice_write ON donor_alert_choices FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'system')
    OR (fn_actor_role() = 'donor' AND donor_id = (
          SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id() LIMIT 1
        ))
  );

CREATE POLICY choice_update ON donor_alert_choices FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'system')
    OR (fn_actor_role() = 'blood_bank' AND chosen_blood_bank_id = fn_actor_institution_id())
    OR (fn_actor_role() = 'donor' AND donor_id = (
          SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id() LIMIT 1
        ))
  )
  WITH CHECK (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'system')
    OR (fn_actor_role() = 'blood_bank' AND chosen_blood_bank_id = fn_actor_institution_id())
    OR (fn_actor_role() = 'donor' AND donor_id = (
          SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id() LIMIT 1
        ))
  );

-- ROLLBACK
-- DROP TABLE donor_alert_choices;
