import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Header } from './Header.jsx';
import { Footer } from './Footer.jsx';
import { RequestSummary } from './RequestSummary.jsx';
import { CaseThread } from './CaseThread.jsx';
import { apiRequest } from '../lib/api.js';
import { errorMessage } from '../lib/errorMessage.js';
import { useAuth } from '../auth/AuthContext.jsx';

// One case-detail page, configured per portal by the route (hospital, blood
// bank, community leader). The API + RLS return only what the caller is a party
// to — a non-party gets 404 here rather than an empty page — so the page itself
// needs no role logic beyond the custody actions below.

// The hospital's terminal step: confirm the unit(s) went into the patient.
// Non-blocking — it does NOT wait for the coordinator's receipt confirmation
// (an issued or received bag can both be transfused). When the last committed
// unit is transfused the request auto-fulfils (backend).
function HospitalTransfuseAction({ r, id }) {
  const qc = useQueryClient();
  const [err, setErr] = useState(null);
  const awaiting = (r.units_issued || 0) + (r.units_received || 0);
  const transfuse = useMutation({
    mutationFn: () => apiRequest('POST', `/requests/${id}/confirm-transfused`, {}),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['request', id] });
      qc.invalidateQueries({ queryKey: ['hospital', 'requests'] });
    },
    onError: (e) => setErr(errorMessage(e, 'confirm transfusion')),
  });
  if (awaiting === 0) return null;
  return (
    <div className="rk-card">
      <h3 className="text-sm font-semibold text-slate-700">Confirm transfusion</h3>
      <p className="mt-1 text-xs text-slate-500">
        {awaiting} unit{awaiting !== 1 ? 's' : ''} {awaiting !== 1 ? 'have' : 'has'} reached you.
        Mark {awaiting !== 1 ? 'them' : 'it'} transfused once given to the patient.
      </p>
      {err ? <p className="mt-2 text-sm text-rk-700">{err}</p> : null}
      <button
        type="button"
        onClick={() => transfuse.mutate()}
        disabled={transfuse.isPending}
        className="rk-button-primary mt-2"
      >
        {transfuse.isPending
          ? 'Saving…'
          : `Mark ${awaiting} unit${awaiting !== 1 ? 's' : ''} transfused`}
      </button>
    </div>
  );
}

export function CaseDetailPage({ backTo, backLabel, subtitle = 'Case' }) {
  const { id } = useParams();
  const { role } = useAuth();

  const q = useQuery({
    queryKey: ['request', id],
    queryFn: () => apiRequest('GET', `/requests/${id}`),
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const r = q.data;

  return (
    <div className="flex min-h-full flex-col">
      <Header subtitle={subtitle} />
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
        <div>
          <Link to={backTo} className="text-sm text-rk-700 hover:underline">
            ← {backLabel}
          </Link>
        </div>

        {q.isLoading ? (
          <div className="rk-card text-center text-slate-500">…</div>
        ) : q.error ? (
          <div className="rk-card text-rk-700">{errorMessage(q.error, 'open this case')}</div>
        ) : r ? (
          <>
            <RequestSummary r={r} />
            {role === 'hospital' ? <HospitalTransfuseAction r={r} id={id} /> : null}
            <CaseThread requestId={id} />
          </>
        ) : null}
      </main>
      <Footer variant="compact" />
    </div>
  );
}
