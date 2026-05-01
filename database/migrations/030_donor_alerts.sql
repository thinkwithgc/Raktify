-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 030: donor_alerts — per-donor response tracking for a request.
--
-- (Spec migration 019 — renumbered to 030.)
--
-- One row per donor that the matching engine alerted for a given request.
-- The donor's response (YES, NO, NS no-show, etc.) is captured here so we
-- can compute reliability_score and feed the Phase 5 escalation logic.
--
-- A donor may receive multiple alerts in the lifetime of one request
-- (initial → reminder → escalation), but only ONE row per (request, donor)
-- — subsequent contacts are recorded on the same row by updating
-- reminders_sent + last_contacted_at.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE donor_alerts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id               UUID NOT NULL REFERENCES blood_requests(id),
  donor_id                 UUID NOT NULL REFERENCES donors(id),

  -- Why this donor was selected
  match_reason             TEXT NOT NULL,                          -- e.g. 'same group, 4km, score 95'
  distance_km              NUMERIC(5,1),
  is_fallback_match        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Channel + delivery
  channel                  CHAR(2) NOT NULL CHECK (channel IN ('WA','SM','CA')),
  alerted_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_status          CHAR(2) NOT NULL DEFAULT 'SE'
                           CHECK (delivery_status IN ('SE','DL','RD','FA','OP')),
  delivery_status_at       TIMESTAMPTZ,
  reminders_sent           SMALLINT NOT NULL DEFAULT 0 CHECK (reminders_sent BETWEEN 0 AND 5),
  last_contacted_at        TIMESTAMPTZ,

  -- Donor response
  donor_response           CHAR(2) CHECK (donor_response IN ('YE','NO','MA','NS','UN')),
  -- YE Yes  NO No  MA Maybe-call-me  NS No-show  UN Unreachable
  responded_at             TIMESTAMPTZ,
  arrival_committed_at     TIMESTAMPTZ,
  arrived_at               TIMESTAMPTZ,
  donated_donation_id      UUID REFERENCES donation_history(id),

  -- Coordinator notes about this donor for this request
  coordinator_notes        TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_one_alert_per_donor_per_request
  ON donor_alerts(request_id, donor_id);
CREATE INDEX idx_donor_alerts_donor      ON donor_alerts(donor_id, alerted_at DESC);
CREATE INDEX idx_donor_alerts_request    ON donor_alerts(request_id);
CREATE INDEX idx_donor_alerts_pending    ON donor_alerts(request_id) WHERE donor_response IS NULL;
CREATE INDEX idx_donor_alerts_no_show    ON donor_alerts(donor_id) WHERE donor_response = 'NS';

CREATE OR REPLACE FUNCTION fn_donor_alerts_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_donor_alerts_touch
  BEFORE UPDATE ON donor_alerts
  FOR EACH ROW EXECUTE FUNCTION fn_donor_alerts_touch();

-- When donor_response transitions to NS (no-show), bump donor.no_show_count
-- and recompute reliability_score (spec §7).
CREATE OR REPLACE FUNCTION fn_donor_alerts_apply_noshow()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.donor_response = 'NS' AND (OLD.donor_response IS NULL OR OLD.donor_response <> 'NS') THEN
    UPDATE donors
       SET no_show_count = no_show_count + 1,
           reliability_score = GREATEST(0, reliability_score - 10),
           updated_at = clock_timestamp()
     WHERE id = NEW.donor_id;
  ELSIF OLD.donor_response = 'NS' AND NEW.donor_response IS DISTINCT FROM 'NS' THEN
    -- Coordinator corrected an erroneous no-show.
    UPDATE donors
       SET no_show_count = GREATEST(0, no_show_count - 1),
           reliability_score = LEAST(100, reliability_score + 10),
           updated_at = clock_timestamp()
     WHERE id = NEW.donor_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_donor_alerts_apply_noshow
  AFTER UPDATE OF donor_response ON donor_alerts
  FOR EACH ROW EXECUTE FUNCTION fn_donor_alerts_apply_noshow();

GRANT SELECT, INSERT, UPDATE ON donor_alerts TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_donor_alerts_apply_noshow ON donor_alerts;
-- DROP FUNCTION fn_donor_alerts_apply_noshow;
-- DROP TRIGGER trg_donor_alerts_touch ON donor_alerts;
-- DROP FUNCTION fn_donor_alerts_touch;
-- DROP TABLE donor_alerts;
