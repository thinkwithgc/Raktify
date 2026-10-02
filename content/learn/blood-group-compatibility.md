---
title: Which blood group can receive from which
slug: blood-group-compatibility
category: groups
summary: Red cell compatibility across all eight ABO and Rh groups, why plasma compatibility runs in the opposite direction, and why whole blood follows neither rule.
author: Choudhari EduHealth India Foundation
status: draft
clinical: true
advisory: This page is written and awaiting medical review. It is not published, and it is not linked from the library index, because nothing clinical on this site publishes without a named reviewing clinician.
citations:
  - National Blood Transfusion Council (NBTC), Standards for Blood Banks and Blood Transfusion Services
  - Raktify platform compatibility matrix, reviewed by the foundation's medical advisor and locked as immutable reference data
---

Compatibility is the one piece of blood donation that almost everybody half
knows: O is the universal donor, AB is the universal recipient. Both of those are
true for red cells and both are wrong for plasma, which is the detail that makes
the rest of this page worth reading.

## There are eight groups, not two systems

Your group is two facts at once. The ABO system gives A, B, AB or O depending on
which antigens sit on your red cells. The Rh system adds positive or negative
depending on whether the D antigen is present. Together they make the eight groups
every blood bank works in: O+, O−, A+, A−, B+, B−, AB+, AB−.

Transfusion compatibility is not about matching those labels. It is about whether
the recipient's immune system will attack what it is given. Someone with group A
blood carries antibodies against B antigens, so giving them B red cells provokes an
immediate and dangerous reaction. Group O people carry antibodies against both A
and B, which is why group O recipients are the most restricted of all — the
mirror image of the universal-donor fact everyone remembers.

## Red cells

Red cells carry the antigens, so the rule is that the donor's antigens must be
ones the recipient's antibodies will tolerate.

| Recipient | Can receive red cells from |
|---|---|
| O− | O− |
| O+ | O−, O+ |
| A− | O−, A− |
| A+ | O−, O+, A−, A+ |
| B− | O−, B− |
| B+ | O−, O+, B−, B+ |
| AB− | O−, A−, B−, AB− |
| AB+ | all eight groups |

Read down the column rather than across and the two famous facts fall out. O−
appears in every row, which is what makes it the universal red cell donor and why
it is the group an emergency department reaches for before a patient's own group is
known. AB+ receives from every row, which makes it the universal red cell
recipient — and, less comfortably for AB+ people, means their own red cells can
only go to the small number of other AB recipients.

Rh negative is the stricter half of each pair. An Rh negative recipient must have
Rh negative red cells; an Rh positive recipient can take either. That asymmetry is
why negative groups are disproportionately in demand relative to how many negative
donors there are.

## Plasma runs the other way

Plasma carries the antibodies rather than the antigens, so the compatibility
direction reverses completely.

| Recipient | Can receive plasma from |
|---|---|
| O | O, A, B, AB |
| A | A, AB |
| B | B, AB |
| AB | AB |

AB plasma contains no anti-A and no anti-B antibodies, which makes **AB the
universal plasma donor** — the exact opposite of the red cell picture. Group O
plasma is the most restricted, because it carries antibodies against both A and B.

This is not a technicality that only matters inside a laboratory. A system that
recorded compatibility as a single symmetric "compatible with" fact would be
confidently wrong for every plasma transfusion it touched. Raktify holds the two
directions as separate reference tables for that reason.

## Whole blood follows neither rule

Whole blood — the unit exactly as collected, not separated into components —
contains both the donor's red cells and the donor's plasma. Both constraints
therefore apply at once, and the only group that satisfies both is the patient's
own.

**Whole blood is same-group only.** Group O whole blood is not a universal
product, because its plasma carries antibodies against A and B even though its red
cells carry neither antigen. The universal-donor rule people remember belongs to
separated red cells, and applying it to whole blood is a real and dangerous
mistake.

Most transfusion in India is of separated components rather than whole blood,
which is why the component rules are the ones usually quoted.

## Platelets are not covered here

Platelet compatibility follows its own rules and this page deliberately does not
state them. The platform's own platelet reference data is still marked as
provisional pending the medical advisor's confirmation, and a page in this library
does not get to be more confident than the signed source behind it.

If you are looking for platelets for a patient, the blood bank's transfusion
medicine team will decide what is suitable.

## Compatible on paper is not the last step

For red cells and whole blood, a compatible group is the beginning. The blood bank
still performs a **crossmatch**: a sample of the specific patient's blood is
tested against the specific unit intended for them, because individual antibodies
outside the ABO and Rh systems can make a correctly-grouped unit unsuitable for
one particular person.

This is why a hospital cannot simply be handed a unit of a compatible group, and
why "your group is in stock" is not the same as "a unit is ready for you".

## What this means for a donor

Every group is needed, and the group that is scarce depends entirely on what the
hospitals in one district are treating that week. The common refrain that only O−
matters is wrong: a hospital's A+ patients need A+ or O+ red cells, and there are
a great many more of them.

Two things are genuinely worth knowing about your own group. If you are Rh
negative, your red cells are usable by both negative and positive recipients in
your ABO group, and negative donors are relatively few — so a negative donor who
answers an alert is unusually useful. And if you are AB, your red cells have the
narrowest reach of anyone's while your plasma has the widest.

Your group also has to be verified by a laboratory before it is used to match you
to a patient. Raktify shows a group you type in yourself as unverified and never
matches on it, because a group remembered from an old report is wrong often enough
that trusting it would eventually send a family the wrong donor.
