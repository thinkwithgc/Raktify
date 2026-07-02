import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { SECTIONS } from './communityLeaderHelpContent.jsx';

// Public /help/community-leader route — same content as the in-app drawer.
// Sent via the community-leader welcome WhatsApp so leaders can review
// before signing in. Also useful for prospective leaders reading before
// they accept an invite.

export function CommunityLeaderHelpPage() {
  const [active, setActive] = useState(SECTIONS[0].id);

  return (
    <div className="flex min-h-full flex-col bg-cream font-sans">
      <Header subtitle="Community leader guide" />
      <main className="mx-auto w-full max-w-4xl px-4 py-6">
        <div className="mb-6">
          <Link to="/" className="text-sm text-rk-700 hover:underline">
            ← Back to Raktify
          </Link>
        </div>

        <header className="mb-6">
          <h1 className="text-3xl font-bold text-stone-900">Community Leader Guide</h1>
          <p className="mt-2 text-sm text-stone-600">
            Everything you need to know about running a Raktify community — organised so you can
            skim or read in full. If something&apos;s unclear, WhatsApp us: see the last section.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          {/* Sidebar nav */}
          <nav className="md:sticky md:top-4 md:h-fit">
            <ul className="space-y-1 text-sm">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={() => setActive(s.id)}
                    className={
                      'block rounded px-3 py-2 transition-colors ' +
                      (active === s.id
                        ? 'bg-rk-50 font-semibold text-rk-700'
                        : 'text-stone-700 hover:bg-stone-100')
                    }
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Content */}
          <article className="space-y-8">
            {SECTIONS.map((s) => (
              <section key={s.id} id={s.id} className="rk-card scroll-mt-6">
                <h2 className="text-xl font-semibold text-stone-900">{s.title}</h2>
                <div className="prose prose-sm mt-3 max-w-none text-stone-700">
                  {s.body}
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default CommunityLeaderHelpPage;
