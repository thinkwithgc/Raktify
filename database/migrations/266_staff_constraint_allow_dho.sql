-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 266: Allow 'dho' role to exist without an institution_id.
--
-- Migration 265 added the 'dho' role + district_id binding, but missed
-- widening the staff_requires_institution CHECK on platform_users (added in
-- migration 004). That constraint requires every role outside
-- (donor, coordinator, ngo_admin, super_admin) to belong to an institution —
-- which would block DHO inserts (DHOs are district-scoped government users,
-- not institution-scoped).
--
-- Fix: rewrite the CHECK so the DHO branch is "role='dho' AND district_id
-- IS NOT NULL AND institution_id IS NULL". The district-binding side of this
-- is already enforced by `dho_must_have_district` (migration 265); we restate
-- it here for clarity.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS staff_requires_institution;
ALTER TABLE platform_users
  ADD CONSTRAINT staff_requires_institution CHECK (
    (role IN ('donor','coordinator','ngo_admin','super_admin'))
    OR (role IN ('hospital','blood_bank') AND institution_id IS NOT NULL)
    OR (role = 'dho' AND institution_id IS NULL AND district_id IS NOT NULL)
  );

-- ROLLBACK
-- ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS staff_requires_institution;
-- ALTER TABLE platform_users
--   ADD CONSTRAINT staff_requires_institution CHECK (
--     (role IN ('donor','coordinator','ngo_admin','super_admin'))
--     OR (role IN ('hospital','blood_bank') AND institution_id IS NOT NULL)
--   );
