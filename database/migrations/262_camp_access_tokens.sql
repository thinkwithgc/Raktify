-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 262: camp_access_tokens — magic-link access for camp organizers.
--
-- When a camp is verified (PE → PL), the system mints a per-camp token and
-- WhatsApps it to the organizer. The organizer follows the link to a
-- scoped dashboard that shows ONLY their camp — no Raktify login, no
-- password, no signup.
--
-- The token IS the credential. RLS policies on camp_registrations + a
-- companion read endpoint enforce that even a leaked DB connection can't
-- use a token to see anyone else's camps.
--
-- Lifecycle:
--   • Token created at verify time, valid for 30 days past camp end_date.
--   • Each access updates last_used_at + last_used_ip (rough audit).
--   • Admin can revoke (set revoked_at) at any time without deleting,
--     preserving the audit trail.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE camp_access_tokens (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id            UUID NOT NULL REFERENCES donation_camps(id) ON DELETE CASCADE,
  token              TEXT NOT NULL UNIQUE,                   -- base64url, 24+ chars
  granted_to_mobile  CHAR(13),                               -- organizer mobile at issue time
  granted_to_name    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID REFERENCES platform_users(id),     -- NGO admin who minted
  expires_at         TIMESTAMPTZ NOT NULL,                   -- typically camp end_date + 30 days
  last_used_at       TIMESTAMPTZ,
  last_used_ip       INET,
  use_count          INTEGER NOT NULL DEFAULT 0,
  revoked_at         TIMESTAMPTZ,
  revoked_reason     TEXT
);

CREATE INDEX idx_camp_tokens_camp     ON camp_access_tokens(camp_id);
CREATE INDEX idx_camp_tokens_lookup   ON camp_access_tokens(token) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON camp_access_tokens TO app_user;

-- Token-scoped read policy on camp_registrations
-- When the request comes in via /camps/access/:token the route sets the GUC
-- raktify.camp_token; the policy joins to camp_access_tokens to confirm the
-- token is non-revoked, non-expired, and matches the registration's camp.
CREATE POLICY camp_reg_token_read ON camp_registrations FOR SELECT TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'blood_bank')
    OR (
      fn_actor_role() = 'donor'
      AND donor_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id())
    )
    OR EXISTS (
      SELECT 1 FROM camp_access_tokens t
       WHERE t.camp_id = camp_registrations.camp_id
         AND t.token = current_setting('raktify.camp_token', TRUE)
         AND t.revoked_at IS NULL
         AND t.expires_at > NOW()
    )
  );

-- Token-scoped UPDATE on camp_registrations — to allow the organizer to mark
-- attendance (status 'AT' / 'NS') on camp day.
CREATE POLICY camp_reg_token_update ON camp_registrations FOR UPDATE TO app_user
  USING (
    fn_is_admin()
    OR fn_actor_role() IN ('coordinator', 'blood_bank')
    OR (
      fn_actor_role() = 'donor'
      AND donor_id = (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id())
    )
    OR EXISTS (
      SELECT 1 FROM camp_access_tokens t
       WHERE t.camp_id = camp_registrations.camp_id
         AND t.token = current_setting('raktify.camp_token', TRUE)
         AND t.revoked_at IS NULL
         AND t.expires_at > NOW()
    )
  );

-- Allow token-bearer to read their own camp row (just the camp, no others).
-- donation_camps already has a permissive read policy (TRUE) so no extra
-- policy is required here.

-- The previous camp_reg_donor_self / camp_reg_donor_update policies remain
-- in place; this just adds OR-branches via NEW policies, which is the
-- correct way to compose RLS (multiple policies OR together).

-- Tighten: drop the older overlap if present so we end up with one canonical
-- read and one canonical update path.
DROP POLICY IF EXISTS camp_reg_donor_self   ON camp_registrations;
DROP POLICY IF EXISTS camp_reg_donor_update ON camp_registrations;

-- ROLLBACK
-- DROP POLICY IF EXISTS camp_reg_token_update ON camp_registrations;
-- DROP POLICY IF EXISTS camp_reg_token_read   ON camp_registrations;
-- CREATE POLICY camp_reg_donor_self ON camp_registrations FOR SELECT TO app_user
--   USING (
--     fn_is_admin()
--     OR fn_actor_role() IN ('coordinator', 'blood_bank')
--     OR (fn_actor_role() = 'donor' AND donor_id =
--         (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id())));
-- CREATE POLICY camp_reg_donor_update ON camp_registrations FOR UPDATE TO app_user
--   USING (
--     fn_is_admin()
--     OR fn_actor_role() IN ('coordinator', 'blood_bank')
--     OR (fn_actor_role() = 'donor' AND donor_id =
--         (SELECT id FROM donors WHERE platform_user_id = fn_actor_user_id())));
-- DROP INDEX IF EXISTS idx_camp_tokens_lookup;
-- DROP INDEX IF EXISTS idx_camp_tokens_camp;
-- DROP TABLE camp_access_tokens;
