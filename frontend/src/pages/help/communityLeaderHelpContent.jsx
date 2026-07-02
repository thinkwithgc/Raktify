// Shared content for the community-leader help drawer (in-app) and the
// public /help/community-leader page. English only for v1; MR/HI
// translations follow the medical-advisor + Marathi language pass.

export const CONTACT_EMAIL = 'contact@choudhari.ngo';
export const CONTACT_WHATSAPP = 'https://wa.me/918586999969';

export const SECTIONS = [
  {
    id: 'what',
    title: 'What is Raktify?',
    body: (
      <>
        <p>
          Raktify is a mission-critical operating system for India&apos;s blood-donor
          ecosystem. Its job is to make sure every patient who needs blood can reach a
          verified, compatible donor <em>in minutes, not hours</em>.
        </p>
        <p>
          The platform is built and run by <strong>Choudhari EduHealth India
          Foundation</strong>, a Section 8 non-profit registered in Amravati, Maharashtra.
        </p>
      </>
    ),
  },
  {
    id: 'role',
    title: 'Your role as a Community Leader',
    body: (
      <>
        <p>You are the human trust bridge between Raktify and your community.</p>
        <ul>
          <li>
            <strong>Grow the local donor network</strong> — share your referral link with
            community members via WhatsApp / posters / word of mouth.
          </li>
          <li>
            <strong>Host and lead camps</strong> — organise blood-donation drives at
            temples, schools, community halls; Raktify tracks attendance + attribution.
          </li>
          <li>
            <strong>Be the friendly first responder</strong> — when a critical request
            comes up in your community, the platform can ping your donor list <em>first</em>{' '}
            (24-hour community-first window before broadcasting district-wide).
          </li>
          <li>
            <strong>Represent the community, not enforce it</strong> — nobody is compelled
            to donate. Your role is to make it easy, dignified, and celebrated.
          </li>
        </ul>
        <p>
          What you are <em>not</em>:
        </p>
        <ul>
          <li>You are not medical staff. Never make clinical calls (eligibility, deferrals).</li>
          <li>You do not collect blood — that&apos;s the blood bank&apos;s job.</li>
          <li>You do not handle patient identity. Raktify masks patient PII.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'community',
    title: 'Creating your community',
    body: (
      <>
        <p>
          Every community leader starts with at least one community. Think of a community
          as any group with a shared identity: a village, a neighbourhood, a temple
          congregation, a school alumni network, an office group.
        </p>
        <ol>
          <li>From your dashboard, tap <strong>Create community</strong>.</li>
          <li>
            Give it a clear name (e.g. &quot;Rukhmini Nagar Blood Warriors&quot;), the state
            + district + taluka + village if applicable, and a short description.
          </li>
          <li>
            Assign at least one <strong>co-leader</strong> — a trusted community member
            who can step in if you&apos;re unavailable. This is required.
          </li>
          <li>
            Once saved, your community has its own public page at{' '}
            <code>raktify.choudhari.ngo/community/&lt;slug&gt;</code> — share this link
            when inviting people.
          </li>
        </ol>
        <p>You can edit the community name / geography anytime.</p>
      </>
    ),
  },
  {
    id: 'invite',
    title: 'Inviting donors',
    body: (
      <>
        <p>Your community page has three sharing tools:</p>
        <ul>
          <li>
            <strong>Referral link</strong> — a unique URL that tags every donor who signs
            up as attributed to you. Send this via WhatsApp, print it on a poster QR, or
            paste in your community group.
          </li>
          <li>
            <strong>QR code</strong> — the same link as a printable image. Print &amp; put
            up at community boards, temple noticeboards, camp venues.
          </li>
          <li>
            <strong>WhatsApp message template</strong> — pre-written text in Marathi /
            Hindi / English you can paste into your group chat.
          </li>
        </ul>
        <p>
          Once someone signs up via your link, they show in your donor roster with their
          blood group + last-donation date + eligibility status. Their mobile is{' '}
          <em>not</em> shown to you — Raktify holds it. This is deliberate: no leader
          should be able to leak or misuse donor contacts.
        </p>
      </>
    ),
  },
  {
    id: 'camp',
    title: 'Hosting a blood-donation camp',
    body: (
      <>
        <p>
          You host camps <em>tied to your community</em>. When registrations come in,
          Raktify attributes them to your community so your impact stats update.
        </p>
        <ol>
          <li>
            From your community detail page, tap <strong>Host a camp</strong>.
          </li>
          <li>
            Fill in the camp date, venue, expected donor count, contact person, and the
            blood bank(s) who&apos;ll collect on the day.
          </li>
          <li>
            You&apos;ll get a shareable camp page at{' '}
            <code>raktify.choudhari.ngo/c/&lt;camp-slug&gt;</code> — donors can register
            via that page.
          </li>
          <li>
            On camp day, use your organiser dashboard (from the camp&apos;s magic link) to
            mark attendance and post updates.
          </li>
        </ol>
        <p>
          <strong>Before the camp:</strong> pre-approvals with the blood bank (BB team,
          cold-chain vehicle, sample transport) need to be arranged offline. Raktify will
          gain a &quot;request BB approval&quot; workflow in a future phase; for now you
          confirm those with the BB yourself.
        </p>
      </>
    ),
  },
  {
    id: 'dashboard',
    title: 'Understanding your dashboard',
    body: (
      <>
        <p>Four counters at the top of your dashboard:</p>
        <ul>
          <li>
            <strong>Communities</strong> — how many groups you lead. Most leaders have 1 or
            2; some regional leads have 5+.
          </li>
          <li>
            <strong>Donors in network</strong> — cumulative count of donors attributed to
            your communities. Grows as more people sign up via your referral link.
          </li>
          <li>
            <strong>Donations facilitated</strong> — verified donations from your donor
            network. Counts only after the blood bank records a donation.
          </li>
          <li>
            <strong>Camps hosted</strong> — camps you organised that reached at least one
            donor.
          </li>
        </ul>
        <p>
          These numbers are how the Foundation recognises grassroots impact. They also
          feed the &quot;Vidarbha proof-of-model&quot; that we&apos;re presenting to CSR
          funders — your work directly enables the pilot.
        </p>
      </>
    ),
  },
  {
    id: 'faq',
    title: 'FAQ',
    body: (
      <>
        <dl>
          <dt>
            <strong>Can I see donors&apos; mobile numbers?</strong>
          </dt>
          <dd>
            No. Raktify holds them. You reach donors via your existing WhatsApp group. This
            is a hard rule — it protects donors and reduces platform liability.
          </dd>
          <dt>
            <strong>What happens if I stop being active?</strong>
          </dt>
          <dd>
            Your co-leader takes over. Your donor attributions remain (they&apos;re how
            we track long-term community impact); only new signups stop coming to you.
          </dd>
          <dt>
            <strong>Am I paid for this?</strong>
          </dt>
          <dd>
            Community leaders are volunteers today. As the Amravati programme grows,
            paid coordinator positions (₹6,000–15,000/month range) are being planned —
            active community leaders are the first candidates.
          </dd>
          <dt>
            <strong>Can I promise a donor that their blood goes to a specific patient?</strong>
          </dt>
          <dd>
            No. Once donated, the blood bank decides where it goes based on need. What we
            <em>can</em> promise is a compatible match with a real, verified request.
          </dd>
        </dl>
      </>
    ),
  },
  {
    id: 'help',
    title: 'Get help',
    body: (
      <>
        <p>Something broken? Confused about a step? Talk to us directly.</p>
        <ul>
          <li>
            WhatsApp: <a href={CONTACT_WHATSAPP}>+91 85869 99969</a>
          </li>
          <li>
            Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </li>
        </ul>
        <p className="text-xs italic text-slate-500">
          We aim to reply within 24 hours on weekdays. If it&apos;s a live blood emergency,
          call the receiving hospital&apos;s blood bank directly — Raktify is a coordination
          layer, not a clinical service.
        </p>
      </>
    ),
  },
];
