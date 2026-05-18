import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';

const STATUS_LABEL = {
  OP: 'Open',
  IP: 'In progress',
  CN: 'Hospital contacted',
  RV: 'Reviewing',
  CL: 'Closed',
};

function ageCls(seconds) {
  const days = seconds / 86400;
  if (days > 14) return 'bg-rk-700 text-white'; // spec: red highlight
  if (days > 7) return 'bg-amber-500 text-white';
  return 'bg-slate-100 text-slate-700';
}

export function LookbackTab() {
  const q = useQuery({
    queryKey: ['admin', 'lookback'],
    queryFn: () => apiRequest('GET', '/lookback'),
    staleTime: 30_000,
  });

  if (q.isLoading) return <div className="rk-card text-center text-slate-500">…</div>;
  if (q.error)
    return (
      <div className="rk-card text-rk-700">
        {q.error?.response?.data?.error || 'load_failed'}
      </div>
    );

  const rows = q.data?.rows || [];

  return (
    <section className="space-y-3">
      <p className="text-sm text-slate-600">
        Open lookback investigations. Spec §10: cases open &gt; 14 days are highlighted in red.
        DHO notification is mandatory for HIV / HBsAg before close.
      </p>
      <div className="rk-card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Trigger</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Bags recalled</th>
              <th className="px-3 py-2 text-right">Already issued</th>
              <th className="px-3 py-2 text-right">Already transfused</th>
              <th className="px-3 py-2 text-left">DHO notified</th>
              <th className="px-3 py-2 text-right">Age</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const days = Math.floor((r.seconds_open || 0) / 86400);
              return (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium">{r.tti_trigger}</td>
                  <td className="px-3 py-2">{STATUS_LABEL[r.lookback_status] || r.lookback_status}</td>
                  <td className="px-3 py-2 text-right">{r.bags_recalled_count}</td>
                  <td className="px-3 py-2 text-right">{r.bags_already_issued}</td>
                  <td className="px-3 py-2 text-right">{r.bags_already_transfused}</td>
                  <td className="px-3 py-2">
                    {r.dho_notified ? '✓' : <span className="text-rk-700">pending</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-xs font-medium ' +
                        ageCls(r.seconds_open || 0)
                      }
                    >
                      {days}d
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                  No open lookback investigations.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
