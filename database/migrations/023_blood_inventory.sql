-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 023: blood_inventory — one row per physical blood bag.
--
-- (Spec migration 013 — renumbered to 023.)
--
-- Bag lifecycle (status):
--   QA Quarantine        — fresh, awaiting TTI clearance
--   AV Available         — cleared, ready for issue
--   RE Reserved          — held for a specific blood_request
--   IS Issued            — issued to a recipient hospital
--   TR Transfused        — confirmed transfused (terminal happy state)
--   US Unsuitable        — failed crossmatch / quality fail
--   EX Expired           — past expiry_date, auto-set by job
--   RC Recalled          — pulled per lookback (terminal sad state)
--   WA Wasted            — administrative wastage (e.g. unused returned, broken)
--
-- Status transitions are policed by trg_inventory_status_validate (added in
-- migration 099 along with screening gating).
--
-- Source codes:
--   MA Manual entry      — entered by blood bank UI
--   WB WhatsApp bot      — opening stock, legacy/no TTI
--   RA Retroactive       — recorded for past donation
--   BP BloodPath/partner — synced from partner software
--   ER External record   — third-party reconciliation
--   FH From history      — reconstructed from donation_history
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE blood_inventory (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  isbt_barcode              TEXT NOT NULL UNIQUE,
  donation_id               UUID NOT NULL REFERENCES donation_history(id),
  donor_id                  UUID NOT NULL REFERENCES donors(id),    -- denormalized for lookback speed
  blood_bank_id             UUID NOT NULL REFERENCES institutions(id),
  blood_group_id            SMALLINT NOT NULL REFERENCES blood_groups(id),
  component_id              SMALLINT NOT NULL REFERENCES blood_components(id),
  volume_ml                 SMALLINT NOT NULL CHECK (volume_ml > 0),

  collection_date           DATE NOT NULL,
  processing_date           DATE,
  expiry_date               DATE NOT NULL,                          -- calculated by trigger
  expiry_alert_sent_48h     BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_alert_sent_24h     BOOLEAN NOT NULL DEFAULT FALSE,

  status                    CHAR(2) NOT NULL DEFAULT 'QA'
                            CHECK (status IN ('QA','AV','RE','IS','TR','US','EX','RC','WA')),
  status_changed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_by         UUID NOT NULL REFERENCES platform_users(id),
  storage_location          TEXT,

  reserved_for_request_id   UUID,                                   -- FK added in 027 (blood_requests)
  reserved_at               TIMESTAMPTZ,
  issued_to_institution_id  UUID REFERENCES institutions(id),
  issued_at                 TIMESTAMPTZ,

  is_recalled               BOOLEAN NOT NULL DEFAULT FALSE,
  recall_reason             TEXT,                                   -- encrypted
  recall_initiated_by       UUID REFERENCES platform_users(id),
  recall_initiated_at       TIMESTAMPTZ,

  source                    CHAR(2) NOT NULL DEFAULT 'MA'
                            CHECK (source IN ('MA','WB','RA','BP','ER','FH')),
  last_synced_at            TIMESTAMPTZ,
  external_id               TEXT,                                   -- partner software ID

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT reserve_consistency CHECK (
    (status = 'RE') = (reserved_for_request_id IS NOT NULL)
  ),
  CONSTRAINT issue_consistency CHECK (
    (status IN ('IS','TR')) = (issued_to_institution_id IS NOT NULL)
  ),
  CONSTRAINT recall_consistency CHECK (
    (is_recalled = FALSE) OR (recall_reason IS NOT NULL AND recall_initiated_by IS NOT NULL)
  )
);

CREATE INDEX idx_inventory_blood_bank      ON blood_inventory(blood_bank_id);
CREATE INDEX idx_inventory_available_match ON blood_inventory(blood_group_id, component_id, status, expiry_date)
  WHERE status = 'AV' AND is_recalled = FALSE;
CREATE INDEX idx_inventory_donor           ON blood_inventory(donor_id);                     -- for lookback
CREATE INDEX idx_inventory_donation        ON blood_inventory(donation_id);
CREATE INDEX idx_inventory_expiry_window   ON blood_inventory(expiry_date)
  WHERE status = 'AV' AND is_recalled = FALSE;
CREATE INDEX idx_inventory_reserved_for    ON blood_inventory(reserved_for_request_id)
  WHERE reserved_for_request_id IS NOT NULL;

-- Calculate expiry_date = collection_date + component shelf_life_days, on INSERT.
CREATE OR REPLACE FUNCTION fn_inventory_set_expiry()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_shelf SMALLINT;
BEGIN
  SELECT shelf_life_days INTO v_shelf FROM blood_components WHERE id = NEW.component_id;
  IF v_shelf IS NULL THEN
    RAISE EXCEPTION 'Unknown component_id % — cannot compute expiry', NEW.component_id;
  END IF;
  NEW.expiry_date = NEW.collection_date + (v_shelf * INTERVAL '1 day');
  IF NEW.expiry_date <= CURRENT_DATE THEN
    RAISE EXCEPTION 'Inventory rejected: expiry_date % is not in the future', NEW.expiry_date;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_inventory_set_expiry
  BEFORE INSERT ON blood_inventory
  FOR EACH ROW EXECUTE FUNCTION fn_inventory_set_expiry();

-- Status-change book-keeping. Validates legal transitions and stamps timestamps.
CREATE OR REPLACE FUNCTION fn_inventory_status_validate()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Always stamp the change.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = clock_timestamp();
  END IF;

  -- Legal transitions matrix.
  -- Once a bag is in a terminal state (TR, EX, US, RC, WA), it cannot move.
  IF OLD.status IN ('TR','EX','US','RC','WA') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Inventory bag % is in terminal state %; cannot transition to %',
      OLD.id, OLD.status, NEW.status;
  END IF;

  -- AV requires donor_screening.overall_clearance = 'CL' for this donation.
  -- (Spec §3 trg_inventory_status_gate.)  Source 'WB' (legacy WhatsApp opening
  -- stock) is exempt and labelled "no TTI record" in the UI.
  IF NEW.status = 'AV' AND OLD.status IS DISTINCT FROM 'AV' AND NEW.source <> 'WB' THEN
    PERFORM 1 FROM donor_screening
              WHERE donation_id = NEW.donation_id AND overall_clearance = 'CL';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cannot mark inventory bag AVailable: no cleared TTI screening for donation %',
        NEW.donation_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_inventory_status_validate
  BEFORE UPDATE OF status, source ON blood_inventory
  FOR EACH ROW EXECUTE FUNCTION fn_inventory_status_validate();

CREATE OR REPLACE FUNCTION fn_inventory_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_inventory_touch
  BEFORE UPDATE ON blood_inventory
  FOR EACH ROW EXECUTE FUNCTION fn_inventory_touch();

-- Donation→inventory creation: when a donation_history row is inserted with
-- trust_level='V' AND blood_bank_id IS NOT NULL AND isbt_barcode IS NOT NULL,
-- automatically create a blood_inventory row in QA status.
-- The donor's blood_group_verified is captured into the inventory row.
CREATE OR REPLACE FUNCTION fn_donation_creates_inventory()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_blood_group SMALLINT;
BEGIN
  IF NEW.trust_level <> 'V' OR NEW.blood_bank_id IS NULL OR NEW.isbt_barcode IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT blood_group_verified INTO v_blood_group FROM donors WHERE id = NEW.donor_id;
  IF v_blood_group IS NULL THEN
    RAISE EXCEPTION 'Donor % has no blood_group_verified — cannot create inventory bag', NEW.donor_id;
  END IF;

  INSERT INTO blood_inventory (
    isbt_barcode, donation_id, donor_id, blood_bank_id,
    blood_group_id, component_id, volume_ml, collection_date,
    status, status_changed_by, source
  ) VALUES (
    NEW.isbt_barcode, NEW.id, NEW.donor_id, NEW.blood_bank_id,
    v_blood_group, NEW.component_id, NEW.volume_ml, NEW.collection_date,
    'QA', NEW.recorded_by_user_id, 'MA'
  );

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_donation_creates_inventory
  AFTER INSERT ON donation_history
  FOR EACH ROW EXECUTE FUNCTION fn_donation_creates_inventory();

-- Cleared-screening → bag(s) move from QA to AV automatically.
CREATE OR REPLACE FUNCTION fn_screening_clearance_moves_inventory()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.overall_clearance = 'CL'
     AND (OLD IS NULL OR OLD.overall_clearance IS DISTINCT FROM 'CL') THEN
    UPDATE blood_inventory
       SET status = 'AV',
           status_changed_at = clock_timestamp(),
           status_changed_by = COALESCE(NEW.verified_by, NEW.entered_by)
     WHERE donation_id = NEW.donation_id AND status = 'QA';
  ELSIF NEW.overall_clearance = 'IN'
     AND (OLD IS NULL OR OLD.overall_clearance IS DISTINCT FROM 'IN') THEN
    UPDATE blood_inventory
       SET is_recalled = TRUE,
           recall_reason = COALESCE(recall_reason, 'TTI reactive — lookback'),
           recall_initiated_by = NEW.verified_by,
           recall_initiated_at = clock_timestamp(),
           status = CASE WHEN status IN ('QA','AV','RE') THEN 'RC' ELSE status END,
           status_changed_at = clock_timestamp(),
           status_changed_by = COALESCE(NEW.verified_by, NEW.entered_by)
     WHERE donor_id = NEW.donor_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_screening_clearance_moves_inventory
  AFTER INSERT OR UPDATE OF overall_clearance ON donor_screening
  FOR EACH ROW EXECUTE FUNCTION fn_screening_clearance_moves_inventory();

GRANT SELECT, INSERT, UPDATE ON blood_inventory TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_screening_clearance_moves_inventory ON donor_screening;
-- DROP FUNCTION fn_screening_clearance_moves_inventory;
-- DROP TRIGGER trg_donation_creates_inventory ON donation_history;
-- DROP FUNCTION fn_donation_creates_inventory;
-- DROP TRIGGER trg_inventory_touch ON blood_inventory;
-- DROP FUNCTION fn_inventory_touch;
-- DROP TRIGGER trg_inventory_status_validate ON blood_inventory;
-- DROP FUNCTION fn_inventory_status_validate;
-- DROP TRIGGER trg_inventory_set_expiry ON blood_inventory;
-- DROP FUNCTION fn_inventory_set_expiry;
-- DROP TABLE blood_inventory;
