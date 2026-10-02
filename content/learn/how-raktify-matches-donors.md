---
title: How Raktify matches donors to patients
slug: how-raktify-matches-donors
category: basics
summary: What happens between a hospital raising a blood request and a donor getting a WhatsApp message — which donors are contacted, which are deliberately not, and why stock is always checked before anyone is messaged.
metaDescription: What happens between a hospital raising a blood request and a donor getting a message, and which donors are deliberately not contacted.
author: Choudhari EduHealth India Foundation
status: published
published: 2026-10-02
lastReviewed: 2026-10-02
nextReview: 2027-04-02
---

When a hospital raises a blood request on Raktify, nobody's phone buzzes
immediately. A sequence of checks runs first, and most requests are resolved
before a single donor is contacted. This page describes that sequence, because
knowing it answers the two questions donors ask most: why have I never been
alerted, and why was I alerted for someone I have never met.

## Stock is checked before people are

The first question Raktify asks is not "who can donate" but "does a tested unit
already exist". A blood bank's shelf is the fastest and safest source: the unit is
already collected, already tested for transfusion-transmissible infections, and
available in minutes rather than the better part of a day.

So a request is matched against inventory first — the right component, a
compatible group, not expired, not already reserved for someone else. If a
suitable unit exists, the request is filled from it and no alert goes out.

This is the single biggest reason a registered donor can go months without
hearing from Raktify. It is the system working. A platform that messaged donors
for every request would be louder, feel busier, and help nobody more.

## Compatibility is a database rule, not a judgement call

Which groups can safely receive from which is held as a reference table in
Raktify's database, seeded from a compatibility matrix signed off by a
haematologist, and locked afterwards so application code cannot alter it. The
platform looks compatibility up; it never calculates it, and no part of the
application is allowed to improvise.

Two things about that table matter more than they appear to:

- **Direction is not symmetric.** For red cells, group O can give to everyone and
  AB can receive from everyone. For plasma that reverses — AB plasma is the
  universal one. A system that stored "compatible with" as a single
  undirected fact would be dangerously wrong half the time.
- **Whole blood is same-group only.** The permissive matrix people remember is for
  red cells that have been separated out. Whole blood is restricted to the
  patient's own group.

The deeper reason this lives in the database rather than in code is a rule the
whole platform is built on: patient-safety rules are enforced as database
constraints, because application code has bugs and constraints do not. A clinical
rule is never allowed to be a line in a route handler that someone can refactor.

## Only a verified blood group is ever used

When you register, you can tell Raktify your blood group. That value is shown on
your own profile marked **unverified**, and it is never used to match you to a
patient. Matching reads only a group that a licensed blood bank has established
by testing and recorded.

This looks like excessive caution until you consider what the failure costs. A
group remembered wrongly from an old report, written down by a relative, or
confused between two siblings is common. If that value drove matching, a patient's
relatives would be told a compatible donor was on the way when they were not, and
in an emergency that false reassurance is worse than no donor at all.

Your group is verified the first time you donate, after which you are matched
normally.

## Which donors get an alert

Among donors whose verified group is compatible, Raktify filters on three more
things:

**Distance.** You choose how far you are willing to travel when you register —
anything from one kilometre up to a hundred. A request outside that radius does
not reach you. It is your setting, and you can change it.

**Eligibility right now.** There is a minimum interval between donations, and a
donor who has given blood recently is not asked again. Deferrals recorded by a
blood bank are respected the same way. Being skipped for this reason is not a
rejection and needs no action from you.

**Availability.** The toggle on your donor dashboard pauses alerts without
touching your account. Donors use it while travelling, while unwell, or during
exam season.

If several donors remain after all that, Raktify does not message all of them at
once for a routine request. Contacting forty people for one unit wastes
thirty-nine people's goodwill, and goodwill is the scarcest resource a voluntary
system has. More urgent requests widen the circle faster.

## What the donor is asked, and what is never shared

An alert tells you the requesting hospital or blood bank, the area, the component
needed, and how urgent it is. It does not tell you the patient's name or their
condition — that is their private medical information, and a volunteer donor has
no need for it.

The protection runs in the other direction too, and more strictly. **A hospital
never receives a donor's mobile number from Raktify.** It is masked to the last
four digits, and every message between the patient's side and a donor is carried
by the platform. The blood bank that actually collects the donation does get your
contact details, because it has to call you to confirm an appointment and is the
organisation legally responsible for the collection.

That rule exists because of what happens without it. A family in a crisis, handed
a list of phone numbers, will call every one of them repeatedly — and donors who
have been through that once do not answer the next time. Mediating the contact is
what keeps a donor list from burning itself out in a month.

## When nobody responds

Requests that stay unfilled escalate rather than sit. The circle of contacted
donors widens, coordinators in the district are brought in, and community leaders
can take on a request in their own area and mobilise people they know personally
— which works, in places where an SMS from an unknown platform does not.

Escalation is also visible. The hospital that raised the request can see that it
is still open and what has been tried, instead of waiting in silence and
concluding nothing is happening. Most of the frustration in blood coordination is
not the absence of donors; it is the absence of information about whether anyone
is looking.

## What Raktify does not do

It does not decide whether you can donate — the blood bank's medical screening
does, on the day, and it can defer you after Raktify's pre-check passed.

It does not handle, test or store blood.

It does not pay donors or charge patients. Voluntary unpaid donation is the only
kind the platform supports, and there is no fee anywhere on it.
