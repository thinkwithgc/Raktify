-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 029: request_documents — prescriptions, lab reports, and any
-- supporting documents attached to a blood_request.
--
-- (Spec migration 018 — renumbered to 029.)
--
-- Documents are stored via the storage provider (S3 in prod, local disk in
-- dev). Only the storage_key + checksum live in the DB. Pre-signed URLs are
-- generated on-demand with short expiry (10 minutes per spec §9).
--
-- Documents are IMMUTABLE after upload. No UPDATE on storage_key/checksum/
-- mime_type ever. Replacing a document means uploading a new row and marking
-- the old one is_superseded.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE request_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          UUID NOT NULL REFERENCES blood_requests(id),
  doc_type            CHAR(2) NOT NULL CHECK (doc_type IN ('PR','LR','HR','OT')),
  -- PR Prescription, LR Lab Report, HR Hospital Report, OT Other

  storage_key         TEXT NOT NULL,
  storage_provider    CHAR(2) NOT NULL CHECK (storage_provider IN ('S3','LO')),
  mime_type           TEXT NOT NULL,
  byte_size           INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10 * 1024 * 1024),
  sha256              CHAR(64) NOT NULL,
  original_filename   TEXT,

  uploaded_by_user_id UUID NOT NULL REFERENCES platform_users(id),
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  is_superseded       BOOLEAN NOT NULL DEFAULT FALSE,
  superseded_by_id    UUID REFERENCES request_documents(id),
  superseded_at       TIMESTAMPTZ,
  superseded_reason   TEXT,

  CONSTRAINT mime_whitelist CHECK (
    mime_type IN ('application/pdf','image/jpeg','image/png')
  ),
  CONSTRAINT sha256_format CHECK (sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX idx_docs_request    ON request_documents(request_id) WHERE is_superseded = FALSE;
CREATE INDEX idx_docs_uploader   ON request_documents(uploaded_by_user_id);
CREATE INDEX idx_docs_doc_type   ON request_documents(request_id, doc_type) WHERE is_superseded = FALSE;
CREATE UNIQUE INDEX uq_docs_storage_key ON request_documents(storage_key);

-- Reject any UPDATE that mutates immutable columns.
CREATE OR REPLACE FUNCTION fn_request_docs_immutable()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION 'request_documents row % is immutable on storage/identity columns', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_request_docs_immutable
  BEFORE UPDATE ON request_documents
  FOR EACH ROW EXECUTE FUNCTION fn_request_docs_immutable();

GRANT SELECT, INSERT, UPDATE ON request_documents TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_request_docs_immutable ON request_documents;
-- DROP FUNCTION fn_request_docs_immutable;
-- DROP TABLE request_documents;
