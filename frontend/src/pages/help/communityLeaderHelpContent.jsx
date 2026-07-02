// Community-leader help — visual + scannable. Every section is a set of
// icon-cards + at most one short paragraph. Uses SVG for the referral flow
// diagram so it prints crisp on any screen size.

export const CONTACT_EMAIL = 'contact@choudhari.ngo';
export const CONTACT_WHATSAPP = 'https://wa.me/918586999969';

// Small helper components so sections stay declarative + consistent.
function Cards({ items }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"
        >
          <span className="text-2xl leading-none" aria-hidden="true">
            {it.icon}
          </span>
          <div>
            <div className="text-sm font-semibold text-slate-900">{it.title}</div>
            <div className="text-xs text-slate-600">{it.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DoDontRow({ dos, donts }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-green-200 bg-green-50 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-700">
          You do this
        </div>
        <ul className="space-y-1 text-sm text-green-900">
          {dos.map((d, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true">✓</span>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border border-rk-200 bg-rk-50 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-rk-700">
          You never do this
        </div>
        <ul className="space-y-1 text-sm text-rk-900">
          {donts.map((d, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true">✕</span>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ReferralFlowSVG() {
  return (
    <svg
      viewBox="0 0 320 100"
      xmlns="http://www.w3.org/2000/svg"
      className="mx-auto my-2 h-24 w-full max-w-md"
      aria-label="Referral flow"
      role="img"
    >
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#b8231a" />
        </marker>
      </defs>
      {['You', 'Community', 'Donors'].map((label, i) => {
        const x = 30 + i * 130;
        return (
          <g key={label}>
            <circle cx={x} cy="50" r="26" fill="#faf7f2" stroke="#b8231a" strokeWidth="2" />
            <text x={x} y="55" textAnchor="middle" fontSize="13" fill="#1a1a1a" fontFamily="Inter, system-ui">
              {label}
            </text>
          </g>
        );
      })}
      <line x1="60" y1="50" x2="130" y2="50" stroke="#b8231a" strokeWidth="2" markerEnd="url(#arrow)" />
      <line x1="190" y1="50" x2="260" y2="50" stroke="#b8231a" strokeWidth="2" markerEnd="url(#arrow)" />
      <text x="95" y="42" textAnchor="middle" fontSize="9" fill="#6b7280">share link</text>
      <text x="225" y="42" textAnchor="middle" fontSize="9" fill="#6b7280">sign up</text>
    </svg>
  );
}

function CampFlowSVG() {
  return (
    <svg
      viewBox="0 0 320 80"
      xmlns="http://www.w3.org/2000/svg"
      className="mx-auto my-2 h-20 w-full max-w-md"
      aria-label="Camp flow"
      role="img"
    >
      <defs>
        <marker id="arrow2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#b8231a" />
        </marker>
      </defs>
      {[
        { emoji: '📝', label: 'Register' },
        { emoji: '🩸', label: 'Camp day' },
        { emoji: '📊', label: 'Track' },
      ].map((s, i) => {
        const x = 40 + i * 120;
        return (
          <g key={s.label}>
            <rect x={x - 32} y="20" width="64" height="40" rx="10" fill="#faf7f2" stroke="#b8231a" strokeWidth="1.5" />
            <text x={x} y="38" textAnchor="middle" fontSize="16">{s.emoji}</text>
            <text x={x} y="54" textAnchor="middle" fontSize="10" fill="#1a1a1a">{s.label}</text>
          </g>
        );
      })}
      <line x1="72" y1="40" x2="128" y2="40" stroke="#b8231a" strokeWidth="1.5" markerEnd="url(#arrow2)" />
      <line x1="192" y1="40" x2="248" y2="40" stroke="#b8231a" strokeWidth="1.5" markerEnd="url(#arrow2)" />
    </svg>
  );
}

export const SECTIONS = [
  {
    id: 'what',
    title: 'What is Raktify',
    body: (
      <>
        <p className="text-sm">
          A platform to connect blood donors with patients in need —{' '}
          <strong>in minutes, not hours.</strong> Run by Choudhari EduHealth India Foundation
          (Section 8 NPO, Amravati).
        </p>
        <Cards
          items={[
            { icon: '🩸', title: 'For donors', body: 'One tap to say yes when a patient needs their group.' },
            { icon: '🏥', title: 'For hospitals', body: 'Verified donors + blood-bank inventory in one place.' },
            { icon: '🏘️', title: 'For you', body: 'Grow your community. Save real lives. Build local trust.' },
          ]}
        />
      </>
    ),
  },
  {
    id: 'role',
    title: 'Your role',
    body: (
      <>
        <p className="text-sm">
          You&apos;re the <strong>trust bridge</strong> between Raktify and your community.
        </p>
        <DoDontRow
          dos={[
            'Share the referral link in your WhatsApp group',
            'Host blood-donation camps at your community',
            'Be the friendly voice when someone hesitates',
          ]}
          donts={[
            'Decide if someone is medically eligible',
            'Collect blood — that\'s the blood bank\'s job',
            'See patient names or donor mobiles',
          ]}
        />
      </>
    ),
  },
  {
    id: 'community',
    title: 'Creating your community',
    body: (
      <>
        <p className="text-sm">A community is any group with shared identity — a village, colony, alumni network, temple congregation.</p>
        <Cards
          items={[
            { icon: '1️⃣', title: 'Tap Create community', body: 'Give it a clear, local name.' },
            { icon: '2️⃣', title: 'Pick geography', body: 'State → district → taluka → village.' },
            { icon: '3️⃣', title: 'Add a co-leader', body: 'Someone who steps in if you\'re unavailable. Required.' },
            { icon: '4️⃣', title: 'Share your public page', body: 'raktify.choudhari.ngo/community/<slug>' },
          ]}
        />
      </>
    ),
  },
  {
    id: 'invite',
    title: 'Inviting donors',
    body: (
      <>
        <ReferralFlowSVG />
        <Cards
          items={[
            { icon: '🔗', title: 'Referral link', body: 'Unique URL that tags every new donor to you.' },
            { icon: '📱', title: 'QR poster', body: 'Print it at temples, colleges, community halls.' },
            { icon: '💬', title: 'WhatsApp template', body: 'Ready-to-paste text in MR / HI / EN.' },
            { icon: '🔒', title: 'Donor mobiles hidden', body: 'You see names + blood groups. Never contact numbers — that\'s our hard rule.' },
          ]}
        />
      </>
    ),
  },
  {
    id: 'camp',
    title: 'Hosting a camp',
    body: (
      <>
        <p className="text-sm">Camps are tied to your community — every registration counts toward your impact.</p>
        <CampFlowSVG />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>Before you create the camp:</strong> confirm with the blood bank offline that they can spare a team + cold-chain vehicle on that date. Raktify will automate this in a future phase.
        </div>
      </>
    ),
  },
  {
    id: 'dashboard',
    title: 'Your dashboard',
    body: (
      <>
        <p className="text-sm">Four numbers at the top show your grassroots impact:</p>
        <Cards
          items={[
            { icon: '🏘️', title: 'Communities', body: 'Groups you lead.' },
            { icon: '👥', title: 'Donors in network', body: 'People who signed up via your link.' },
            { icon: '🩸', title: 'Donations facilitated', body: 'Verified units from your network.' },
            { icon: '🎪', title: 'Camps hosted', body: 'Drives you organised.' },
          ]}
        />
      </>
    ),
  },
  {
    id: 'faq',
    title: 'Quick FAQ',
    body: (
      <div className="space-y-2 text-sm">
        {[
          {
            q: 'Can I see donor mobiles?',
            a: 'No. Raktify holds them. Reach donors via your WhatsApp group.',
          },
          {
            q: 'What if I stop being active?',
            a: 'Your co-leader takes over. Your attributions stay.',
          },
          {
            q: 'Am I paid?',
            a: 'Volunteers today. Paid coordinator positions coming with the CSR-funded Amravati programme — active leaders first in line.',
          },
          {
            q: 'Can I promise a donor their blood goes to a specific patient?',
            a: 'No. The blood bank routes by need. But you can promise a real, verified match.',
          },
        ].map((f, i) => (
          <details key={i} className="rounded border border-slate-200 bg-white p-2">
            <summary className="cursor-pointer font-semibold text-slate-800">{f.q}</summary>
            <div className="mt-1 text-slate-600">{f.a}</div>
          </details>
        ))}
      </div>
    ),
  },
  {
    id: 'help',
    title: 'Get help',
    body: (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <a
            href={CONTACT_WHATSAPP}
            className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 hover:border-green-500"
          >
            <span className="text-2xl">💬</span>
            <div>
              <div className="text-sm font-semibold text-green-900">WhatsApp us</div>
              <div className="text-xs text-green-700">+91 85869 99969</div>
            </div>
          </a>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 hover:border-blue-500"
          >
            <span className="text-2xl">✉️</span>
            <div>
              <div className="text-sm font-semibold text-blue-900">Email us</div>
              <div className="text-xs text-blue-700">{CONTACT_EMAIL}</div>
            </div>
          </a>
        </div>
        <p className="text-xs italic text-slate-500">
          Live blood emergency? Call the receiving hospital&apos;s blood bank directly. Raktify is
          coordination, not a clinical service.
        </p>
      </div>
    ),
  },
];
