import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'active', label: 'Active' },
  { id: 'suspended', label: 'Suspended' },
];

export function CoordinatorsTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('pending');

  const listQ = useQuery({
    queryKey: ['admin', 'coordinators', filter],
    queryFn: () =>
      apiRequest('GET', `/admin/coordinators${filter ? `?status=${filter}` : ''}`),
    staleTime: 15_000,
  });

  const verify = useMutation({
    mutationFn: (id) => apiRequest('POST', `/admin/coordinators/${id}/verify`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'coordinators'] }),
  });

  const suspend = useMutation({
    mutationFn: ({ id, reason }) =>
      apiRequest('POST', `/admin/coordinators/${id}/suspend`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'coordinators'] }),
  });

  const rows = listQ.data?.coordinators || [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id || 'all'}
            type="button"
            onClick={() => setFilter(f.id)}
            className={
              'rounded-full border px-3 py-1 text-sm font-medium ' +
              (filter === f.id
                ? 'border-rk-700 bg-rk-50 text-rk-900'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
            }
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-sm text-slate-500">
          {listQ.isFetching ? '…' : `${rows.length} shown`}
        </span>
      </div>

      {listQ.error ? (
        <div className="rk-card text-rk-700">
          {listQ.error?.response?.data?.error || 'load_failed'}
        </div>
      ) : null}

      <div className="rk-card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Coordinator</th>
              <th className="px-3 py-2 text-left">District</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Reliability</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">{c.display_name}</div>
                  <div className="font-mono text-[10px] text-slate-400">{c.id}</div>
                </td>
                <td className="px-3 py-2">{c.district_id}</td>
                <td className="px-3 py-2">
                  <StatusBadge c={c} />
                </td>
                <td className="px-3 py-2 text-right">{c.reliability_score}/100</td>
                <td className="px-3 py-2 text-right">
                  {c.id_verified_at ? null : (
                    <button
                      type="button"
                      className="rk-button-primary text-xs"
                      onClick={() => verify.mutate(c.id)}
                      disabled={verify.isPending}
                    >
                      Verify
                    </button>
                  )}
                  {c.is_active ? (
                    <button
                      type="button"
                      className="ml-2 text-xs text-rk-700 hover:underline"
                      onClick={() => {
                        const reason = window.prompt('Suspension reason (5+ chars)?');
                        if (reason && reason.length >= 5) {
                          suspend.mutate({ id: c.id, reason });
                        }
                      }}
                      disabled={suspend.isPending}
                    >
                      Suspend
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !listQ.isLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                  No coordinators in this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusBadge({ c }) {
  const cls =
    c.suspended_at != null
      ? 'bg-rk-700 text-white'
      : c.id_verified_at == null
        ? 'bg-amber-500 text-white'
        : c.is_active
          ? 'bg-green-100 text-green-800'
          : 'bg-slate-200 text-slate-700';
  const label =
    c.suspended_at != null
      ? 'Suspended'
      : c.id_verified_at == null
        ? 'Pending'
        : c.is_active
          ? 'Active'
          : 'Inactive';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
