-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 290: replacement_obligations
--
-- When a BB offers units for a request AND ticks "we need replacement
-- donors," a row lands here. The platform then invites nearby eligible
-- donors to replenish the BB's stock — softly (this is not a CRITICAL alert;
-- 14-day deadline typical, no urgency emoji).
--
-- Design posture (V2 refinement, Option B — support with friction):
--   • The BB offer modal makes the ethical stance visible: "invitation to
--     strangers, not a demand on the patient's family."
--   • Donations arriving via this flow are tagged donation_type='RE' in
--     donation_history (see migration 292) for HvPI reporting split.
--   • Rework expected post-Amravati pilot once real replacement patterns
--     surface — this table is intentionally minimal for v1.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE replacement_obligations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            UUID NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE,
  blood_bank_id         UUID NOT NULL REFERENCES institutions(id),

  units_target          SMALLINT NOT NULL CHECK (units_target > 0),
  units_fulfilled       SMALLINT NOT NULL DEFAULT 0 CHECK (units_fulfilled >= 0),
  deadline_date         DATE NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by            UUID NOT NULL REFERENCES platform_users(id),
  fulfilled_at          TIMESTAMPTZ,

  -- Multiple BB offers on same request can each have their own replacement
  -- obligation (one BB may need replacement, another may not).
  UNIQUE (request_id, blood_bank_id),

  CONSTRAINT fulfilled_within_target CHECK (units_fulfilled <= units_target)
);

CREATE INDEX idx_replacement_open
  ON replacement_obligations(deadline_date)
  WHERE fulfilled_at IS NULL;
CREATE INDEX idx_replacement_bb
  ON replacement_obligations(blood_bank_id, created_at DESC);

SELECT attach_audit_trigger('replacement_obligations');

-- ── RLS ────────────────────────────────────────────────────────────────────
-- blood_bank    can INSERT / SELECT / UPDATE own obligations
-- coordinator   can SELECT all (oversight)
-- ngo_admin     full
-- system        can SELECT + UPDATE (auto-attribution service increments
--                                     units_fulfilled on donation recording)

ALTER TABLE replacement_obligations ENABLE ROW LEVEL SECURITY;

CREATE POLICY repl_read ON replacement_obligations FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'system')
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  );

CREATE POLICY repl_write ON replacement_obligations FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  );

CREATE POLICY repl_update ON replacement_obligations FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() = 'system'
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  )
  WITH CHECK (
    fn_is_admin()
    OR fn_actor_role() = 'system'
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  );

-- ROLLBACK
-- DROP TABLE replacement_obligations;
