-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 273: Allow 'community_leader' role to exist without an institution_id.
--
-- Same omission as migration 266 fixed for 'dho': adding a new role string to
-- platform_users.role_check (which 270 did for community_leader) isn't enough —
-- the staff_requires_institution CHECK from migration 004 also has to admit
-- the new role explicitly, otherwise every INSERT of role='community_leader'
-- raises 23514 check_violation.
--
-- Community leaders are NOT institution-scoped (their communities are
-- network-shaped, not branch-shaped — donors come from anywhere in India per
-- the Phase-1 design Q5), so they belong on the "no institution required"
-- side of the CHECK. They DO have a district_id on their PROFILE table
-- (community_leaders.district_id, optional, "centre of gravity") but it's
-- not on platform_users — so we don't restate the district-bound clause.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS staff_requires_institution;
ALTER TABLE platform_users
  ADD CONSTRAINT staff_requires_institution CHECK (
    (role IN ('donor','coordinator','ngo_admin','super_admin','community_leader'))
    OR (role IN ('hospital','blood_bank') AND institution_id IS NOT NULL)
    OR (role = 'dho' AND institution_id IS NULL AND district_id IS NOT NULL)
  );

-- ROLLBACK
-- ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS staff_requires_institution;
-- ALTER TABLE platform_users
--   ADD CONSTRAINT staff_requires_institution CHECK (
--     (role IN ('donor','coordinator','ngo_admin','super_admin'))
--     OR (role IN ('hospital','blood_bank') AND institution_id IS NOT NULL)
--     OR (role = 'dho' AND institution_id IS NULL AND district_id IS NOT NULL)
--   );
