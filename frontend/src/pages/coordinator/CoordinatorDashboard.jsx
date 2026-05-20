import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { apiRequest } from '../../lib/api.js';

const GRID_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const URG = {
  CR: { label: 'Critical', cls: 'bg-rk-700 text-white' },
  UR: { label: 'Urgent', cls: 'bg-amber-500 text-white' },
  PL: { label: 'Planned', cls: 'bg-slate-300 text-slate-800' },
};

function elapsed(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function KpiCard({ label, value, tone, hint }) {
  return (
    <div className="rk-card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={'mt-1 text-3xl font-bold ' + (tone || 'text-slate-900')}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

export function CoordinatorDashboard({ onOpenQueue }) {
  const q = useQuery({
    queryKey: ['coordinator', 'dashboard'],
    queryFn: () => apiRequest('GET', '/coordinator/dashboard'),
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  if (q.isLoading) {
    return <div className="rk-card text-center text-slate-500">…</div>;
  }
  if (q.error) {
    return (
      <div className="rk-card text-rk-700">
        {q.error?.response?.data?.error || 'load_failed'}
      </div>
    );
  }

  const d = q.data || {};
  const k = d.kpis || {};
  const availability = d.district_availability || [];
  const components = [...new Set(availability.map((r) => r.component))].sort();
  const cellFor = (g, comp) =>
    availability.find((r) => r.blood_group === g && r.component === comp);

  return (
    <section className="space-y-4">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Coordinator dashboard</h1>
          <p className="text-xs text-slate-500">
            District scope · refreshes every 20 s.
            {d.is_district_lead ? ' · District lead' : ''}
            {d.on_duty ? ' · On duty' : ''}
          </p>
        </div>
        {onOpenQueue ? (
          <button type="button" className="rk-button-primary text-sm" onClick={onOpenQueue}>
            Open full queue
          </button>
        ) : null}
      </div>

      {/* Live-queue KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard
          label="Open queue"
          value={k.open_count ?? 0}
          tone={k.open_count ? 'text-rk-700' : 'text-slate-900'}
        />
        <KpiCard
          label="Critical now"
          value={k.critical_now ?? 0}
          tone={k.critical_now ? 'text-rk-700' : 'text-slate-900'}
        />
        <KpiCard
          label="Awaiting accept"
          value={k.awaiting_accept ?? 0}
          tone={k.awaiting_accept ? 'text-amber-600' : 'text-slate-900'}
        />
        <KpiCard
          label="Accepted by you"
          value={k.accepted_by_me ?? 0}
          tone="text-green-700"
        />
        <KpiCard label="Closed this month" value={k.closed_this_month ?? 0} />
      </div>

      {/* Personal impact metrics */}
      {k.donations_facilitated !== null ? (
        <article className="rk-card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Your impact
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div>
              <div className="text-xs text-slate-500">Donations facilitated</div>
              <div className="text-2xl font-semibold text-slate-900">
                {k.donations_facilitated ?? 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Requests fulfilled</div>
              <div className="text-2xl font-semibold text-slate-900">
                {k.requests_fulfilled ?? 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Community donors</div>
              <div className="text-2xl font-semibold text-slate-900">
                {k.community_donor_count ?? 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Lives saved (est.)</div>
              <div className="text-2xl font-semibold text-rk-700">
                {k.lives_saved_estimate ?? 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Reliability score</div>
              <div
                className={
                  'text-2xl font-semibold ' +
                  ((k.reliability_score ?? 100) >= 80
                    ? 'text-green-700'
                    : (k.reliability_score ?? 100) >= 50
                      ? 'text-amber-600'
                      : 'text-rk-700')
                }
              >
                {k.reliability_score ?? 100}
              </div>
              {k.median_response_time_min ? (
                <div className="mt-0.5 text-xs text-slate-400">
                  median {k.median_response_time_min} min response
                </div>
              ) : null}
            </div>
          </div>
        </article>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* District donor pool */}
        <article className="rk-card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            District donor pool
          </h2>
          {d.scope_district_id ? (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Verified donors</span>
                <span className="font-semibold text-slate-900">
                  {d.district_donors?.verified ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Available today (no deferral)</span>
                <span className="font-semibold text-green-700">
                  {d.district_donors?.available ?? 0}
                </span>
              </div>
              <p className="pt-2 text-xs text-slate-400">
                Activatable from this pool when a request can't be matched from bank
                inventory.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No district scope for this role.</p>
          )}
        </article>

        {/* Top-5 open in district */}
        <article className="rk-card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Most urgent open requests
          </h2>
          {(d.top_open_requests || []).length === 0 ? (
            <p className="text-sm text-slate-500">No open requests in your district.</p>
          ) : (
            <ul className="space-y-2">
              {d.top_open_requests.map((r) => {
                const u = URG[r.urgency_tier] || URG.PL;
                return (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${u.cls}`}>
                      {u.label}
                    </span>
                    <Link
                      to={`/coordinator/requests/${r.id}`}
                      className="min-w-0 flex-1 hover:opacity-90"
                    >
                      <span className="font-mono text-[11px] text-slate-500">
                        {r.request_number}
                      </span>{' '}
                      <span className="font-medium text-slate-900">
                        {r.blood_group} · {r.component} · {r.units_fulfilled}/{r.units_required}u
                      </span>
                    </Link>
                    <span className="text-xs text-slate-500">
                      {elapsed(r.seconds_since_raised)} ago
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </div>

      {/* District blood availability */}
      <article className="rk-card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Blood available in your district
        </h2>
        {components.length === 0 ? (
          <p className="text-sm text-slate-500">
            No available units reported in district right now.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">Group</th>
                  {components.map((comp) => (
                    <th key={comp} className="px-3 py-2 text-center">
                      {comp}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {GRID_GROUPS.map((g) => (
                  <tr key={g}>
                    <td className="px-3 py-2 font-semibold text-rk-700">{g}</td>
                    {components.map((comp) => {
                      const cell = cellFor(g, comp);
                      const avail = cell?.available_units ?? 0;
                      return (
                        <td key={comp} className="px-3 py-2 text-center">
                          <span
                            className={
                              avail > 0 ? 'font-semibold text-slate-900' : 'text-slate-300'
                            }
                          >
                            {avail}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
