import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';

const GRID_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const URG = {
  CR: { label: 'Critical', cls: 'bg-rk-700 text-white' },
  UR: { label: 'Urgent', cls: 'bg-amber-500 text-white' },
  PL: { label: 'Planned', cls: 'bg-slate-300 text-slate-800' },
};

const STATUS_LABEL = {
  CL: 'Closed',
  FU: 'Fulfilled',
  EX: 'Expired',
  CA: 'Cancelled',
};

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return String(v);
  }
}

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} h` : `${h} h ${rem} m`;
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

export function HospitalDashboard({ onRaise }) {
  const q = useQuery({
    queryKey: ['hospital', 'dashboard'],
    queryFn: () => apiRequest('GET', '/requests/dashboard'),
    staleTime: 15_000,
    refetchInterval: 30_000,
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
      {/* Header strip with Raise CTA */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Hospital dashboard</h1>
          <p className="text-xs text-slate-500">
            Last 90 days of activity · district availability refreshes every 30 s.
          </p>
        </div>
        {onRaise ? (
          <button type="button" className="rk-button-primary text-sm" onClick={onRaise}>
            + Raise request
          </button>
        ) : null}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard
          label="Open requests"
          value={k.open_count ?? 0}
          tone={k.open_count ? 'text-rk-700' : 'text-slate-900'}
        />
        <KpiCard
          label="Critical now"
          value={k.critical_now ?? 0}
          tone={k.critical_now ? 'text-rk-700' : 'text-slate-900'}
        />
        <KpiCard
          label="Fulfilled this month"
          value={k.fulfilled_this_month ?? 0}
          tone={k.fulfilled_this_month ? 'text-green-700' : 'text-slate-900'}
        />
        <KpiCard
          label="Expired this month"
          value={k.expired_this_month ?? 0}
          tone={k.expired_this_month ? 'text-amber-600' : 'text-slate-900'}
        />
        <KpiCard
          label="Avg time to fulfil"
          value={fmtDuration(k.avg_fulfilment_seconds)}
          hint="raised → fulfilled"
        />
      </div>

      {/* District availability grid */}
      <article className="rk-card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Blood availability in your district
        </h2>
        {components.length === 0 ? (
          <p className="text-sm text-slate-500">
            No available units reported in your district right now. Raise the request — the
            matching engine will widen the search to adjacent districts.
          </p>
        ) : (
          <>
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
                                avail > 0
                                  ? 'font-semibold text-slate-900'
                                  : 'text-slate-300'
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
            <p className="mt-2 text-xs text-slate-400">
              Counts are district-wide totals across all blood banks. Bag-level details are
              not shown to hospitals — the platform mediates issue.
            </p>
          </>
        )}
      </article>

      {/* Recent activity */}
      <article className="rk-card">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent activity
        </h2>
        {(d.recent_activity || []).length === 0 ? (
          <p className="text-sm text-slate-500">No closed requests in the last 90 days.</p>
        ) : (
          <ul className="space-y-2">
            {d.recent_activity.map((r) => {
              const u = URG[r.urgency_tier] || URG.PL;
              return (
                <li key={r.id} className="flex items-center gap-2 text-sm">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${u.cls}`}>
                    {u.label}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {r.request_number}
                  </span>
                  <span className="font-medium text-slate-900">
                    {r.blood_group} · {r.component} · {r.units_fulfilled}/{r.units_required}u
                  </span>
                  <span className="ml-auto text-xs text-slate-500">
                    {STATUS_LABEL[r.status] || r.status} ·{' '}
                    {fmtDate(r.closed_at || r.raised_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}
