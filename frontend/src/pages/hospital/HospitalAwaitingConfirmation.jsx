import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';
import { errorMessage } from '../../lib/errorMessage.js';

// Requests a citizen raised naming THIS hospital, awaiting the hospital's
// confirmation of the clinical need. Confirming runs the matcher (it becomes a
// normal hospital request); declining cancels it.
const URG = {
  CR: 'bg-rk-700 text-white',
  UR: 'bg-amber-500 text-white',
  PL: 'bg-slate-300 text-slate-800',
};

export function HospitalAwaitingConfirmation() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['hospital', 'awaiting-confirmation'],
    queryFn: () => apiRequest('GET', '/requests/awaiting-confirmation'),
    refetchInterval: 20_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['hospital', 'awaiting-confirmation'] });
    qc.invalidateQueries({ queryKey: ['hospital', 'requests'] });
  };

  if (q.isLoading) return <div className="rk-card text-center text-slate-500">…</div>;
  if (q.error)
    return <div className="rk-card text-rk-700">{errorMessage(q.error, 'load these requests')}</div>;

  const rows = q.data?.requests || [];
  if (rows.length === 0) {
    return (
      <div className="rk-card py-6 text-center text-sm text-slate-500">
        No requests are awaiting your confirmation. When a patient (or their relative) raises a
        request naming your hospital, it appears here for you to confirm the clinical need.
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Raised on your behalf</h1>
        <span className="text-xs text-slate-400">Auto-refresh every 20s</span>
      </div>
      <p className="text-sm text-slate-600">
        A patient or relative raised these naming your hospital. Confirm the clinical need to start
        sourcing blood, or decline if it isn’t a request you recognise.
      </p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <ConfirmCard key={r.id} r={r} onDone={refresh} />
        ))}
      </ul>
    </section>
  );
}

function ConfirmCard({ r, onDone }) {
  const [err, setErrState] = useState(null);
  const confirm = useMutation({
    mutationFn: () => apiRequest('POST', `/requests/${r.id}/hospital-confirm`, {}),
    onSuccess: onDone,
    onError: (e) => setErrState(errorMessage(e, 'confirm this request')),
  });
  const reject = useMutation({
    mutationFn: () => apiRequest('POST', `/requests/${r.id}/hospital-reject`, {}),
    onSuccess: onDone,
    onError: (e) => setErrState(errorMessage(e, 'decline this request')),
  });
  const busy = confirm.isPending || reject.isPending;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${URG[r.urgency_tier] || URG.PL}`}>
          {r.urgency_tier}
        </span>
        <span className="font-mono text-[11px] text-slate-500">{r.request_number}</span>
        <span className="ml-auto text-sm font-semibold text-slate-900">
          {r.blood_group} · {r.component} · {r.units_required}u
        </span>
      </div>
      <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <span className="text-xs uppercase text-slate-500">Patient</span>
          <div className="text-slate-900">
            {r.patient_initials || '—'} · {r.patient_age ?? '?'}y · {r.patient_gender || '?'} · {r.ward_or_bed}
          </div>
        </div>
        <div>
          <span className="text-xs uppercase text-slate-500">Needed by</span>
          <div className="text-slate-900">
            {r.needed_by ? new Date(r.needed_by).toLocaleString('en-IN') : '—'}
          </div>
        </div>
      </div>
      {err ? <p className="mt-2 text-sm text-rk-700">{err}</p> : null}
      <div className="mt-3 flex gap-2 border-t border-slate-100 pt-2">
        <button type="button" className="rk-button-primary" disabled={busy} onClick={() => confirm.mutate()}>
          {confirm.isPending ? '…' : 'Confirm — this is our patient'}
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          disabled={busy}
          onClick={() => reject.mutate()}
        >
          Decline
        </button>
      </div>
    </li>
  );
}
