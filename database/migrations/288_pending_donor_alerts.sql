-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 288: pending_donor_alerts
--
-- Donor-alert timing gate queue. Matcher no longer fires donor_alerts
-- synchronously (spam risk — "crying wolf"). Instead it writes a row here
-- with scheduled_fire_at = now + tier_window:
--
--   CRITICAL:  now + 3 min   (BB-exclusive window before wake donors)
--   URGENT:    now + 30 min
--   PLANNED:   NULL          (never fires; auto-upgrades to URGENT via existing
--                             planned_request_upgrade job when < 4hr from need_by)
--
-- The donor_alert_gate_job scheduler ticks every 30s, evaluates pending rows,
-- rechecks shortfall (may have been offered in the interim), and fires
-- donor_alerts if still needed.
--
-- Bypass paths (fire_immediately-style, set scheduled_fire_at = now):
--   trigger_source = 'BD'  all-eligible-BBs-declined cascade
--   trigger_source = 'CT'  coordinator clicked "Alert donors NOW"
--   trigger_source = 'AD'  ngo_admin manual override
--
-- Coordinator "Hold donor alerts" sets held_at + held_by; scheduler skips
-- held rows even if scheduled_fire_at has elapsed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE pending_donor_alerts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            UUID NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE,

  -- Timer control
  scheduled_fire_at     TIMESTAMPTZ,     -- NULL for PLANNED
  trigger_source        CHAR(2) NOT NULL DEFAULT 'AT'
                        CHECK (trigger_source IN ('AT','BD','CT','AD')),
                        -- AT auto-timer, BD bb-decline-cascade,
                        -- CT coord-triggered, AD admin-manual

  -- Snapshot at scheduling time (for audit; recompute at fire time)
  urgency_snapshot      CHAR(2) NOT NULL,
  shortfall_snapshot    SMALLINT NOT NULL,

  -- Coordinator override
  held_at               TIMESTAMPTZ,
  held_by               UUID REFERENCES platform_users(id),
  held_reason           TEXT,

  -- Fire-time bookkeeping
  evaluated_at          TIMESTAMPTZ,     -- last time scheduler looked at it
  fired_at              TIMESTAMPTZ,     -- when donor_alerts rows were created
  fired_alert_count     SMALLINT DEFAULT 0,
  fire_skip_reason      TEXT,            -- e.g. 'no_eligible_donors', 'fulfilled', 'held'

  created_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by            UUID NOT NULL REFERENCES platform_users(id),

  -- One live pending alert per request; re-triggering updates the row.
  UNIQUE (request_id)
);

CREATE INDEX idx_pending_alerts_fire_at
  ON pending_donor_alerts(scheduled_fire_at)
  WHERE fired_at IS NULL AND held_at IS NULL;
CREATE INDEX idx_pending_alerts_request
  ON pending_donor_alerts(request_id);

SELECT attach_audit_trigger('pending_donor_alerts');

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE pending_donor_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_read ON pending_donor_alerts FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'system')
  );

CREATE POLICY pending_write ON pending_donor_alerts FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'system')
  );

CREATE POLICY pending_update ON pending_donor_alerts FOR UPDATE TO app_user
  USING (fn_is_admin() OR fn_actor_role() IN ('coordinator', 'system'))
  WITH CHECK (fn_is_admin() OR fn_actor_role() IN ('coordinator', 'system'));

CREATE POLICY pending_delete ON pending_donor_alerts FOR DELETE TO app_user
  USING (fn_is_admin() OR fn_actor_role() = 'system');

-- ROLLBACK
-- DROP TABLE pending_donor_alerts;
