import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';

const STATUS = {
  PL: { label: 'Planned', cls: 'bg-amber-100 text-amber-800' },
  LV: { label: 'Live', cls: 'bg-green-100 text-green-800' },
  CO: { label: 'Completed', cls: 'bg-slate-200 text-slate-800' },
  CA: { label: 'Cancelled', cls: 'bg-rk-700 text-white' },
};

const ORGANISER = {
  CC: 'Corporate',
  CO: 'Coordinator',
  EI: 'Educational',
  EO: 'External org',
  MC: 'Medical college',
  OT: 'Other',
};

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return String(v);
  }
}

export function CampsTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedCamp, setSelectedCamp] = useState(null);

  const listQ = useQuery({
    queryKey: ['admin', 'camps'],
    queryFn: () => apiRequest('GET', '/camps'),
    staleTime: 30_000,
  });

  const rows = listQ.data?.camps || [];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Upcoming donation camps
        </h2>
        <button
          type="button"
          className="rk-button-primary text-sm"
          onClick={() => setShowForm((s) => !s)}
        >
          {showForm ? 'Close' : '+ Schedule a camp'}
        </button>
      </div>

      {showForm ? <CreateCampForm onCreated={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['admin', 'camps'] }); }} /> : null}

      <div className="rk-card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Camp</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">District</th>
              <th className="px-3 py-2 text-left">Organiser</th>
              <th className="px-3 py-2 text-right">Registered</th>
              <th className="px-3 py-2 text-right">Attended</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => {
              const s = STATUS[c.status] || STATUS.PL;
              return (
                <tr key={c.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">
                      {c.venue} · {c.start_time?.slice(0, 5)}–{c.end_time?.slice(0, 5)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{fmtDate(c.scheduled_date)}</td>
                  <td className="px-3 py-2 text-slate-700">{c.district_name}</td>
                  <td className="px-3 py-2">
                    <div className="text-slate-800">{c.organiser_name}</div>
                    <div className="text-xs text-slate-500">{ORGANISER[c.organiser_type]}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">
                    {c.registered_donor_count}
                    {c.target_donor_count ? (
                      <span className="text-xs font-normal text-slate-500"> / {c.target_donor_count}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{c.attended_donor_count}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                      {s.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs font-medium text-rk-700 hover:underline"
                      onClick={() => setSelectedCamp(c)}
                    >
                      Roster →
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !listQ.isLoading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                  No upcoming camps yet — click “Schedule a camp” to add one.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedCamp ? (
        <RosterPanel camp={selectedCamp} onClose={() => setSelectedCamp(null)} />
      ) : null}
    </section>
  );
}

function CreateCampForm({ onCreated }) {
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [form, setForm] = useState({
    name: '',
    state_id: 0,
    district_id: 0,
    venue: '',
    address_line: '',
    pincode: '',
    scheduled_date: '',
    start_time: '09:00',
    end_time: '15:00',
    organiser_type: 'CO',
    organiser_name: '',
    target_donor_count: '',
  });
  const [err, setErr] = useState('');

  useEffect(() => {
    apiRequest('GET', '/geography/states').then((r) => setStates(r.states || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!form.state_id) {
      setDistricts([]);
      return;
    }
    apiRequest('GET', `/geography/districts?state_id=${form.state_id}`)
      .then((r) => setDistricts(r.districts || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.state_id]);

  const create = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/camps', {
        ...form,
        state_id: Number(form.state_id),
        district_id: Number(form.district_id),
        target_donor_count: form.target_donor_count ? Number(form.target_donor_count) : undefined,
        pincode: form.pincode || undefined,
      }),
    onSuccess: () => onCreated(),
    onError: (e) => setErr(e?.response?.data?.error || 'create_failed'),
  });

  function set(k, v) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  function submit(e) {
    e.preventDefault();
    setErr('');
    create.mutate();
  }

  return (
    <form onSubmit={submit} className="rk-card grid gap-3 sm:grid-cols-2">
      <h3 className="col-span-full text-sm font-semibold uppercase tracking-wide text-slate-500">
        Schedule a new camp
      </h3>
      <label className="block">
        <span className="rk-label">Camp name</span>
        <input className="rk-input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </label>
      <label className="block">
        <span className="rk-label">Organiser</span>
        <input className="rk-input" value={form.organiser_name} onChange={(e) => set('organiser_name', e.target.value)} required />
      </label>
      <label className="block">
        <span className="rk-label">Organiser type</span>
        <select className="rk-input" value={form.organiser_type} onChange={(e) => set('organiser_type', e.target.value)}>
          {Object.entries(ORGANISER).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="rk-label">Target donors</span>
        <input
          className="rk-input"
          inputMode="numeric"
          value={form.target_donor_count}
          onChange={(e) => set('target_donor_count', e.target.value.replace(/\D/g, ''))}
          placeholder="e.g. 50"
        />
      </label>
      <label className="block">
        <span className="rk-label">State</span>
        <select className="rk-input" value={form.state_id} onChange={(e) => set('state_id', e.target.value)} required>
          <option value={0}>— select —</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="rk-label">District</span>
        <select className="rk-input" value={form.district_id} onChange={(e) => set('district_id', e.target.value)} disabled={!form.state_id} required>
          <option value={0}>— select —</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>
      <label className="block sm:col-span-2">
        <span className="rk-label">Venue</span>
        <input className="rk-input" value={form.venue} onChange={(e) => set('venue', e.target.value)} required />
      </label>
      <label className="block sm:col-span-2">
        <span className="rk-label">Address</span>
        <input className="rk-input" value={form.address_line} onChange={(e) => set('address_line', e.target.value)} required />
      </label>
      <label className="block">
        <span className="rk-label">Date</span>
        <input type="date" className="rk-input" value={form.scheduled_date} onChange={(e) => set('scheduled_date', e.target.value)} required />
      </label>
      <label className="block">
        <span className="rk-label">Pincode</span>
        <input
          className="rk-input"
          inputMode="numeric"
          maxLength={6}
          value={form.pincode}
          onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </label>
      <label className="block">
        <span className="rk-label">Start time</span>
        <input type="time" className="rk-input" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} required />
      </label>
      <label className="block">
        <span className="rk-label">End time</span>
        <input type="time" className="rk-input" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} required />
      </label>
      {err ? <p className="col-span-full text-sm text-rk-700">{err}</p> : null}
      <div className="col-span-full flex justify-end">
        <button type="submit" className="rk-button-primary text-sm" disabled={create.isPending}>
          {create.isPending ? '…' : 'Create camp'}
        </button>
      </div>
    </form>
  );
}

function RosterPanel({ camp, onClose }) {
  const q = useQuery({
    queryKey: ['admin', 'camp-roster', camp.id],
    queryFn: () => apiRequest('GET', `/camps/${camp.id}/registrations`),
  });
  const regs = q.data?.registrations || [];

  return (
    <article className="rk-card space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{camp.name}</h3>
          <p className="text-xs text-slate-500">
            {fmtDate(camp.scheduled_date)} · {camp.venue}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rk-button-secondary text-xs">
          Close
        </button>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-slate-500">…</p>
      ) : regs.length === 0 ? (
        <p className="text-sm text-slate-500">No registrations yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {regs.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium text-slate-900">{r.full_name}</span>
              <span className="text-xs text-slate-500">
                {r.blood_group_code || 'unverified'} · {fmtDate(r.registered_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
