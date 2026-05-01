-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 035: lookback_registry — donor-to-recipient traceability chain.
--
-- (Spec migration 024 — renumbered to 035.)
--
-- Legal requirement (NBTC). When a donor's TTI screening turns reactive
-- post-donation, every recipient of any blood from that donor must be
-- contactable via the receiving hospital. The lookback_registry records:
--   - which past donations are implicated
--   - which inventory bags were created from each
--   - which recipient hospital received each issued bag (when known)
--   - the investigation status, hospital contact, DHO notification, closure
--
-- A row is created automatically by the lookback trigger fired when
-- donor_screening.overall_clearance becomes 'IN'. The atomic transaction
-- (spec §6) creates one row PER PRIOR VERIFIED DONATION of the donor.
--
-- Lookback urgency: an IS-status (issued) bag at the moment of trigger means
-- that bag's recipient may have received unsafe blood. These get the
-- highest priority and trigger immediate WhatsApp + voice contact to the
-- receiving hospital (handled by the lookback service in Phase 6).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE lookback_registry (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id                 UUID NOT NULL REFERENCES donors(id),
  donation_id              UUID NOT NULL REFERENCES donation_history(id),
  triggering_screening_id  UUID NOT NULL,                          -- donor_screening row that fired this
  tti_trigger              TEXT[] NOT NULL,                        -- e.g. ARRAY['HIV','HBsAg']

  -- Implicated bags
  inventory_bag_ids        UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  bags_recalled_count      INTEGER NOT NULL DEFAULT 0,
  bags_already_issued      INTEGER NOT NULL DEFAULT 0,
  bags_already_transfused  INTEGER NOT NULL DEFAULT 0,

  -- Receiving hospitals (for issued/transfused bags)
  receiving_institution_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],

  -- Investigation lifecycle
  lookback_status          CHAR(2) NOT NULL DEFAULT 'OP'
                           CHECK (lookback_status IN ('OP','IP','CN','RV','CL','EX')),
  -- OP Open  IP In progress  CN Hospital contacted  RV Recipient verified
  -- CL Closed (resolved)  EX Closed (could not resolve)

  hospital_contacted_at    TIMESTAMPTZ,
  hospital_contacted_by    UUID REFERENCES platform_users(id),
  hospital_response        TEXT,                                   -- encrypted; receiver-side update
  recipient_verified_at    TIMESTAMPTZ,
  outcome_notes            TEXT,                                   -- encrypted; mandatory at close

  -- DHO notification (mandatory for HIV / HBsAg per public-health rules)
  dho_notified             BOOLEAN NOT NULL DEFAULT FALSE,
  dho_notified_at          TIMESTAMPTZ,
  dho_notification_ref     TEXT,

  closed_at                TIMESTAMPTZ,
  closed_by                UUID REFERENCES platform_users(id),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT close_requires_outcome CHECK (
    lookback_status NOT IN ('CL','EX') OR outcome_notes IS NOT NULL
  )
);

CREATE INDEX idx_lookback_donor          ON lookback_registry(donor_id);
CREATE INDEX idx_lookback_open           ON lookback_registry(lookback_status)
  WHERE lookback_status IN ('OP','IP','CN');
CREATE INDEX idx_lookback_recent         ON lookback_registry(created_at DESC);
CREATE INDEX idx_lookback_dho_pending    ON lookback_registry(dho_notified, lookback_status)
  WHERE dho_notified = FALSE;

CREATE OR REPLACE FUNCTION fn_lookback_touch()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  -- Stamp closed_at when status transitions to CL or EX.
  IF NEW.lookback_status IN ('CL','EX')
     AND OLD.lookback_status NOT IN ('CL','EX')
     AND NEW.closed_at IS NULL THEN
    NEW.closed_at = clock_timestamp();
  END IF;
  -- HIV/HBsAg lookbacks REQUIRE DHO notification before close (spec §6).
  IF NEW.lookback_status IN ('CL','EX')
     AND (NEW.tti_trigger && ARRAY['HIV','HBsAg'])
     AND NEW.dho_notified = FALSE THEN
    RAISE EXCEPTION 'Cannot close lookback %: HIV/HBsAg requires dho_notified=TRUE', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_lookback_touch
  BEFORE UPDATE ON lookback_registry
  FOR EACH ROW EXECUTE FUNCTION fn_lookback_touch();

-- The actual lookback creation trigger is on donor_screening (clearance → IN).
-- One atomic transaction per spec §6: defer status updates and bag recall
-- changes are already handled by fn_screening_clearance_moves_inventory in
-- migration 023; we just need to insert lookback rows here.
CREATE OR REPLACE FUNCTION fn_lookback_fire_on_clearance()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_donation       RECORD;
  v_bag_ids        UUID[];
  v_recv_inst_ids  UUID[];
  v_already_issued INTEGER;
  v_already_trans  INTEGER;
  v_recalled_count INTEGER;
  v_tti            TEXT[];
BEGIN
  IF NEW.overall_clearance <> 'IN'
     OR (OLD IS NOT NULL AND OLD.overall_clearance = 'IN') THEN
    RETURN NEW;
  END IF;

  -- Build TTI trigger list from the reactive flags.
  v_tti := ARRAY[]::TEXT[];
  IF NEW.hiv_status = 'RR'      THEN v_tti := v_tti || 'HIV'; END IF;
  IF NEW.hbsag_status = 'RR'    THEN v_tti := v_tti || 'HBsAg'; END IF;
  IF NEW.hcv_status = 'RR'      THEN v_tti := v_tti || 'HCV'; END IF;
  IF NEW.syphilis_status = 'RR' THEN v_tti := v_tti || 'Syphilis'; END IF;
  IF NEW.malaria_status = 'RR'  THEN v_tti := v_tti || 'Malaria'; END IF;

  -- Defer the donor's overall deferral status (spec §6 step 1).
  UPDATE donors
     SET deferral_status = CASE
                              WHEN 'HIV' = ANY(v_tti) OR 'HBsAg' = ANY(v_tti) THEN 'P'
                              ELSE 'T' END,
         deferral_reason = 'TTI reactive — under lookback',
         updated_at = clock_timestamp()
   WHERE id = NEW.donor_id;

  -- One lookback row per prior verified donation by this donor.
  FOR v_donation IN
    SELECT id FROM donation_history
     WHERE donor_id = NEW.donor_id AND trust_level = 'V'
  LOOP
    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]),
           COALESCE(array_agg(DISTINCT issued_to_institution_id) FILTER (WHERE issued_to_institution_id IS NOT NULL), ARRAY[]::UUID[]),
           COUNT(*) FILTER (WHERE status IN ('IS','TR')),
           COUNT(*) FILTER (WHERE status = 'TR'),
           COUNT(*) FILTER (WHERE status = 'RC')
      INTO v_bag_ids, v_recv_inst_ids, v_already_issued, v_already_trans, v_recalled_count
      FROM blood_inventory
     WHERE donation_id = v_donation.id;

    INSERT INTO lookback_registry (
      donor_id, donation_id, triggering_screening_id, tti_trigger,
      inventory_bag_ids, bags_recalled_count,
      bags_already_issued, bags_already_transfused,
      receiving_institution_ids
    ) VALUES (
      NEW.donor_id, v_donation.id, NEW.id, v_tti,
      v_bag_ids, v_recalled_count,
      v_already_issued, v_already_trans,
      v_recv_inst_ids
    );
  END LOOP;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_lookback_fire_on_clearance
  AFTER INSERT OR UPDATE OF overall_clearance ON donor_screening
  FOR EACH ROW EXECUTE FUNCTION fn_lookback_fire_on_clearance();

GRANT SELECT, INSERT, UPDATE ON lookback_registry TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_lookback_fire_on_clearance ON donor_screening;
-- DROP FUNCTION fn_lookback_fire_on_clearance;
-- DROP TRIGGER trg_lookback_touch ON lookback_registry;
-- DROP FUNCTION fn_lookback_touch;
-- DROP TABLE lookback_registry;
