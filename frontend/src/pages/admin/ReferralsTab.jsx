import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';

const FUNNEL_LABELS = {
  NE: 'New',
  CO: 'Contacted',
  IN: 'Interested',
  ON: 'Onboarded',
  DC: 'Declined',
  DR: 'Dropped',
};

const FUNNEL_ORDER = ['NE', 'CO', 'IN', 'ON', 'DC', 'DR'];

export function ReferralsTab() {
  const q = useQuery({
    queryKey: ['admin', 'referrals'],
    queryFn: () => apiRequest('GET', '/admin/referrals'),
    staleTime: 30_000,
  });

  if (q.isLoading) return <div className="rk-card text-center text-slate-500">…</div>;
  if (q.error)
    return (
      <div className="rk-card text-rk-700">
        {q.error?.response?.data?.error || 'load_failed'}
      </div>
    );

  const data = q.data;
  const byStatus = Object.fromEntries((data.funnel || []).map((r) => [r.funnel_status, r.count]));

  return (
    <section className="space-y-3">
      {/* Funnel overview */}
      <div className="rk-card">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Funnel</h2>
          <span className="text-sm text-slate-700">
            Conversion: <strong>{(data.conversion_rate * 100).toFixed(1)}%</strong> · {data.onboarded}/
            {data.total} onboarded
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {FUNNEL_ORDER.map((code) => (
            <div key={code} className="rounded-md bg-slate-50 p-2 text-center">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                {FUNNEL_LABELS[code]}
              </div>
              <div className="text-2xl font-semibold text-slate-900">
                {byStatus[code] || 0}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent rows */}
      <div className="rk-card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Target</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Referrers</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Last update</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data.recent || []).map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">{r.target_name}</div>
                  {r.target_contact_name ? (
                    <div className="text-xs text-slate-500">{r.target_contact_name}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2">{r.target_kind === 'HO' ? 'Hospital' : 'Blood bank'}</td>
                <td className="px-3 py-2">{r.referrer_count}</td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {FUNNEL_LABELS[r.funnel_status] || r.funnel_status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {r.status_changed_at ? new Date(r.status_changed_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
