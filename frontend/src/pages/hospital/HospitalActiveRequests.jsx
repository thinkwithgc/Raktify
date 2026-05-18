import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';
import { useT } from '../../i18n/useT.js';

const URGENCY = {
  CR: { label: 'Critical', cls: 'bg-rk-700 text-white' },
  UR: { label: 'Urgent', cls: 'bg-amber-500 text-white' },
  PL: { label: 'Planned', cls: 'bg-slate-300 text-slate-800' },
};

const STATUS_LABEL = {
  OP: 'Open · matching',
  MT: 'Matched',
  AS: 'Assigned',
  PF: 'Partly fulfilled',
  FU: 'Fulfilled · awaiting crossmatch',
  CL: 'Closed',
  CA: 'Cancelled',
  EX: 'Expired',
};

function fmtTime(iso, lang) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(lang || 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function HospitalActiveRequests() {
  const { lang } = useT();
  const qc = useQueryClient();

  const listQ = useQuery({
    queryKey: ['hospital', 'requests'],
    queryFn: () => apiRequest('GET', '/requests/mine'),
    staleTime: 0,
    refetchInterval: 30_000,
  });

  const confirm = useMutation({
    mutationFn: (id) => apiRequest('POST', `/requests/${id}/confirm-crossmatch`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hospital', 'requests'] }),
  });

  const rows = listQ.data?.requests || [];

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-slate-900">My requests</h1>
        <span className="text-sm text-slate-500">
          {listQ.isFetching ? '…' : `${rows.length} total`}
        </span>
      </div>

      {listQ.error ? (
        <div className="rk-card text-rk-700">
          {listQ.error?.response?.data?.error || 'load_failed'}
        </div>
      ) : null}

      {rows.length === 0 && !listQ.isLoading ? (
        <div className="rk-card text-sm text-slate-500">
          No requests yet — use the Raise tab to create one.
        </div>
      ) : null}

      <ul className="space-y-2">
        {rows.map((r) => {
          const u = URGENCY[r.urgency_tier] || URGENCY.PL;
          const awaitingCrossmatch =
            ['FU', 'PF'].includes(r.status) && !r.crossmatch_confirmed;
          return (
            <li key={r.id} className="rk-card space-y-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-md px-2 py-1 text-xs font-bold ${u.cls}`}>
                  {u.label}
                </span>
                <span className="font-mono text-sm text-slate-700">{r.request_number}</span>
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  {STATUS_LABEL[r.status] || r.status}
                </span>
              </div>

              <div className="text-sm text-slate-900">
                <span className="font-semibold">
                  {r.blood_group_code || '—'} · {r.component_code || '—'}
                </span>{' '}
                · {r.units_fulfilled}/{r.units_required} units
              </div>

              <dl className="grid grid-cols-2 gap-1 text-xs text-slate-600">
                <dt className="text-slate-400">Raised</dt>
                <dd>{fmtTime(r.raised_at, lang)}</dd>
                <dt className="text-slate-400">Needed by</dt>
                <dd>{fmtTime(r.needed_by, lang)}</dd>
                <dt className="text-slate-400">Coordinator</dt>
                <dd>{r.coordinator_name || 'pending assignment'}</dd>
                <dt className="text-slate-400">Matched BB</dt>
                <dd>{r.matched_blood_bank_name || 'searching…'}</dd>
              </dl>

              {awaitingCrossmatch ? (
                <div className="mt-2 rounded-md bg-amber-50 p-3 ring-1 ring-amber-200">
                  <p className="text-sm font-semibold text-amber-900">
                    Confirm crossmatch
                  </p>
                  <p className="text-xs text-amber-800">
                    Once the transfusion is complete, confirm crossmatch to close this request.
                    Spec §7 — crossmatch_confirmed=TRUE is the hospital's affirmation.
                  </p>
                  <button
                    type="button"
                    className="rk-button-primary mt-2 text-sm"
                    onClick={() => confirm.mutate(r.id)}
                    disabled={confirm.isPending}
                  >
                    {confirm.isPending ? '…' : 'Confirm crossmatch'}
                  </button>
                  {confirm.error ? (
                    <p className="mt-1 text-xs text-rk-700">
                      {confirm.error?.response?.data?.error}
                    </p>
                  ) : null}
                </div>
              ) : r.crossmatch_confirmed ? (
                <div className="text-xs text-green-700">
                  ✓ Crossmatch confirmed at {fmtTime(r.crossmatch_confirmed_at, lang)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
