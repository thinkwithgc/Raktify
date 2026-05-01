-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ DRAFT — PENDING MEDICAL ADVISOR SIGN-OFF ⚠
--
-- This seed populates the blood_components reference table. Every numeric
-- value below — shelf life, storage temperatures, minimum donor Hb, donation
-- gap days — is a clinical decision that determines whether a unit of blood
-- can be safely transfused. These values MUST be confirmed in writing by a
-- qualified haematologist before this seed is loaded into any environment
-- beyond local development.
--
-- Source for these provisional values: National Blood Transfusion Council
-- (NBTC) / Drugs and Cosmetics Rules — values from spec §3 Master Prompt
-- table 002b, themselves marked "verify with medical advisor before seeding".
--
-- After medical sign-off:
--   1. Rename this file to remove the _DRAFT_PENDING_REVIEW suffix
--   2. Update CLAUDE.md status table
--   3. Re-run the migration runner — it will refuse to re-apply if the
--      checksum has changed for an already-applied seed; instead create a
--      new dated promotion seed (e.g. 002b_promote_components_2026MMDD.sql).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO blood_components
  (id, code,   name_en,                    name_hi,             name_mr,
   shelf_life_days, storage_temp_min_c, storage_temp_max_c,
   requires_agitation, requires_crossmatch, can_self_donate,
   min_donor_hb_male, min_donor_hb_female, min_gap_days,
   volume_ml_typical, isbt_product_code)
VALUES
  (1, 'WB',    'Whole Blood',              'पूर्ण रक्त',         'संपूर्ण रक्त',
   35,   2.0,   6.0,  FALSE, TRUE,  TRUE, 13.0, 12.5,  90, 450, 'E0700'),
  (2, 'PRBC',  'Packed Red Blood Cells',   'पैक्ड RBC',          'पॅक्ड RBC',
   35,   2.0,   6.0,  FALSE, TRUE,  TRUE, 13.0, 12.5,  90, 280, 'E1800'),
  (3, 'PLT',   'Random Donor Platelets',   'प्लेटलेट्स RDP',     'प्लेटलेट्स RDP',
    5,  20.0,  24.0,  TRUE,  FALSE, TRUE, 13.0, 11.5,  14, 250, 'T0010'),
  (4, 'SDP',   'Single Donor Platelets',   'प्लेटलेट्स SDP',     'प्लेटलेट्स SDP',
    5,  20.0,  24.0,  TRUE,  FALSE, FALSE, 13.0, 11.5, 28, 200, 'T0020'),
  (5, 'FFP',   'Fresh Frozen Plasma',      'ताजा प्लाज्मा',      'फ्रेश प्लाझ्मा',
  365, -25.0, -18.0,  FALSE, FALSE, TRUE, 13.0, 12.5,  90, 220, 'B0000'),
  (6, 'CRYO',  'Cryoprecipitate',          'क्रायोप्रेसिपिटेट',  'क्रायोप्रेसिपिटेट',
  365, -25.0, -18.0,  FALSE, FALSE, TRUE, 13.0, 12.5,  90,  15, 'B1000')
ON CONFLICT (id) DO NOTHING;
