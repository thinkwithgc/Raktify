import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Wordmark } from '../../components/Wordmark.jsx';
import { apiRequest } from '../../lib/api.js';

const STATUS = {
  RG: { label: 'Registered', cls: 'bg-sky-100 text-sky-800' },
  AT: { label: 'Attended', cls: 'bg-green-100 text-green-800' },
  NS: { label: 'No-show', cls: 'bg-slate-200 text-slate-700' },
  CN: { label: 'Cancelled', cls: 'bg-rk-700/80 text-white' },
};

const CAMP_STATUS = {
  PE: { label: 'Pending review', cls: 'bg-amber-100 text-amber-800' },
  PL: { label: 'Planned', cls: 'bg-sky-100 text-sky-800' },
  LV: { label: 'Live', cls: 'bg-green-100 text-green-800' },
  CO: { label: 'Completed', cls: 'bg-slate-200 text-slate-700' },
  CA: { label: 'Cancelled', cls: 'bg-rk-700/80 text-white' },
  DC: { label: 'Declined', cls: 'bg-rk-700/80 text-white' },
};

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(v);
  }
}

function fmtTime(v) {
  if (!v) return '';
  return String(v).slice(0, 5);
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="rk-card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-bold text-slate-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

// Stand-alone token-based call (the global axios client adds the JWT
// interceptor; here we don't want that because the token IS the credential.
// Use plain fetch.)
// Match the same env var the global axios client uses (see lib/api.js).
// Dev: empty → Vite dev server proxies /camps to localhost:3000.
// Prod: VITE_API_URL points at the Azure backend.
const apiBase = import.meta.env.VITE_API_URL || '';

async function tokenFetch(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${apiBase}${path}`;
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(body.error || r.statusText);
    err.response = { data: body, status: r.status };
    throw err;
  }
  return body;
}

export function CampOrganizerDashboard() {
  const { token } = useParams();
  const qc = useQueryClient();
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastResult, setBroadcastResult] = useState(null);

  const dashQ = useQuery({
    queryKey: ['camp-organizer', token],
    queryFn: () => tokenFetch(`/camps/access/${token}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const markStatus = useMutation({
    mutationFn: ({ regId, status }) =>
      tokenFetch(`/camps/access/${token}/registrations/${regId}/status`, {
        method: 'POST',
        body: { status },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['camp-organizer', token] }),
  });

  const broadcast = useMutation({
    mutationFn: (message) =>
      tokenFetch(`/camps/access/${token}/broadcast`, {
        method: 'POST',
        body: { message },
      }),
    onSuccess: (r) => {
      setBroadcastResult(r);
      setBroadcastText('');
    },
  });

  const regs = dashQ.data?.registrations || [];

  const counts = useMemo(() => {
    const c = { RG: 0, AT: 0, NS: 0, CN: 0 };
    for (const r of regs) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [regs]);

  if (dashQ.isLoading) {
    return (
      <PageShell>
        <div className="rk-card text-center text-slate-500">Loading your dashboard…</div>
      </PageShell>
    );
  }

  if (dashQ.error) {
    const code = dashQ.error?.response?.data?.error;
    const message =
      code === 'token_expired'
        ? 'This link has expired. Please ask the Raktify NGO admin for a fresh link.'
        : code === 'token_revoked'
          ? 'This link has been revoked. Please contact the Raktify NGO admin.'
          : code === 'invalid_token'
            ? 'This link is not recognised. Double-check the URL.'
            : code || 'load_failed';
    return (
      <PageShell>
        <div className="rk-card text-center">
          <h1 className="text-lg font-semibold text-rk-700">Access not available</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
          <Link to="/" className="rk-button-secondary mt-4 inline-block">
            Go to Raktify home
          </Link>
        </div>
      </PageShell>
    );
  }

  const camp = dashQ.data?.camp || {};
  const cs = CAMP_STATUS[camp.status] || CAMP_STATUS.PL;

  return (
    <PageShell>
      <header className="rk-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Camp organizer dashboard
            </div>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{camp.name}</h1>
            <p className="text-sm text-slate-600">
              {fmtDate(camp.scheduled_date)} · {fmtTime(camp.start_time)}–{fmtTime(camp.end_time)} · {camp.venue}
            </p>
            <p className="text-xs text-slate-500">
              {camp.district_name}
              {camp.partnered_blood_bank_name ? ` · Partnered with ${camp.partnered_blood_bank_name}` : ''}
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cs.cls}`}>
            {cs.label}
          </span>
        </div>
        {dashQ.data?.granted_to_name ? (
          <p className="mt-2 text-xs text-slate-400">
            Access granted to {dashQ.data.granted_to_name}. Link expires{' '}
            {fmtDate(dashQ.data.expires_at)}. Don&apos;t share this link publicly.
          </p>
        ) : null}
      </header>

      {/* KPI cards */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Registered"
          value={counts.RG + counts.AT}
          sub={camp.target_donor_count ? `Target ${camp.target_donor_count}` : ''}
        />
        <KpiCard label="Attended" value={counts.AT} sub="day-of marks" />
        <KpiCard label="No-shows" value={counts.NS} />
        <KpiCard label="Units collected" value={camp.units_collected ?? 0} sub="from blood bank" />
      </section>

      {/* Broadcast */}
      <article className="rk-card space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Send an update to registered donors
        </h2>
        <p className="text-xs text-slate-500">
          The message goes via WhatsApp (or SMS as fallback) to everyone who&apos;s RSVP&apos;d for this
          camp. Use it for venue changes, ID reminders, or thank-yous after the camp.
        </p>
        <textarea
          className="rk-input min-h-[80px]"
          maxLength={500}
          placeholder="e.g. Venue updated to Hall 2 of Sant Gadge Baba University. Please carry a govt ID. Light breakfast will be served from 8am."
          value={broadcastText}
          onChange={(e) => setBroadcastText(e.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{broadcastText.length}/500</span>
          <button
            type="button"
            className="rk-button-primary text-sm"
            onClick={() => broadcast.mutate(broadcastText)}
            disabled={broadcast.isPending || broadcastText.trim().length < 5}
          >
            {broadcast.isPending ? '…' : `Send to ${counts.RG + counts.AT} donors`}
          </button>
        </div>
        {broadcastResult ? (
          <p className="text-sm text-green-700">
            Queued {broadcastResult.queued} message{broadcastResult.queued === 1 ? '' : 's'}.
          </p>
        ) : null}
        {broadcast.error ? (
          <p className="text-sm text-rk-700">
            {broadcast.error?.response?.data?.error || 'broadcast_failed'}
          </p>
        ) : null}
      </article>

      {/* Roster */}
      <article className="rk-card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Roster ({regs.length})
          </h2>
          <span className="text-xs text-slate-500">
            Tap a donor to mark attendance on camp day.
          </span>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Donor</th>
              <th className="px-3 py-2 text-left">Blood group</th>
              <th className="px-3 py-2 text-left">RSVP&apos;d</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Mark</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {regs.map((r) => {
              const s = STATUS[r.status] || STATUS.RG;
              const deferred = r.deferral_status && r.deferral_status !== 'OK';
              return (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{r.full_name}</div>
                    {deferred ? (
                      <div className="text-xs text-amber-700">
                        ⚠ currently deferred — may not donate today
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-rk-700">
                      {r.blood_group_code || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{fmtDate(r.registered_at)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                      {s.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.status !== 'CN' ? (
                      <div className="flex justify-end gap-1">
                        {r.status !== 'AT' ? (
                          <button
                            type="button"
                            className="rounded-md border border-green-300 px-2 py-0.5 text-xs font-medium text-green-800 hover:bg-green-50"
                            onClick={() => markStatus.mutate({ regId: r.id, status: 'AT' })}
                            disabled={markStatus.isPending}
                          >
                            Attended
                          </button>
                        ) : null}
                        {r.status !== 'NS' ? (
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            onClick={() => markStatus.mutate({ regId: r.id, status: 'NS' })}
                            disabled={markStatus.isPending}
                          >
                            No-show
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {regs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                  No RSVPs yet — registrations will appear here as donors sign up.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </article>

      <footer className="text-center text-xs text-slate-400">
        Powered by{' '}
        <Link to="/" className="font-semibold text-rk-700 hover:underline">
          Raktify
        </Link>
        {' · '}
        Need help? WhatsApp the NGO coordinator on the number they shared with you.
      </footer>
    </PageShell>
  );
}

function PageShell({ children }) {
  return (
    <div className="min-h-full bg-cream">
      <header className="border-b border-sand bg-cream/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" aria-label="Raktify home" className="flex items-center">
            <Wordmark className="text-xl" />
          </Link>
          <span className="text-xs text-slate-500">Camp organizer</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
