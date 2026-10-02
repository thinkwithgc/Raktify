---
title: Editorial policy
slug: editorial-policy
category: about
summary: How pages in this library are written, reviewed, dated and corrected — what we will and will not publish, why some finished pages are still unpublished, and how to tell us we are wrong.
metaDescription: How Raktify writes and reviews its Knowledge Center: sources, named clinical reviewers, review dates and corrections.
author: Choudhari EduHealth India Foundation
status: published
published: 2026-10-02
lastReviewed: 2026-10-02
nextReview: 2027-04-02
---

This library is published by Choudhari EduHealth India Foundation, the
not-for-profit that runs Raktify. It is not a blog and it is not marketing. It is
meant to be a reference that a patient's family, a first-time donor or a camp
organiser can rely on, which means the standards it holds itself to have to be
written down and visible.

This page is those standards. If we fail to meet them, this is the page to hold
us to.

## Nothing clinical publishes without a named reviewer

Any page that bears on a medical decision — who can donate, which blood group can
receive from which, how long after an illness someone should wait — is reviewed by
a named clinician before it is published. Not "reviewed by our medical team".
A name, their qualification, and their affiliation, printed on the page.

Where we do not yet have that, the page stays unpublished. Several pages in this
library are written and complete and are not live for exactly this reason, and the
category index lists them as awaiting medical review rather than hiding them. We
would rather show you that a page exists and has not been checked than publish it
and hope.

The practical consequence is that this library grows slowly. That is the correct
trade. An unreviewed clinical page that reads confidently is worse than no page,
because the reader cannot tell the difference.

## Every page says when it was last checked

Each page carries five dates and names, visibly:

- who wrote it
- who reviewed it medically, where the page is clinical
- when it was first published
- when it was last reviewed
- when it is next due for review

"Last reviewed" means a human read the page against its sources on that date and
confirmed it still holds. It does not move because we fixed a typo or because the
site was rebuilt — a freshness date that updates itself is a lie that looks like
diligence.

A page past its review date is not automatically wrong, but it is overdue, and we
would rather you could see that.

## Where clinical facts come from

Clinical values on this site come from the same signed sources the platform itself
uses, and from national guidance. They are not assembled from other websites.

Inside Raktify, clinical reference data — blood group compatibility, component
shelf lives, deferral intervals — lives in the database as constraints and seeded
reference tables, reviewed by the foundation's medical advisor before being
loaded, and locked afterwards so that application code cannot alter it. Public
pages quote those same values rather than restating them from memory, which is why
a number on this site and a number inside the platform cannot drift apart.

Where a figure is commonly quoted elsewhere but is not in our signed sources, we
leave it out rather than repeat it. There are numbers about blood donation that
appear on hundreds of Indian websites, trace back to nothing, and are repeated
because everyone repeats them. Absence on this site is sometimes deliberate.

## What we will not publish

**Advertising, in any form.** No sponsored pages, no paid placements, no paid
links, no affiliate arrangements. Nobody can buy a mention here.

**Anything that promises an outcome.** This library explains how blood donation
and transfusion work. It does not tell you what will happen to you or to a patient
you care about.

**Anything that replaces a clinician.** Every clinical page says, in terms, that
the decision belongs to the doctor in front of you. The pre-donation questionnaire
on the platform is a filter to save you a wasted trip, never a clearance, and the
library says so wherever it comes up.

**Appeals for money disguised as information.** The foundation does accept
donations, and the pages that ask are clearly the pages that ask. An article is
not one of them.

**Patient stories without informed consent**, and never with identifying detail
the person has not explicitly agreed to publish.

**Fear.** Blood shortage in India is a real and serious problem, and it does not
need to be exaggerated to be worth acting on. We do not use frightening imagery or
invented statistics to recruit donors, because a donor recruited by alarm does not
come back, and because it is not honest.

## Corrections

If a page is wrong, we correct the page and say that we did. A correction note
stays on the page; it is not quietly edited out once the mistake is fixed.

To report an error, write to **contact@choudhari.ngo** with the page and what is
wrong with it. You do not need to be a clinician, and you do not need to be
diplomatic. A reader who tells us a page is confusing has found a real defect even
when every fact on it is correct.

Clinical corrections go back through a named reviewer before the page changes. We
will not quietly alter a clinical statement on the strength of an email, including
a convincing one.

## Independence

The reviewer's judgement on a clinical page is final. If the foundation and a
reviewer disagree about what a page should say, the page does not publish. We will
not overrule a clinician to make a page more persuasive, more reassuring, or
better at recruiting donors.

No hospital, blood bank or institution on the Raktify platform has any editorial
influence over this library, and being onboarded on the platform earns no mention
here.

## Language

We publish in English and Marathi, and we intend to publish in Hindi. Where a
translation does not exist, the page falls back to English rather than showing a
half-translated page.

Clinical terms — the names of the infections in the mandatory test panel, the
names of components, the word "reactive" — stay in English even in a translated
page, deliberately. A mistranslated clinical term is a safety problem rather than a
style problem, and those words are the ones a blood bank will use when it speaks
to you.

## How this library is built

Every page here is a plain text file in the platform's own source repository,
rendered to static HTML at build time. There is no content management system and
no database behind it, which has two consequences worth knowing: every change to
every page is recorded in version control with who made it and when, and the pages
work offline, saved, forwarded or printed.

The structured data each page carries — its author, reviewer, dates and sources —
is generated from the same front matter that produces the visible provenance
block. The markup cannot claim a reviewer the page does not show you, because
there is only one source for both.

## Contact

**contact@choudhari.ngo**

Choudhari EduHealth India Foundation, Amravati, Maharashtra, India.
CIN U88900MH2025NPL447942 · NGO-Darpan MH/2025/0643345.

If you would like to write or review for this library, the
[contributor page](/learn/contribute) explains what we are looking for.
