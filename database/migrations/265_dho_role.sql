-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 265: District Health Officer (DHO) role.
--
-- A DHO is a government officer who oversees public-health programmes in a
-- district. For Raktify, the DHO is a *governance* user, not an operational
-- one: they get read-only access to district-scoped aggregates so they can
-- monitor adoption, file hemovigilance reports, and issue district-wide
-- circulars mandating platform adoption by hospitals + blood banks.
--
-- Key design decisions:
--   • Auth: email + password + TOTP (same as institutional staff). DHOs work
--     from a fixed desk + government laptop, email is their daily tool.
--   • Identity: One DHO per district. district_id on platform_users is the
--     binding. NULL for any role that isn't district-scoped.
--   • PII boundary: DHO never sees donor PII, patient PII, or field-level TTI.
--     Backend endpoints query under actor_role='system' (already permitted by
--     migration 240 for system-scoped routing reads) and explicitly aggregate
--     before returning to the DHO. No new direct-table RLS grants for DHO —
--     that would risk a PII leak if a future endpoint forgets to aggregate.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Widen platform_users.role to include 'dho'.
ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS platform_users_role_check;
ALTER TABLE platform_users
  ADD CONSTRAINT platform_users_role_check
  CHECK (role IN ('donor','coordinator','hospital','blood_bank','ngo_admin','super_admin','dho'));

-- 2. district_id — binds a DHO (or future district-scoped roles) to one
--    district. NULL for non-district roles. FK to districts(id) so we can't
--    point at a district that doesn't exist.
ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS district_id INTEGER REFERENCES districts(id);

-- 3. Update the auth_path_required CHECK so a 'dho' must have email + password
--    just like institutional users.
ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS auth_path_required;
ALTER TABLE platform_users
  ADD CONSTRAINT auth_path_required CHECK (
    (role IN ('donor','coordinator') AND mobile IS NOT NULL)
    OR
    (role IN ('hospital','blood_bank','ngo_admin','super_admin','dho')
       AND email IS NOT NULL AND password_hash IS NOT NULL)
  );

-- 4. Enforce: every DHO must have a district_id. We don't enforce uniqueness
--    yet (a district may have a senior DHO + a deputy who share access; we'll
--    revisit when the use case actually appears).
ALTER TABLE platform_users
  ADD CONSTRAINT dho_must_have_district CHECK (
    role <> 'dho' OR district_id IS NOT NULL
  );

-- 5. Helpful index for "look up the DHO for district X" — used by the
--    notification chokepoint when escalating critical-shortage alerts.
CREATE INDEX IF NOT EXISTS idx_platform_users_district
  ON platform_users(district_id) WHERE district_id IS NOT NULL;

-- 6. RLS helper. Some district-scoped reads in the DHO dashboard route may
--    optionally use this when we want belt-and-braces filtering at the DB
--    level rather than just in the application.
CREATE OR REPLACE FUNCTION fn_actor_district_id() RETURNS INTEGER LANGUAGE sql STABLE AS $$
  SELECT district_id FROM platform_users
   WHERE id = (SELECT nullif(current_setting('raktify.actor_user_id', TRUE), '')::uuid)
$$;

-- ROLLBACK
-- DROP FUNCTION IF EXISTS fn_actor_district_id;
-- DROP INDEX IF EXISTS idx_platform_users_district;
-- ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS dho_must_have_district;
-- ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS auth_path_required;
-- ALTER TABLE platform_users
--   ADD CONSTRAINT auth_path_required CHECK (
--     (role IN ('donor','coordinator') AND mobile IS NOT NULL)
--     OR
--     (role IN ('hospital','blood_bank','ngo_admin','super_admin')
--        AND email IS NOT NULL AND password_hash IS NOT NULL)
--   );
-- ALTER TABLE platform_users DROP COLUMN IF EXISTS district_id;
-- ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS platform_users_role_check;
-- ALTER TABLE platform_users
--   ADD CONSTRAINT platform_users_role_check
--   CHECK (role IN ('donor','coordinator','hospital','blood_bank','ngo_admin','super_admin'));
