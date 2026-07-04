// blood_groups seed (migration 002): id 1..8 → A+ A- B+ B- AB+ AB- O+ O-.
// Shared by the donor register + dashboard "self-reported blood group" pickers
// so the id↔code mapping lives in exactly one place.
export const SELF_BLOOD_GROUPS = [
  { id: 1, code: 'A+' },
  { id: 2, code: 'A-' },
  { id: 3, code: 'B+' },
  { id: 4, code: 'B-' },
  { id: 5, code: 'AB+' },
  { id: 6, code: 'AB-' },
  { id: 7, code: 'O+' },
  { id: 8, code: 'O-' },
];
