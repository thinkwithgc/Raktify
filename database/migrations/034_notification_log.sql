-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 034: notification_log — every WhatsApp / SMS / voice call sent.
--
-- (Spec migration 023 — renumbered to 034.)
--
-- Single source of truth for outbound messaging. Backed by sendNotification()
-- (backend/src/services/notifications/index.js). Used for:
--   - Delivery status tracking (MSG91 webhooks update this)
--   - Cost tracking (cost_inr per row)
--   - Opt-out enforcement (when delivery_status='OP', the corresponding
--     trg_opt_out_propagate updates donors.sms_opted_in / whatsapp_opted_in)
--   - Audit / compliance (DLT template ID per send)
--
-- One row per send attempt. Fallback chain (WA→SM→CA per spec §6) creates
-- multiple rows linked by parent_notification_id.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE notification_log (
  id                       BIGSERIAL PRIMARY KEY,

  -- Recipient (one of)
  recipient_donor_id       UUID REFERENCES donors(id),
  recipient_user_id        UUID REFERENCES platform_users(id),
  recipient_institution_id UUID REFERENCES institutions(id),
  recipient_external_mobile CHAR(13),                              -- encrypted; for guest hospital DHO etc.

  -- Categorisation
  channel                  CHAR(2) NOT NULL CHECK (channel IN ('WA','SM','CA','EM')),
  template_type            TEXT NOT NULL,                          -- 'OTP','EMG','THK','REM','CRED' …
  language                 CHAR(2) NOT NULL DEFAULT 'mr' CHECK (language IN ('mr','hi','en')),
  msg91_template_id        TEXT,                                   -- DLT-registered template ID
  template_variables       JSONB,                                  -- variable bindings used

  -- Context
  related_request_id       UUID REFERENCES blood_requests(id),
  related_alert_id         UUID REFERENCES donor_alerts(id),
  related_screening_id     UUID,                                   -- not FKed to avoid TTI leak via FK chain
  context_tag              TEXT,                                   -- free-form for ops dashboards

  -- Sending + delivery
  parent_notification_id   BIGINT REFERENCES notification_log(id), -- for fallback chains
  sent_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider                 CHAR(2) NOT NULL DEFAULT 'M9'
                           CHECK (provider IN ('M9','LO')),        -- M9 MSG91, LO local-console
  provider_message_id      TEXT,
  delivery_status          CHAR(2) NOT NULL DEFAULT 'SE'
                           CHECK (delivery_status IN ('SE','DL','RD','FA','OP','UN')),
  delivery_status_updated  TIMESTAMPTZ,
  failure_reason           TEXT,

  -- Costing (optional but useful for monthly DHO reports)
  cost_inr                 NUMERIC(8,4),
  cost_currency            CHAR(3) NOT NULL DEFAULT 'INR',

  -- Compliance flags
  was_dnd_overridden       BOOLEAN NOT NULL DEFAULT FALSE,         -- TRUE iff Critical bypass
  is_opt_out_trigger       BOOLEAN NOT NULL DEFAULT FALSE,         -- set by webhook when delivery_status='OP'

  CONSTRAINT recipient_present CHECK (
    recipient_donor_id IS NOT NULL OR recipient_user_id IS NOT NULL
    OR recipient_institution_id IS NOT NULL OR recipient_external_mobile IS NOT NULL
  )
);

CREATE INDEX idx_notif_recipient_donor   ON notification_log(recipient_donor_id) WHERE recipient_donor_id IS NOT NULL;
CREATE INDEX idx_notif_recipient_user    ON notification_log(recipient_user_id) WHERE recipient_user_id IS NOT NULL;
CREATE INDEX idx_notif_request           ON notification_log(related_request_id) WHERE related_request_id IS NOT NULL;
CREATE INDEX idx_notif_alert             ON notification_log(related_alert_id) WHERE related_alert_id IS NOT NULL;
CREATE INDEX idx_notif_status_recent     ON notification_log(delivery_status, sent_at DESC);
CREATE INDEX idx_notif_template_recent   ON notification_log(template_type, sent_at DESC);

-- Opt-out propagation: when a notification's delivery_status flips to 'OP',
-- update the donor's per-channel opt-in flag immediately.
-- Spec §6 trg_opt_out_propagate.
CREATE OR REPLACE FUNCTION fn_notif_propagate_opt_out()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.delivery_status = 'OP' AND (OLD.delivery_status IS DISTINCT FROM 'OP')
     AND NEW.recipient_donor_id IS NOT NULL THEN
    NEW.is_opt_out_trigger = TRUE;
    IF NEW.channel = 'WA' THEN
      UPDATE donors SET whatsapp_opted_in = FALSE,
                        updated_at = clock_timestamp()
       WHERE id = NEW.recipient_donor_id;
    ELSIF NEW.channel = 'SM' THEN
      UPDATE donors SET sms_opted_in = FALSE,
                        updated_at = clock_timestamp()
       WHERE id = NEW.recipient_donor_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notif_propagate_opt_out
  BEFORE UPDATE OF delivery_status ON notification_log
  FOR EACH ROW EXECUTE FUNCTION fn_notif_propagate_opt_out();

GRANT SELECT, INSERT, UPDATE ON notification_log TO app_user;
GRANT USAGE, SELECT ON SEQUENCE notification_log_id_seq TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_notif_propagate_opt_out ON notification_log;
-- DROP FUNCTION fn_notif_propagate_opt_out;
-- DROP TABLE notification_log;
