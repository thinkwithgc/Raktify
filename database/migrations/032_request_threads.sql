-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 032: request_threads — per-message rows for the coordinator chat
-- attached to a blood_request.
--
-- (Spec migration 021 — renumbered to 032.)
--
-- Why a row-per-message (not a JSON blob on blood_requests):
--   - Sortable, filterable, indexable
--   - Auditable (each message gets per-row audit chain)
--   - Visibility control per row (visible_to_roles[])
--
-- System messages (status changes, escalation, donor confirmations) are
-- inserted by triggers in other tables with message_type='SYSTEM' and
-- author_user_id = NULL.
--
-- Edit window: coordinators can edit their own messages within 5 minutes;
-- after that, edits are blocked by trg_threads_edit_window. The pre-edit
-- text is preserved in edit_original_text (one-shot — no edit history beyond
-- the original).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE request_threads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id               UUID NOT NULL REFERENCES blood_requests(id),

  message_type             CHAR(2) NOT NULL CHECK (message_type IN
                            ('CO','SY','HO','BB','ND','DH')),
  -- CO Coordinator chat   SY System auto-post  HO Hospital chat
  -- BB Blood-bank chat    ND Note-to-donor     DH Donor-to-hospital relay

  message_text             TEXT NOT NULL,
  attachment_storage_key   TEXT,
  attachment_mime          TEXT,

  author_user_id           UUID REFERENCES platform_users(id),    -- NULL for SY
  author_role              TEXT NOT NULL,                         -- denormalized for display
  visible_to_roles         TEXT[] NOT NULL
                           DEFAULT ARRAY['coordinator','hospital','blood_bank','ngo_admin','super_admin'],

  -- Edit history (single-shot)
  edit_original_text       TEXT,
  edited_at                TIMESTAMPTZ,
  edited_by_user_id        UUID REFERENCES platform_users(id),

  posted_at                TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  is_deleted               BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at               TIMESTAMPTZ,
  deleted_by_user_id       UUID REFERENCES platform_users(id),
  deletion_reason          TEXT
);

CREATE INDEX idx_threads_request_time ON request_threads(request_id, posted_at);
CREATE INDEX idx_threads_author       ON request_threads(author_user_id) WHERE author_user_id IS NOT NULL;
CREATE INDEX idx_threads_visibility   ON request_threads USING gin (visible_to_roles);

-- Edit window enforcement: 5 minutes per spec §7.
CREATE OR REPLACE FUNCTION fn_threads_edit_window()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.message_text IS DISTINCT FROM NEW.message_text THEN
    IF clock_timestamp() - OLD.posted_at > INTERVAL '5 minutes' THEN
      RAISE EXCEPTION 'Edit window expired for thread message %', OLD.id;
    END IF;
    IF NEW.author_user_id <> OLD.author_user_id THEN
      RAISE EXCEPTION 'Only the original author may edit thread message %', OLD.id;
    END IF;
    -- Preserve original text on first edit; subsequent edits stack on edited_at.
    IF NEW.edit_original_text IS NULL THEN
      NEW.edit_original_text = OLD.message_text;
    END IF;
    NEW.edited_at = clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_threads_edit_window
  BEFORE UPDATE ON request_threads
  FOR EACH ROW EXECUTE FUNCTION fn_threads_edit_window();

GRANT SELECT, INSERT, UPDATE ON request_threads TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_threads_edit_window ON request_threads;
-- DROP FUNCTION fn_threads_edit_window;
-- DROP TABLE request_threads;
