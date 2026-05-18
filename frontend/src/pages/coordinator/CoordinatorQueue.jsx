import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Header } from '../../components/Header.jsx';
import { apiRequest } from '../../lib/api.js';
import { useT } from '../../i18n/useT.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const URGENCY = {
  CR: { label: 'Critical', cls: 'bg-rk-700 text-white' },
  UR: { label: 'Urgent', cls: 'bg-amber-500 text-white' },
  PL: { label: 'Planned', cls: 'bg-slate-300 text-slate-800' },
};

function elapsed(seconds, lang) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function CoordinatorQueue() {
  const { t, lang } = useT();
  const { role } = useAuth();
  const qc = useQueryClient();

  // Spec §7: emergency view = no stale data. Refetch every 15s + on focus.
  const queueQuery = useQuery({
    queryKey: ['coordinator', 'requests'],
    queryFn: () => apiRequest('GET', '/coordinator/requests'),
    staleTime: 0,
    refetchInterval: 15_000,
  });

  const accept = useMutation({
    mutationFn: (id) => apiRequest('POST', `/coordinator/requests/${id}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coordinator', 'requests'] }),
  });

  const rows = queueQuery.data?.requests || [];

  return (
    <div className="min-h-full">
      <Header subtitle={role === 'coordinator' ? 'Coordinator dashboard' : role} />
      <main className="mx-auto max-w-3xl space-y-3 px-4 py-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold text-slate-900">{t('queue_title')}</h1>
          <span className="text-sm text-slate-500">
            {queueQuery.isFetching ? '…' : `${rows.length} open`}
          </span>
        </div>

        {queueQuery.error ? (
          <div className="rk-card text-rk-700">
            {queueQuery.error?.response?.data?.error || 'load_failed'}
          </div>
        ) : null}

        {rows.length === 0 && !queueQuery.isLoading ? (
          <div className="rk-card text-sm text-slate-500">No open requests in your district.</div>
        ) : null}

        <ul className="space-y-2">
          {rows.map((r) => {
            const u = URGENCY[r.urgency_tier] || URGENCY.PL;
            return (
              <li key={r.id} className="rk-card flex items-center gap-3">
                <span className={`rounded-md px-2 py-1 text-xs font-bold ${u.cls}`}>{u.label}</span>
                <Link to={`/coordinator/requests/${r.id}`} className="min-w-0 flex-1 hover:opacity-90">
                  <div className="font-mono text-sm text-slate-700">{r.request_number}</div>
                  <div className="font-medium text-slate-900">
                    {r.blood_group_code || '—'} · {r.component_code || '—'} · {r.units_fulfilled}/
                    {r.units_required} {t('units')}
                  </div>
                  <div className="text-xs text-slate-500">
                    raised {elapsed(r.seconds_since_raised, lang)} ago · status {r.status}
                  </div>
                </Link>
                {r.coordinator_accepted_at ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    accepted
                  </span>
                ) : role === 'coordinator' ? (
                  <button
                    type="button"
                    className="rk-button-primary text-sm"
                    onClick={() => accept.mutate(r.id)}
                    disabled={accept.isPending}
                  >
                    Accept
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
