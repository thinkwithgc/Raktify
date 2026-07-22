import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';
import { errorMessage } from '../../lib/errorMessage.js';

// Mobilise-only surface for community leaders: the requests the blood-bank path
// couldn't fill, across the districts they serve. A leader "adopts" one for a
// community — which unlocks the case chat and gives that community's donors
// first-alert priority. Leaders never raise requests and never see patient PII.

const URG = { CR: 'bg-rk-700 text-white', UR: 'bg-amber-500 text-white', PL: 'bg-slate-300 text-slate-800' };

export function LeaderMobilise({ communities }) {
  return (
    <div className="space-y-5">
      <ServedDistricts />
      <OpenRequests communities={communities} />
    </div>
  );
}

function ServedDistricts() {
  const qc = useQueryClient();
  const [stateId, setStateId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const q = useQuery({
    queryKey: ['community-leader', 'served-districts'],
    queryFn: () => apiRequest('GET', '/community-leader/served-districts'),
  });
  const statesQ = useQuery({ queryKey: ['geo', 'states'], queryFn: () => apiRequest('GET', '/geography/states') });
  const districtsQ = useQuery({
    queryKey: ['geo', 'districts', stateId],
    queryFn: () => apiRequest('GET', `/geography/districts?state_id=${stateId}`),
    enabled: !!stateId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['community-leader', 'served-districts'] })
    && qc.invalidateQueries({ queryKey: ['community-leader', 'open-requests'] });

  const add = useMutation({
    mutationFn: (id) => apiRequest('POST', '/community-leader/served-districts', { district_id: id }),
    onSuccess: () => { setStateId(''); setDistrictId(''); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id) => apiRequest('DELETE', `/community-leader/served-districts/${id}`),
    onSuccess: refresh,
  });

  const served = q.data?.districts || [];
  const states = statesQ.data?.states || statesQ.data || [];
  const districts = districtsQ.data?.districts || districtsQ.data || [];

  return (
    <section className="rk-card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Districts you serve</h2>
      <p className="mt-1 text-xs text-stone-500">
        You’ll see requests needing donors across these districts. Your home district is always included.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {served.map((d) => (
          <span key={d.id} className="inline-flex items-center gap-1 rounded-full bg-sand px-3 py-1 text-sm text-stone-800">
            {d.name}
            {d.is_home ? (
              <span className="text-[10px] uppercase text-stone-500">home</span>
            ) : (
              <button type="button" className="text-stone-400 hover:text-rk-700" title="Remove"
                onClick={() => remove.mutate(d.id)}>
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <select className="rk-input max-w-[10rem]" value={stateId}
          onChange={(e) => { setStateId(e.target.value); setDistrictId(''); }}>
          <option value="">State…</option>
          {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="rk-input max-w-[10rem]" value={districtId} disabled={!stateId}
          onChange={(e) => setDistrictId(e.target.value)}>
          <option value="">District…</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="button" className="rk-button-secondary" disabled={!districtId || add.isPending}
          onClick={() => add.mutate(Number(districtId))}>
          {add.isPending ? '…' : 'Add district'}
        </button>
      </div>
    </section>
  );
}

function OpenRequests({ communities }) {
  const q = useQuery({
    queryKey: ['community-leader', 'open-requests'],
    queryFn: () => apiRequest('GET', '/community-leader/open-requests'),
    refetchInterval: 20_000,
  });

  const owned = (communities || []).filter((c) => c.is_owner);
  const adoptable = owned.length > 0 ? owned : communities || [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Requests needing donors</h2>
        <span className="text-xs text-stone-400">Auto-refresh every 20s</span>
      </div>
      <p className="text-xs text-stone-500">
        These couldn’t be filled from blood-bank stock and are now looking for donors in your area.
        Adopt one to coordinate it for your community and rally your donors.
      </p>

      {q.isLoading ? (
        <div className="rk-card text-center text-stone-500">…</div>
      ) : q.error ? (
        <div className="rk-card text-rk-700">{errorMessage(q.error, 'load these requests')}</div>
      ) : (q.data?.requests || []).length === 0 ? (
        <div className="rk-card py-6 text-center text-sm text-stone-500">
          Nothing needs donors in your districts right now. When a request can’t be met from
          blood-bank stock, it’ll show up here.
        </div>
      ) : (
        <ul className="space-y-3">
          {(q.data.requests || []).map((r) => (
            <RequestRow key={r.id} r={r} adoptable={adoptable} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestRow({ r, adoptable }) {
  const qc = useQueryClient();
  const [err, setErr] = useState(null);
  const [communityId, setCommunityId] = useState(adoptable[0]?.id || '');

  const adopt = useMutation({
    mutationFn: () => apiRequest('POST', `/community-leader/requests/${r.id}/adopt`, { community_id: communityId }),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['community-leader', 'open-requests'] });
    },
    onError: (e) => setErr(errorMessage(e, 'adopt this request')),
  });

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${URG[r.urgency_tier] || URG.PL}`}>
          {r.urgency_tier}
        </span>
        <span className="font-mono text-[11px] text-slate-500">{r.request_number}</span>
        <span className="ml-auto text-sm font-semibold text-slate-900">
          {r.blood_group} · {r.component} · {r.units_short} needed
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {r.district_name}
        {r.needed_by ? ` · needed by ${new Date(r.needed_by).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
      </div>

      {err ? <p className="mt-2 text-sm text-rk-700">{err}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
        {r.adopted_by_me ? (
          <>
            <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
              Adopted by your community
            </span>
            <Link to={`/community-leader/requests/${r.id}`} className="text-xs font-semibold text-rk-700 hover:underline">
              Open case chat →
            </Link>
          </>
        ) : adoptable.length === 0 ? (
          <span className="text-xs italic text-slate-400">
            Create a community first to adopt requests.
          </span>
        ) : (
          <>
            {adoptable.length > 1 ? (
              <select className="rk-input max-w-[12rem] text-sm" value={communityId}
                onChange={(e) => setCommunityId(e.target.value)}>
                {adoptable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : null}
            <button type="button" className="rk-button-primary" disabled={adopt.isPending || !communityId}
              onClick={() => adopt.mutate()}>
              {adopt.isPending ? '…' : 'Adopt & coordinate'}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
