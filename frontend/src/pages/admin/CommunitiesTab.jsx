import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'suspended', label: 'Suspended' },
];

const OWNER_FILTERS = [
  { id: 'all', label: 'All owners' },
  { id: 'community_leader', label: 'Leader-owned' },
  { id: 'coordinator', label: 'Coordinator-owned' },
];

/**
 * Director / NGO admin view of all communities across the platform.
 *
 * Read-only for v1 — no actions on community rows from /admin yet.
 * The leader/coordinator who owns the row manages it from their own
 * portal. Future Phase 4 could add admin-side suspend / transfer-
 * ownership if there's demand.
 */
export function CommunitiesTab() {
  const [status, setStatus] = useState('all');
  const [ownerType, setOwnerType] = useState('all');

  const listQ = useQuery({
    queryKey: ['admin', 'communities', status, ownerType],
    queryFn: () =>
      apiRequest(
        'GET',
        `/admin/communities?status=${status}&owner_type=${ownerType}`,
      ),
    staleTime: 30_000,
  });

  const rows = listQ.data?.communities || [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatus(f.id)}
            className={
              'rounded-full border px-3 py-1 text-sm font-medium ' +
              (status === f.id
                ? 'border-rk-700 bg-rk-50 text-rk-900'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
            }
          >
            {f.label}
          </button>
        ))}
        <span className="mx-2 text-slate-300">·</span>
        {OWNER_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setOwnerType(f.id)}
            className={
              'rounded-full border px-3 py-1 text-sm font-medium ' +
              (ownerType === f.id
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
              <th className="px-3 py-2 text-left">Community</th>
              <th className="px-3 py-2 text-left">Owner</th>
              <th className="px-3 py-2 text-left">Region</th>
              <th className="px-3 py-2 text-right">Donors</th>
              <th className="px-3 py-2 text-right">Active</th>
              <th className="px-3 py-2 text-right">Co-leaders</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">
                  <div className="font-medium text-stone-900">{c.name}</div>
                  <div className="font-mono text-[10px] text-slate-400">/community/{c.slug}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-stone-800">{c.owner_display_name || '—'}</div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    {c.owner_type === 'community_leader'
                      ? 'Community leader'
                      : c.owner_type === 'coordinator'
                        ? 'NGO coordinator'
                        : 'Unknown'}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {[c.taluka_name, c.district_name, c.state_name].filter(Boolean).join(', ') ||
                    '—'}
                </td>
                <td className="px-3 py-2 text-right">{c.donor_count}</td>
                <td className="px-3 py-2 text-right">{c.active_donor_count}</td>
                <td className="px-3 py-2 text-right">{c.moderator_count}</td>
                <td className="px-3 py-2">
                  {c.is_active ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                      Suspended
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-stone-600">
                  {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !listQ.isLoading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                  No communities match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
