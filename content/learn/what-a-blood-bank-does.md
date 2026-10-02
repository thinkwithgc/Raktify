---
title: What a blood bank actually does
slug: what-a-blood-bank-does
category: institutions
summary: A licensed blood bank does far more than store blood — it screens donors, separates whole blood into components, tests every unit for transfusion-transmissible infections, and keeps each component at its own temperature until a hospital needs it.
metaDescription: What a licensed blood bank does: screening donors, separating components, testing every unit, and storing each at its own temperature.
author: Choudhari EduHealth India Foundation
status: published
published: 2026-10-02
lastReviewed: 2026-10-02
nextReview: 2027-04-02
---

Most people picture a blood bank as a fridge. It is closer to a small
manufacturing plant with a laboratory attached: blood arrives as a single unit
from one donor and leaves as two, three or four separate products, each tested,
each labelled, and each stored under its own conditions.

Understanding that pipeline explains a lot of things that otherwise look
arbitrary — why a hospital cannot have the unit you donated this morning, why
platelets are always scarce, and why "we have blood in stock" and "we have blood
you can use" are different statements.

## Collection, and the screening that comes first

Before anything is collected, the blood bank screens the donor. That is a
medical assessment: a short history, a check of pulse and blood pressure, and a
haemoglobin measurement. People are turned away at this stage every single day,
and being deferred is not a judgement about the person — it protects both the
donor and whoever would have received the unit.

The screening is also the point at which a donor's blood group gets established
by testing rather than by memory. This is why Raktify treats a blood group you
type in yourself as unverified and never uses it to match you to a patient: a
group remembered from an old report is wrong often enough to matter, and in
transfusion, wrong is not a small problem.

## Component separation

A unit of donated whole blood is spun in a centrifuge, which separates it by
density into red cells, plasma and a platelet layer. Those become distinct
products with wildly different properties:

| Component | Stored at | Keeps for |
|---|---|---|
| Packed red cells | refrigerated | about 35 days |
| Platelets | room temperature, continuously agitated | about 5 days |
| Fresh frozen plasma | deep frozen | about a year |
| Cryoprecipitate | deep frozen | about a year |

Those shelf lives are the single most important operational fact about a blood
bank, and the reason inventory management is genuinely hard. Red cells give you a
month of slack. Platelets give you five days — a unit collected on Monday is
unusable by the weekend, which is why platelet shortages appear suddenly and why
blood banks ask for donors by name when a patient needs them repeatedly.

Separation is also why one donation can help more than one patient. The red cells
may go to a surgical patient, the plasma to someone with a clotting disorder, and
the platelets to a cancer patient whose marrow has stopped producing their own.

## Testing every single unit

Every unit collected is tested for transfusion-transmissible infections before
it can be released. In India that panel is mandatory and includes HIV, hepatitis
B, hepatitis C, syphilis and malaria. The unit also has its blood group confirmed
and, where required, is crossmatched against the specific patient who will
receive it.

This testing is what creates the delay that surprises people most. The blood you
donate at a camp on Sunday morning is not available to a patient on Sunday
afternoon — it is in a laboratory. Expecting otherwise leads to a particular kind
of disappointment, where donors turn up for an emergency believing their unit
will be transfused that day, and it is one of the reasons Raktify does not
promise that.

If a test comes back reactive, the unit is discarded, and the donor is informed
and counselled. That is a serious, private conversation, and it is the blood
bank's to have, not a platform's.

## Storage, issue and the paper trail

A released unit sits in storage with its own identity: which donor it came from,
which tests it passed, when it expires, and where it is. When a hospital requests
blood, the blood bank issues specific bags against that specific request, and
from that moment the unit has a chain of custody — issued, received, transfused
or returned.

That chain is not bureaucracy for its own sake. If a patient has a transfusion
reaction, or if a donor is later found to have an infection that was not
detectable at donation, the blood bank has to be able to answer two questions
quickly: where did this unit go, and which other units came from that donor? The
second is called a lookback, and it only works if the records are complete and
unalterable.

Raktify's own design follows the same principle. Every change to a clinical
record is written to an append-only audit log that no user, administrator or
engineer can edit or delete — because a record you can quietly change is not a
record.

## What a blood bank is not

It is not a shop, and blood is not bought or sold. In India, paying donors is
illegal, and the hospital charge for a transfusion covers processing and testing
rather than the blood itself.

It is also not interchangeable with a hospital. A hospital treats patients and
requests blood; a blood bank is separately licensed to collect, test, store and
issue it. Some hospitals have a licensed blood bank inside them, which is why the
two get confused, but they are different functions with different legal
obligations — and on Raktify they are different kinds of institution with
different permissions.

## Where Raktify fits

Raktify does not collect, test or store blood, and it never makes a clinical
decision. It is the coordination layer around the blood bank: it finds eligible
donors near a request, carries messages between the people involved, keeps track
of which request is waiting on what, and gives camp organisers a way to bring
donors to a blood bank that has the capacity to collect from them.

Every clinical judgement — can this person donate, is this unit safe, does this
patient need red cells or platelets — belongs to the blood bank and its doctors.
The platform's job is to make sure the right people are in the room.
