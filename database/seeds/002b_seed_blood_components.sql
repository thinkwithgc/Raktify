-- ─────────────────────────────────────────────────────────────────────────────
-- Blood components reference data — MEDICALLY SIGNED OFF (10-Jul-2026).
--
-- Values confirmed by the reviewing haematologist (Medical Review Document,
-- §4). Minimum donor Hb = 12.5 g/dL for both genders. Whole-blood donation
-- interval is gender-based: 90 d (male) / 120 d (female); plateletpheresis
-- (SDP) may be repeated after 48 h. On an already-seeded database the live
-- values are promoted by migration 297 — this file is the source of truth
-- for fresh installs.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO blood_components
  (id, code,   name_en,                    name_hi,             name_mr,
   shelf_life_days, storage_temp_min_c, storage_temp_max_c,
   requires_agitation, requires_crossmatch, can_self_donate,
   min_donor_hb_male, min_donor_hb_female, min_gap_days, min_gap_days_female,
   volume_ml_typical, isbt_product_code)
VALUES
  (1, 'WB',    'Whole Blood',              'पूर्ण रक्त',         'संपूर्ण रक्त',
   35,   2.0,   6.0,  FALSE, TRUE,  TRUE, 12.5, 12.5,  90, 120, 450, 'E0700'),
  (2, 'PRBC',  'Packed Red Blood Cells',   'पैक्ड RBC',          'पॅक्ड RBC',
   35,   2.0,   6.0,  FALSE, TRUE,  TRUE, 12.5, 12.5,  90, 120, 280, 'E1800'),
  (3, 'PLT',   'Random Donor Platelets',   'प्लेटलेट्स RDP',     'प्लेटलेट्स RDP',
    5,  20.0,  24.0,  TRUE,  FALSE, TRUE, 12.5, 12.5,  14,  14, 250, 'T0010'),
  (4, 'SDP',   'Single Donor Platelets',   'प्लेटलेट्स SDP',     'प्लेटलेट्स SDP',
    5,  20.0,  24.0,  TRUE,  FALSE, FALSE, 12.5, 12.5,  2,   2, 200, 'T0020'),
  (5, 'FFP',   'Fresh Frozen Plasma',      'ताजा प्लाज्मा',      'फ्रेश प्लाझ्मा',
  365, -25.0, -18.0,  FALSE, FALSE, TRUE, 12.5, 12.5,  90, 120, 220, 'B0000'),
  (6, 'CRYO',  'Cryoprecipitate',          'क्रायोप्रेसिपिटेट',  'क्रायोप्रेसिपिटेट',
  365, -25.0, -18.0,  FALSE, FALSE, TRUE, 12.5, 12.5,  90, 120,  15, 'B1000')
ON CONFLICT (id) DO NOTHING;
