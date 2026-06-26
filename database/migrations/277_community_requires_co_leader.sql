-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 277: every community MUST have ≥ 1 co-leader (moderator).
--
-- Per Phase-1 design Q6 — suspension auto-handover requires a co-leader to
-- exist at the moment a leader is suspended. The user chose option C2
-- (schema-enforced): the database refuses to commit a community without
-- a moderator, regardless of what the application code does.
--
-- Implementation: a CONSTRAINT TRIGGER, DEFERRABLE INITIALLY DEFERRED.
-- Unlike a plain trigger (which fires per-row at the end of the statement),
-- a deferred constraint trigger fires at COMMIT time — so the backend can:
--   1. BEGIN
--   2. INSERT INTO communities(...)        — community row created, trigger
--                                            check is QUEUED, not run yet
--   3. INSERT INTO community_moderators    — co-leader added (different row)
--   4. COMMIT                              — trigger fires now, sees the
--                                            moderator row exists, passes
--
-- If step 3 is missing or wrong, the trigger raises at commit time and the
-- whole transaction rolls back atomically — community + (any partial)
-- moderator rows all undone.
--
-- Limitations:
--   • Only checks at COMMIT (not statement-end). Applications must batch
--     community + moderator into one transaction.
--   • Doesn't check on DELETE of the last moderator (a separate trigger
--     could enforce "can't drop the last moderator while community is
--     active" — TODO for Phase 3 if real users start hitting this).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_community_requires_co_leader()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM community_moderators WHERE community_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'community_must_have_co_leader: community % has no moderator at commit time', NEW.id
      USING ERRCODE = '23514'; -- check_violation (mirrors a regular CHECK failure)
  END IF;
  RETURN NULL; -- AFTER trigger return value is ignored
END;
$$;

CREATE CONSTRAINT TRIGGER trg_community_requires_co_leader
  AFTER INSERT OR UPDATE ON communities
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_community_requires_co_leader();

COMMENT ON FUNCTION fn_community_requires_co_leader IS
  'Constraint trigger: at COMMIT time, every community row must have ≥ 1 row in community_moderators with matching community_id. Suspension-handover invariant — without a co-leader, a suspended leader leaves the community ownerless.';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_community_requires_co_leader ON communities;
-- DROP FUNCTION IF EXISTS fn_community_requires_co_leader;
