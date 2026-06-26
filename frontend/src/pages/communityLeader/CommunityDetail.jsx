import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { apiRequest } from '../../lib/api.js';

/**
 * Community detail — placeholder shell for Phase 2.
 *
 * What it shows today:
 *   • Community name + region + counts
 *   • Co-leaders list (owner badge, add/remove if you're the owner)
 *
 * Phase 3 will add:
 *   • Donor roster (limited PII)
 *   • Referral link/QR widget
 *   • Camp hosting integration
 *   • Stats over time
 */
export function CommunityDetail() {
  const { id } = useParams();
  const qc = useQueryClient();

  const detailQ = useQuery({
    queryKey: ['cl-community', id],
    queryFn: () => apiRequest('GET', `/community-leader/communities/${id}`),
    staleTime: 30_000,
  });

  const removeMod = useMutation({
    mutationFn: (moderatorId) =>
      apiRequest('DELETE', `/community-leader/communities/${id}/co-leaders/${moderatorId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cl-community', id] }),
  });

  if (detailQ.isLoading) {
    return (
      <Shell>
        <p className="text-stone-500">Loading…</p>
      </Shell>
    );
  }
  if (detailQ.error) {
    return (
      <Shell>
        <div className="rk-card text-rk-700">
          {detailQ.error?.response?.data?.error || 'load_failed'}
        </div>
      </Shell>
    );
  }

  const { community, moderators } = detailQ.data;

  return (
    <Shell>
      <Link to="/community-leader" className="text-sm text-rk-700 hover:underline">
        ← Back to dashboard
      </Link>

      <section className="rk-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">{community.name}</h1>
            <p className="mt-1 text-sm text-stone-500">
              {[community.taluka_name, community.district_name, community.state_name]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {community.description ? (
              <p className="mt-2 text-sm text-stone-700">{community.description}</p>
            ) : null}
            <p className="mt-2 text-xs text-stone-500">
              Public URL:{' '}
              <code className="rounded bg-sand px-1.5 py-0.5">/community/{community.slug}</code>
            </p>
          </div>
          {community.is_owner ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              You are the owner
            </span>
          ) : (
            <span className="rounded-full bg-sand px-2 py-0.5 text-xs font-medium text-stone-700">
              Co-leader
            </span>
          )}
        </div>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <Stat label="Donors" value={community.donor_count} />
        <Stat label="Active donors" value={community.active_donor_count} />
        <Stat label="Donations facilitated" value={community.donations_facilitated} />
      </section>

      <section className="rk-card">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Co-leaders ({moderators.length})
          </h2>
          {community.is_owner ? <AddCoLeaderInline communityId={id} /> : null}
        </div>
        <ul className="mt-3 divide-y divide-slate-100">
          {moderators.map((m) => (
            <li key={m.moderator_row_id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium text-stone-900">{m.display_name}</div>
                <div className="text-xs text-stone-500">
                  {m.district_name || '—'} · added{' '}
                  {m.added_at ? new Date(m.added_at).toLocaleDateString() : '—'}
                </div>
              </div>
              {community.is_owner && moderators.length > 1 ? (
                <button
                  type="button"
                  className="text-xs text-rk-700 hover:underline"
                  onClick={() => {
                    if (window.confirm(`Remove ${m.display_name} as co-leader?`)) {
                      removeMod.mutate(m.moderator_row_id);
                    }
                  }}
                  disabled={removeMod.isPending}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {moderators.length === 1 ? (
          <p className="mt-3 text-xs text-amber-700">
            ⚠ Only one co-leader on this community. Add another before that person becomes
            unavailable — every community needs at least one co-leader for the handover path.
          </p>
        ) : null}
      </section>

      <section className="rk-card bg-sand/40">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Coming next
        </h2>
        <ul className="mt-2 space-y-1.5 text-sm text-stone-700">
          <li>• <strong>Phase 3:</strong> Your donor roster (name + blood group + last-donation date).</li>
          <li>• <strong>Phase 3:</strong> Referral link + QR code to share in your WhatsApp group.</li>
          <li>• <strong>Phase 3:</strong> Host a blood-donation camp from this community.</li>
        </ul>
      </section>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="flex min-h-full flex-col bg-cream font-sans">
      <Header subtitle="Community" />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 space-y-5">{children}</main>
      <Footer variant="compact" />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rk-card">
      <div className="text-2xl font-semibold text-stone-900">{value ?? 0}</div>
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
    </div>
  );
}

function AddCoLeaderInline({ communityId }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);

  const lookupQ = useQuery({
    queryKey: ['cl-lookup', q],
    queryFn: () => apiRequest('GET', `/community-leader/leaders/lookup?q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length >= 2,
    staleTime: 10_000,
  });

  const add = useMutation({
    mutationFn: (leaderId) =>
      apiRequest('POST', `/community-leader/communities/${communityId}/co-leaders`, {
        co_leader_id: leaderId,
      }),
    onSuccess: () => {
      setOpen(false);
      setQ('');
      qc.invalidateQueries({ queryKey: ['cl-community', communityId] });
    },
    onError: (err) => setError(err?.response?.data?.error || 'add_failed'),
  });

  if (!open) {
    return (
      <button type="button" className="rk-button-primary text-xs" onClick={() => setOpen(true)}>
        + Add co-leader
      </button>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-1">
      <input
        type="text"
        className="rk-input w-full text-sm"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        placeholder="Type a name or last 4 mobile digits…"
      />
      {q.trim().length >= 2 ? (
        <div className="rounded border border-slate-300 bg-white shadow-sm">
          {lookupQ.isLoading ? (
            <p className="p-2 text-xs text-stone-500">Searching…</p>
          ) : (lookupQ.data?.leaders || []).length === 0 ? (
            <p className="p-2 text-xs text-stone-500">No matches</p>
          ) : (
            <ul className="max-h-40 overflow-auto">
              {lookupQ.data.leaders.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className="block w-full px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                    // onMouseDown + preventDefault — same dropdown-blur fix
                    // as the create-form CoLeaderPicker. Without this the
                    // input's blur fires before the button click on mobile,
                    // and the selection is lost.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add.mutate(l.id);
                    }}
                    disabled={add.isPending}
                  >
                    <span className="font-medium">{l.display_name}</span>
                    {l.district_name ? <span className="text-stone-500"> · {l.district_name}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {error ? <p className="text-xs text-rk-700">{error}</p> : null}
      <button
        type="button"
        className="text-xs text-stone-500 hover:underline"
        onClick={() => {
          setOpen(false);
          setQ('');
          setError(null);
        }}
      >
        Cancel
      </button>
    </div>
  );
}
