-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 230: bot_sessions — conversation state for the WhatsApp bot.
--
-- Spec §8: "Registration conversation state stored in Redis (or a simple
-- sessions table if Redis not available in v1) with TTL of 1 hour."
--
-- We default to the sessions table since it's a single dependency and
-- already-encrypted by RDS at rest. Cleanup is by a scheduled job that
-- deletes expired rows (services/scheduler/jobs/bot-session-cleanup.js).
--
-- One row per conversation. Keyed on the WhatsApp mobile (CHAR(13) plaintext
-- per encryption policy). Conversation-state machine values used by
-- services/whatsapp/bot.js:
--   IDLE | NAME | DOB | GENDER | VILLAGE | CONSENT | COMPLETE | INV_UPDATE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE bot_sessions (
  mobile        CHAR(13) PRIMARY KEY,
  state         TEXT NOT NULL DEFAULT 'IDLE',
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_msg_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bot_sessions_expiry ON bot_sessions(expires_at);

-- The sessions table contains transient PII collected mid-conversation.
-- Keep it under app_user only; admins can read for support but not write.
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_sessions TO app_user;

ALTER TABLE bot_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY bot_sessions_system ON bot_sessions
  FOR ALL TO app_user
  USING (
    fn_actor_role() IN ('system', 'webhook', 'ngo_admin', 'super_admin')
  )
  WITH CHECK (
    fn_actor_role() IN ('system', 'webhook', 'ngo_admin', 'super_admin')
  );

-- ROLLBACK
-- DROP TABLE bot_sessions;
