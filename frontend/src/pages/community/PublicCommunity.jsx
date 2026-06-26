import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { apiRequest } from '../../lib/api.js';

/**
 * Public community profile (/community/:slug).
 *
 * Drives donor recruitment — anyone with the link sees:
 *   • Community name + region
 *   • Donor count + donations-facilitated stats (pride)
 *   • "Join as a donor" CTA → /register?community=<slug>
 *
 * Donor PII never appears here. Only the owner's display_name is shown
 * (the leader picked it as public-facing at sign-up).
 */
export function PublicCommunity() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiRequest('GET', `/community/${encodeURIComponent(slug)}`);
        if (!alive) return;
        setState({ kind: 'ready', community: data.community });
      } catch (err) {
        if (!alive) return;
        if (err?.response?.status === 404) setState({ kind: 'not_found' });
        else setState({ kind: 'error', message: err?.message || 'unknown' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  function joinAsDonor() {
    // Stash the community slug so DonorRegister picks it up from sessionStorage
    // (URL params are cleaner but the existing /register flow uses session for
    // its multi-step wizard handoff).
    window.sessionStorage.setItem('rk.pendingCommunitySlug', slug);
    navigate(`/register?community=${encodeURIComponent(slug)}`);
  }

  return (
    <div className="flex min-h-full flex-col bg-cream font-sans">
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 space-y-5">
        {state.kind === 'loading' ? <p className="text-stone-500">Loading…</p> : null}

        {state.kind === 'not_found' ? (
          <section className="rk-card text-center">
            <h1 className="text-xl font-semibold text-stone-900">Community not found</h1>
            <p className="mt-2 text-sm text-stone-600">
              This link is wrong or the community is no longer active. Contact the leader
              who shared the link.
            </p>
            <Link to="/" className="mt-4 inline-block text-sm text-rk-700 hover:underline">
              ← Back to Raktify
            </Link>
          </section>
        ) : null}

        {state.kind === 'error' ? (
          <section className="rk-card text-rk-700">
            Could not load community ({state.message})
          </section>
        ) : null}

        {state.kind === 'ready' ? <CommunityProfile c={state.community} onJoin={joinAsDonor} /> : null}
      </main>
      <Footer />
    </div>
  );
}

function CommunityProfile({ c, onJoin }) {
  return (
    <>
      <section className="rk-card">
        <p className="text-xs uppercase tracking-wide text-stone-500">
          A Raktify community
          {c.owner_display_name ? ` · led by ${c.owner_display_name}` : ''}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{c.name}</h1>
        <p className="mt-1 text-sm text-stone-500">
          {[c.taluka_name, c.district_name, c.state_name].filter(Boolean).join(' · ')}
        </p>
        {c.description ? (
          <p className="mt-3 text-stone-700">{c.description}</p>
        ) : null}
      </section>

      <section className="grid grid-cols-3 gap-3">
        <Stat label="Donors" value={c.donor_count} />
        <Stat label="Active donors" value={c.active_donor_count} />
        <Stat label="Donations facilitated" value={c.donations_facilitated} />
      </section>

      <section className="rk-card bg-rk-50">
        <h2 className="text-base font-semibold text-rk-900">Become a donor</h2>
        <p className="mt-1 text-sm text-stone-700">
          One pint of blood can save up to three lives. Join this community and Raktify
          will reach out only when a hospital nearby needs your blood type — never spam,
          never share your number.
        </p>
        <button type="button" className="rk-button-primary mt-4 w-full" onClick={onJoin}>
          Join as a donor
        </button>
        <p className="mt-3 text-xs text-stone-500">
          Already a Raktify donor? <Link to="/login" className="text-rk-700 hover:underline">Log in instead</Link>.
        </p>
      </section>

      <section className="rk-card bg-sand/40 text-sm text-stone-700">
        <p>
          <strong>What you get:</strong> Raktify routes critical hospital requests directly
          to donors who match. You decide whether to respond. Your community organisers see
          your name + blood group + last donation — never your phone number.
        </p>
      </section>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rk-card text-center">
      <div className="text-2xl font-semibold text-stone-900">{value ?? 0}</div>
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
    </div>
  );
}
