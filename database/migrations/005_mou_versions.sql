-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 005: mou_versions — archive of every signed MoU per institution.
--
-- We keep the FULL history (not just current) because:
--   1. An institution may renew their MoU annually — old versions are still
--      legally relevant for any blood request/donation that took place under
--      that prior version.
--   2. Audit/legal queries ("which MoU was in force on date X?") require it.
--   3. LeegAlly returns a fresh doc_id per signing event.
--
-- Once a row exists in mou_versions, it is IMMUTABLE. RLS forbids UPDATE/DELETE
-- to app_user. The only state that changes is the convenience pointer
-- institutions.mou_signed_at / mou_leegally_doc_id which mirrors the LATEST.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE mou_versions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id           UUID NOT NULL REFERENCES institutions(id),
  version_number           SMALLINT NOT NULL,                 -- 1, 2, 3 ... per institution
  effective_from           DATE NOT NULL,
  effective_until          DATE NOT NULL,                     -- typically +1 year

  -- LeegAlly metadata
  leegally_doc_id          TEXT NOT NULL,
  leegally_template_id     TEXT,
  signed_at                TIMESTAMPTZ NOT NULL,
  signatory_name           TEXT NOT NULL,
  signatory_designation    TEXT,
  signatory_aadhaar_last4  CHAR(4),                           -- never store full Aadhaar

  -- Storage pointer
  pdf_storage_key          TEXT NOT NULL,                     -- key used by storage provider
  pdf_sha256               CHAR(64) NOT NULL,                 -- file integrity check

  -- The MoU template content snapshotted at signing time. Kept so that we
  -- can always reproduce the document the institution actually signed,
  -- regardless of later template revisions.
  template_snapshot        JSONB NOT NULL,

  -- Lifecycle
  superseded_by_id         UUID REFERENCES mou_versions(id),
  cancelled_at             TIMESTAMPTZ,
  cancellation_reason      TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT effective_window CHECK (effective_until > effective_from),
  CONSTRAINT unique_version_per_institution UNIQUE (institution_id, version_number)
);

CREATE INDEX idx_mou_institution           ON mou_versions(institution_id);
CREATE INDEX idx_mou_active_window         ON mou_versions(institution_id, effective_from, effective_until)
  WHERE cancelled_at IS NULL;
CREATE INDEX idx_mou_expiry_warning        ON mou_versions(effective_until)
  WHERE cancelled_at IS NULL AND superseded_by_id IS NULL;

-- Insert-only via app_user. Updates (e.g. cancelled_at, superseded_by_id) require ngo_admin
-- and are routed through admin-only routes; RLS pins this in 100_rls.
GRANT SELECT, INSERT ON mou_versions TO app_user;

-- ROLLBACK
-- DROP TABLE mou_versions;
