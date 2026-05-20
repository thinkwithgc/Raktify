-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 260: camp_registrations — donor RSVP table for donation camps.
--
-- The existing donors.registration_camp_id column captures "the camp the
-- donor first signed up through" (QR attribution) — it is single-valued and
-- write-once. For RSVPing to future camps, we need an N-to-N join.
--
-- The `registered_donor_count` denormalised on donation_camps is kept in
-- sync by trg_camp_reg_count_*.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE camp_registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id         UUID NOT NULL REFERENCES donation_camps(id) ON DELETE CASCADE,
  donor_id        UUID NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  status          CHAR(2) NOT NULL DEFAULT 'RG'
                  CHECK (status IN ('RG', 'AT', 'NS', 'CN')),
  -- RG Registered, AT Attended (donation recorded), NS No-show, CN Cancelled by donor
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          CHAR(2) NOT NULL DEFAULT 'WB'
                  CHECK (source IN ('WB', 'WA', 'CO', 'QR')),
  -- WB Web, WA WhatsApp bot, CO Coordinator-added, QR QR scan

  CONSTRAINT camp_reg_unique UNIQUE (camp_id, donor_id)
);

CREATE INDEX idx_camp_reg_camp  ON camp_registrations(camp_id);
CREATE INDEX idx_camp_reg_donor ON camp_registrations(donor_id);

-- Keep donation_camps.registered_donor_count denormalised.
CREATE OR REPLACE FUNCTION fn_camp_reg_count_ins() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE donation_camps
     SET registered_donor_count = registered_donor_count + 1
   WHERE id = NEW.camp_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_camp_reg_count_del() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE donation_camps
     SET registered_donor_count = GREATEST(0, registered_donor_count - 1)
   WHERE id = OLD.camp_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_camp_reg_count_ins
  AFTER INSERT ON camp_registrations
  FOR EACH ROW EXECUTE FUNCTION fn_camp_reg_count_ins();
CREATE TRIGGER trg_camp_reg_count_del
  AFTER DELETE ON camp_registrations
  FOR EACH ROW EXECUTE FUNCTION fn_camp_reg_count_del();

-- RLS: donor sees their own rows; coordinator/admin/blood_bank see camp roster.
ALTER TABLE camp_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY camp_reg_donor_self ON camp_registrations FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'blood_bank')
    OR (fn_actor_role() = 'donor' AND donor_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id()))
  );

CREATE POLICY camp_reg_donor_insert ON camp_registrations FOR INSERT TO app_user
  WITH CHECK (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'blood_bank')
    OR (fn_actor_role() = 'donor' AND donor_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id()))
  );

CREATE POLICY camp_reg_donor_update ON camp_registrations FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'blood_bank')
    OR (fn_actor_role() = 'donor' AND donor_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id()))
  );

CREATE POLICY camp_reg_donor_delete ON camp_registrations FOR DELETE TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() = 'coordinator'
    OR (fn_actor_role() = 'donor' AND donor_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id()))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON camp_registrations TO app_user;

-- ROLLBACK
-- DROP TRIGGER trg_camp_reg_count_del ON camp_registrations;
-- DROP TRIGGER trg_camp_reg_count_ins ON camp_registrations;
-- DROP FUNCTION fn_camp_reg_count_del;
-- DROP FUNCTION fn_camp_reg_count_ins;
-- DROP TABLE camp_registrations;
