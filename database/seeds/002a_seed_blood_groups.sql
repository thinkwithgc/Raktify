-- Blood groups — ABO × Rh. Population percentages from public Indian Red Cross data.
-- This file is intentionally NOT marked DRAFT: the eight ABO/Rh groups are not subject
-- to clinical interpretation. The population percentages are display-only (used for
-- "rare blood" estimation in admin reports); they are not used in matching decisions.
INSERT INTO blood_groups (id, code, abo_type, rh_factor, is_rare, population_pct_india) VALUES
  (1, 'A+',  'A',  '+', FALSE, 22.0),
  (2, 'A-',  'A',  '-', FALSE,  0.8),
  (3, 'B+',  'B',  '+', FALSE, 38.0),
  (4, 'B-',  'B',  '-', FALSE,  1.5),
  (5, 'AB+', 'AB', '+', FALSE,  9.0),
  (6, 'AB-', 'AB', '-', FALSE,  0.4),
  (7, 'O+',  'O',  '+', FALSE, 36.0),
  (8, 'O-',  'O',  '-', FALSE,  2.0)
ON CONFLICT (id) DO NOTHING;
