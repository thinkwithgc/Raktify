-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 287: open_request_bb_declines
--
-- BB "Can't fulfill this one" signal. When a blood bank looks at an open
-- request they can't help, they record why. The reason drives donor-routing
-- behaviour in the V2 flow (backend/src/routes/inventory.js POST
-- /inventory/open-requests/:id/decline):
--
--   reason = 'NS' (no compatible stock)   → BB CAN still accept incoming donors
--                                          → keep in donor's routing list.
--   reason = 'NC' (no capacity today)     → BB CANNOT accept donors today
--                                          → OMIT from donor's routing list.
--   reason = 'ND' (not on duty)           → same as 'NC'.
--
-- The trust-first posture (env.matching.bbAutoReserve default false) means BBs
-- never have their inventory silently held; this decline is the counterpart —
-- BBs actively signal "not this one" instead of matcher assuming silence =
-- decline.
--
-- 24-hour auto-expiry so BBs re-evaluate as inventory changes. Query filters
-- on expires_at > NOW() (partial index would need immutable predicate).
--
-- All-eligible-BBs-declined cascade: if every BB that has compatible stock
-- has declined with reason='NS', donor-alert-gate treats it as "BBs won't
-- fulfil" and bypasses the timer window entirely (CRITICAL zero-timer per
-- V2 spec Refinement Q3).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE open_request_bb_declines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE,
  blood_bank_id     UUID NOT NULL REFERENCES institutions(id),
  reason            CHAR(2) NOT NULL CHECK (reason IN ('NS','NC','ND')),
  reason_note       TEXT,
  declined_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  declined_by       UUID NOT NULL REFERENCES platform_users(id),
  expires_at        TIMESTAMPTZ NOT NULL
                    DEFAULT clock_timestamp() + INTERVAL '24 hours',
  UNIQUE (request_id, blood_bank_id)
);

CREATE INDEX idx_open_declines_request
  ON open_request_bb_declines(request_id, expires_at);
CREATE INDEX idx_open_declines_bb
  ON open_request_bb_declines(blood_bank_id, declined_at DESC);

-- Audit trail row on every decline / update. Same helper feature tables use
-- (see 099_attach_audit_triggers).
SELECT attach_audit_trigger('open_request_bb_declines');

-- ── RLS ────────────────────────────────────────────────────────────────────
-- blood_bank    can INSERT / UPDATE / SELECT their own decline rows
-- coordinator   can SELECT all (for oversight and cascade evaluation)
-- ngo_admin     can SELECT all
-- system        can SELECT + DELETE (scheduler expiry sweep, cascade check)
-- Nobody outside these roles ever touches this table.

ALTER TABLE open_request_bb_declines ENABLE ROW LEVEL SECURITY;

CREATE POLICY decline_read ON open_request_bb_declines FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'system')
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  );

CREATE POLICY decline_write ON open_request_bb_declines FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  );

CREATE POLICY decline_update ON open_request_bb_declines FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  )
  WITH CHECK (
    fn_is_admin()
    OR (fn_actor_role() = 'blood_bank' AND blood_bank_id = fn_actor_institution_id())
  );

-- Expired rows are cleaned by the donor_alert_gate_job (scheduler).
CREATE POLICY decline_delete ON open_request_bb_declines FOR DELETE TO app_user
  USING (fn_is_admin() OR fn_actor_role() = 'system');

-- ROLLBACK
-- DROP TABLE open_request_bb_declines;
