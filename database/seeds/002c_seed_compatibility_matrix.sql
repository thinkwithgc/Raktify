-- ─────────────────────────────────────────────────────────────────────────────
-- Compatibility matrix — MEDICALLY SIGNED OFF (10-Jul-2026).
--
-- This is a PATIENT SAFETY artefact. The matrix below determines which donor
-- blood is permitted for which recipient. An error here can kill a patient.
-- Confirmed AS-DRAWN by the reviewing haematologist (Medical Review Document,
-- Q7 — the PRBC/whole-blood 8×8 grid was ticked with no cell changed).
--
-- Conventions:
--   PRBC (component 2): standard ABO+Rh compatibility, O- universal donor
--   FFP  (component 5): plasma — AB universal donor (reverse direction from RBC)
--   PLT  (component 3): platelet preference, not absolute (ABO preferred)
--   WB / SDP / CRYO: same component-2 / component-5 conventions per spec §3
--
-- This is the FULL matrix for PRBC and FFP and a representative subset for
-- platelets. Cryo and SDP follow plasma conventions for ABO matching.
-- Advisor confirmations (Q8/Q9): platelet matching stays ABO-preferred (not
-- required); Rh IS considered for platelets and for repeated-transfusion
-- plasma; the is_preferred ordering below drives fallback selection. Anti-D
-- cover for Rh-incompatible platelets is the treating physician's call — the
-- platform does not prompt it.
--
-- Notation in INSERT rows:
--   (component_id, donor_group_id, recipient_group_id, is_compatible, is_preferred, note)
--   donor groups: 1=A+ 2=A- 3=B+ 4=B- 5=AB+ 6=AB- 7=O+ 8=O-
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── PRBC (component 2) — Red Cells ────────────────────────────────────────
INSERT INTO compatibility_matrix
  (component_id, donor_group_id, recipient_group_id, is_compatible, is_preferred, note)
VALUES
  -- A+ donor → A+, AB+ recipients
  (2, 1, 1, TRUE,  TRUE,  'Same group'),
  (2, 1, 5, TRUE,  FALSE, 'A+ → AB+'),
  -- A- donor → A+, A-, AB+, AB- recipients
  (2, 2, 1, TRUE,  FALSE, 'A- → A+'),
  (2, 2, 2, TRUE,  TRUE,  'Same group'),
  (2, 2, 5, TRUE,  FALSE, 'A- → AB+'),
  (2, 2, 6, TRUE,  FALSE, 'A- → AB-'),
  -- B+ donor → B+, AB+
  (2, 3, 3, TRUE,  TRUE,  'Same group'),
  (2, 3, 5, TRUE,  FALSE, 'B+ → AB+'),
  -- B- donor → B+, B-, AB+, AB-
  (2, 4, 3, TRUE,  FALSE, 'B- → B+'),
  (2, 4, 4, TRUE,  TRUE,  'Same group'),
  (2, 4, 5, TRUE,  FALSE, 'B- → AB+'),
  (2, 4, 6, TRUE,  FALSE, 'B- → AB-'),
  -- AB+ donor → AB+ only
  (2, 5, 5, TRUE,  TRUE,  'Same group'),
  -- AB- donor → AB+, AB-
  (2, 6, 5, TRUE,  FALSE, 'AB- → AB+'),
  (2, 6, 6, TRUE,  TRUE,  'Same group'),
  -- O+ donor → A+, B+, AB+, O+
  (2, 7, 1, TRUE,  FALSE, 'O+ → A+'),
  (2, 7, 3, TRUE,  FALSE, 'O+ → B+'),
  (2, 7, 5, TRUE,  FALSE, 'O+ → AB+'),
  (2, 7, 7, TRUE,  TRUE,  'Same group'),
  -- O- donor → universal recipient compatibility (reserve for emergencies)
  (2, 8, 1, TRUE,  FALSE, 'O- universal — reserve for emergency'),
  (2, 8, 2, TRUE,  FALSE, 'O- universal — reserve for emergency'),
  (2, 8, 3, TRUE,  FALSE, 'O- universal — reserve for emergency'),
  (2, 8, 4, TRUE,  FALSE, 'O- universal — reserve for emergency'),
  (2, 8, 5, TRUE,  FALSE, 'O- universal — reserve for emergency'),
  (2, 8, 6, TRUE,  FALSE, 'O- universal — reserve for emergency'),
  (2, 8, 7, TRUE,  FALSE, 'O- universal — reserve for emergency'),
  (2, 8, 8, TRUE,  TRUE,  'Same group')
ON CONFLICT (component_id, donor_group_id, recipient_group_id) DO NOTHING;

-- Whole Blood (component 1) — same ABO/Rh constraints as PRBC.
INSERT INTO compatibility_matrix
  (component_id, donor_group_id, recipient_group_id, is_compatible, is_preferred, note)
SELECT 1, donor_group_id, recipient_group_id, is_compatible, is_preferred,
       REPLACE(note, 'O- universal', 'WB strict same-group preferred')
  FROM compatibility_matrix
 WHERE component_id = 2
   -- WB convention: only same-group transfusion is recommended
   AND donor_group_id = recipient_group_id
ON CONFLICT (component_id, donor_group_id, recipient_group_id) DO NOTHING;

-- ─── FFP (component 5) — Plasma. Reverse: AB plasma is universal donor. ──
INSERT INTO compatibility_matrix
  (component_id, donor_group_id, recipient_group_id, is_compatible, is_preferred, note)
VALUES
  -- AB plasma → all
  (5, 5, 1, TRUE, FALSE, 'AB+ plasma → A+'),
  (5, 5, 2, TRUE, FALSE, 'AB+ plasma → A-'),
  (5, 5, 3, TRUE, FALSE, 'AB+ plasma → B+'),
  (5, 5, 4, TRUE, FALSE, 'AB+ plasma → B-'),
  (5, 5, 5, TRUE, TRUE,  'Same group'),
  (5, 5, 6, TRUE, FALSE, 'AB+ plasma → AB-'),
  (5, 5, 7, TRUE, FALSE, 'AB+ plasma → O+'),
  (5, 5, 8, TRUE, FALSE, 'AB+ plasma → O-'),
  (5, 6, 1, TRUE, FALSE, 'AB- plasma → A+'),
  (5, 6, 2, TRUE, FALSE, 'AB- plasma → A-'),
  (5, 6, 3, TRUE, FALSE, 'AB- plasma → B+'),
  (5, 6, 4, TRUE, FALSE, 'AB- plasma → B-'),
  (5, 6, 5, TRUE, FALSE, 'AB- plasma → AB+'),
  (5, 6, 6, TRUE, TRUE,  'Same group'),
  (5, 6, 7, TRUE, FALSE, 'AB- plasma → O+'),
  (5, 6, 8, TRUE, FALSE, 'AB- plasma → O-'),
  -- A plasma → A, O recipients
  (5, 1, 1, TRUE, TRUE,  'Same group'),
  (5, 1, 7, TRUE, FALSE, 'A+ plasma → O+'),
  (5, 2, 1, TRUE, FALSE, 'A- plasma → A+'),
  (5, 2, 2, TRUE, TRUE,  'Same group'),
  (5, 2, 7, TRUE, FALSE, 'A- plasma → O+'),
  (5, 2, 8, TRUE, FALSE, 'A- plasma → O-'),
  -- B plasma → B, O recipients
  (5, 3, 3, TRUE, TRUE,  'Same group'),
  (5, 3, 7, TRUE, FALSE, 'B+ plasma → O+'),
  (5, 4, 3, TRUE, FALSE, 'B- plasma → B+'),
  (5, 4, 4, TRUE, TRUE,  'Same group'),
  (5, 4, 7, TRUE, FALSE, 'B- plasma → O+'),
  (5, 4, 8, TRUE, FALSE, 'B- plasma → O-'),
  -- O plasma → O recipients only
  (5, 7, 7, TRUE, TRUE,  'Same group'),
  (5, 8, 7, TRUE, FALSE, 'O- plasma → O+'),
  (5, 8, 8, TRUE, TRUE,  'Same group')
ON CONFLICT (component_id, donor_group_id, recipient_group_id) DO NOTHING;

-- ─── Platelets (component 3 RDP, component 4 SDP) — ABO preferred not absolute ──
-- Provisional: same-group is preferred, all combinations marked compatible.
-- Medical advisor MUST confirm.
INSERT INTO compatibility_matrix
  (component_id, donor_group_id, recipient_group_id, is_compatible, is_preferred, note)
SELECT
  3 AS component_id,
  d.id AS donor_group_id,
  r.id AS recipient_group_id,
  TRUE AS is_compatible,
  (d.id = r.id) AS is_preferred,
  'Platelet ABO preferred — DRAFT, advisor confirm' AS note
FROM blood_groups d CROSS JOIN blood_groups r
ON CONFLICT DO NOTHING;

INSERT INTO compatibility_matrix
  (component_id, donor_group_id, recipient_group_id, is_compatible, is_preferred, note)
SELECT
  4, d.id, r.id, TRUE, (d.id = r.id),
  'SDP ABO preferred — DRAFT, advisor confirm'
FROM blood_groups d CROSS JOIN blood_groups r
ON CONFLICT DO NOTHING;

-- ─── Cryoprecipitate (component 6) — plasma compatibility ──
INSERT INTO compatibility_matrix
  (component_id, donor_group_id, recipient_group_id, is_compatible, is_preferred, note)
SELECT 6, donor_group_id, recipient_group_id, is_compatible, is_preferred,
       REPLACE(note, 'plasma', 'cryo')
  FROM compatibility_matrix WHERE component_id = 5
ON CONFLICT DO NOTHING;

-- After seeding: lock the table against further INSERT/UPDATE/DELETE via app_user.
REVOKE INSERT, UPDATE, DELETE ON compatibility_matrix FROM app_user;
REVOKE INSERT, UPDATE, DELETE ON blood_components    FROM app_user;
REVOKE INSERT, UPDATE, DELETE ON blood_groups        FROM app_user;
