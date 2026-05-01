-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 212: Fix array build in fn_lookback_fire_on_clearance.
--
-- Bug: PL/pgSQL was interpreting `v_tti := v_tti || 'HIV'` as appending a
-- text[] literal "HIV" rather than appending a single element. Postgres
-- complained: malformed array literal: "HIV".
--
-- Fix: use array_append() which is unambiguous.
-- ─────────────────────────────────────────────────────────────────────────────

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

  v_tti := ARRAY[]::TEXT[];
  IF NEW.hiv_status = 'RR'      THEN v_tti := array_append(v_tti, 'HIV'); END IF;
  IF NEW.hbsag_status = 'RR'    THEN v_tti := array_append(v_tti, 'HBsAg'); END IF;
  IF NEW.hcv_status = 'RR'      THEN v_tti := array_append(v_tti, 'HCV'); END IF;
  IF NEW.syphilis_status = 'RR' THEN v_tti := array_append(v_tti, 'Syphilis'); END IF;
  IF NEW.malaria_status = 'RR'  THEN v_tti := array_append(v_tti, 'Malaria'); END IF;

  UPDATE donors
     SET deferral_status = CASE
                              WHEN 'HIV' = ANY(v_tti) OR 'HBsAg' = ANY(v_tti) THEN 'P'
                              ELSE 'T' END,
         deferral_reason = 'TTI reactive — under lookback',
         updated_at = clock_timestamp()
   WHERE id = NEW.donor_id;

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

-- ROLLBACK
-- (Restore prior body from 035_lookback_registry.sql.)
