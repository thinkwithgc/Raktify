import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';

// Curated list — these phenotypes are the ones a typical Indian blood bank
// would catalogue. Admin can still type a custom code if needed.
const PHENOTYPES = [
  { code: 'BOMBAY',     desc: 'Bombay (hh / Oh)',         is_bombay: true },
  { code: 'RH_NULL',    desc: 'Rh-null',                  is_bombay: false },
  { code: 'WEAK_D',     desc: 'Weak D variant',           is_bombay: false },
  { code: 'PARTIAL_D',  desc: 'Partial D variant',        is_bombay: false },
  { code: 'MNS_LOW_INC',desc: 'MNS low-incidence',        is_bombay: false },
  { code: 'KELL_NEG',   desc: 'Kell-negative (K-)',       is_bombay: false },
  { code: 'DUFFY_NEG',  desc: 'Duffy a-/b- (Fy(a-b-))',   is_bombay: false },
];

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return String(v);
  }
}

export function RareBloodTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const listQ = useQuery({
    queryKey: ['admin', 'rare-blood'],
    queryFn: () => apiRequest('GET', '/registries/rare-blood'),
    staleTime: 30_000,
  });

  const rows = listQ.data?.registry || [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Rare-blood registry
        </h2>
        <button
          type="button"
          className="rk-button-primary text-sm"
          onClick={() => setShowForm((s) => !s)}
        >
          {showForm ? 'Close' : '+ Enrol rare donor'}
        </button>
      </div>

      {showForm ? (
        <EnrolForm
          onCreated={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ['admin', 'rare-blood'] });
          }}
        />
      ) : null}

      <div className="rk-card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Donor / contact</th>
              <th className="px-3 py-2 text-left">Phenotype</th>
              <th className="px-3 py-2 text-left">ABO/Rh</th>
              <th className="px-3 py-2 text-left">Verified</th>
              <th className="px-3 py-2 text-left">District</th>
              <th className="px-3 py-2 text-left">Broadcast</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  {r.donor_id ? (
                    <>
                      <div className="font-medium text-slate-900">
                        {r.donor_name}
                        {r.donor_blood_group_code ? (
                          <span className="ml-1 text-xs text-slate-500">
                            ({r.donor_blood_group_code})
                          </span>
                        ) : null}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">
                        donor · {r.donor_id.slice(0, 8)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="font-medium text-slate-900">Shadow entry</div>
                      <div className="text-xs text-slate-500">Not yet a Raktify donor</div>
                    </>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="font-semibold text-rk-700">{r.phenotype_code}</div>
                  <div className="text-xs text-slate-500">{r.phenotype_description}</div>
                  {r.is_bombay ? (
                    <span className="mt-0.5 inline-block rounded-full bg-rk-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      BOMBAY
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {r.abo_type || '—'}
                  {r.rh_factor || ''}
                </td>
                <td className="px-3 py-2">
                  <div className="text-slate-700">{r.verified_by_name}</div>
                  <div className="text-xs text-slate-500">
                    {fmtDate(r.verified_at)}
                    {r.verified_method ? ` · ${r.verified_method}` : ''}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-700">{r.contact_district_name || '—'}</td>
                <td className="px-3 py-2">
                  {r.broadcast_consent ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      National
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      District-only
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !listQ.isLoading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                  No rare-blood donors enrolled yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Bombay (Oh) donors can only transfuse other Bombay recipients — they are flagged
        nationally regardless of broadcast consent for matching purposes.
      </p>
    </section>
  );
}

function EnrolForm({ onCreated }) {
  const [form, setForm] = useState({
    mode: 'donor', // 'donor' | 'shadow'
    donor_id: '',
    phenotype_code: 'BOMBAY',
    phenotype_description: 'Bombay (hh / Oh)',
    abo_type: 'O',
    rh_factor: '+',
    is_bombay: true,
    verified_by_institution_id: '',
    verified_method: 'IAT',
    contact_name: '',
    contact_mobile: '',
    broadcast_consent: false,
  });
  const [err, setErr] = useState('');

  function pickPhenotype(code) {
    const p = PHENOTYPES.find((x) => x.code === code);
    if (!p) return;
    setForm((prev) => ({
      ...prev,
      phenotype_code: p.code,
      phenotype_description: p.desc,
      is_bombay: p.is_bombay,
    }));
  }

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        phenotype_code: form.phenotype_code,
        phenotype_description: form.phenotype_description,
        abo_type: form.abo_type,
        rh_factor: form.rh_factor,
        is_bombay: form.is_bombay,
        verified_by_institution_id: form.verified_by_institution_id,
        verified_method: form.verified_method || undefined,
        broadcast_consent: form.broadcast_consent,
      };
      if (form.mode === 'donor') {
        payload.donor_id = form.donor_id;
      } else {
        payload.contact_name = form.contact_name;
        payload.contact_mobile = form.contact_mobile;
      }
      return apiRequest('POST', '/registries/rare-blood', payload);
    },
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
    <form onSubmit={submit} className="rk-card grid gap-3 sm:grid-cols-3">
      <h3 className="col-span-full text-sm font-semibold uppercase tracking-wide text-slate-500">
        Enrol rare-blood donor
      </h3>
      <div className="col-span-full flex gap-2">
        {[
          { v: 'donor', label: 'Existing Raktify donor' },
          { v: 'shadow', label: 'Shadow entry (not yet a donor)' },
        ].map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => set('mode', opt.v)}
            className={
              'rounded-lg border px-3 py-1.5 text-sm font-medium ' +
              (form.mode === opt.v
                ? 'border-rk-700 bg-rk-700 text-white'
                : 'border-slate-300 bg-white text-slate-700')
            }
          >
            {opt.label}
          </button>
        ))}
      </div>

      {form.mode === 'donor' ? (
        <label className="col-span-full block">
          <span className="rk-label">Donor ID (UUID)</span>
          <input
            className="rk-input font-mono text-xs"
            value={form.donor_id}
            onChange={(e) => set('donor_id', e.target.value)}
            placeholder="paste donor UUID"
            required
          />
        </label>
      ) : (
        <>
          <label className="block sm:col-span-2">
            <span className="rk-label">Contact name</span>
            <input className="rk-input" value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} required />
          </label>
          <label className="block">
            <span className="rk-label">Contact mobile</span>
            <input className="rk-input" value={form.contact_mobile} onChange={(e) => set('contact_mobile', e.target.value)} placeholder="9XXXXXXXXX" required />
          </label>
        </>
      )}

      <label className="block">
        <span className="rk-label">Phenotype</span>
        <select className="rk-input" value={form.phenotype_code} onChange={(e) => pickPhenotype(e.target.value)}>
          {PHENOTYPES.map((p) => (
            <option key={p.code} value={p.code}>{p.code}</option>
          ))}
        </select>
      </label>
      <label className="block sm:col-span-2">
        <span className="rk-label">Description</span>
        <input className="rk-input" value={form.phenotype_description} onChange={(e) => set('phenotype_description', e.target.value)} />
      </label>
      <label className="block">
        <span className="rk-label">ABO</span>
        <select className="rk-input" value={form.abo_type} onChange={(e) => set('abo_type', e.target.value)}>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="AB">AB</option>
          <option value="O">O</option>
        </select>
      </label>
      <label className="block">
        <span className="rk-label">Rh</span>
        <select className="rk-input" value={form.rh_factor} onChange={(e) => set('rh_factor', e.target.value)}>
          <option value="+">+ (positive)</option>
          <option value="-">- (negative)</option>
        </select>
      </label>
      <label className="block">
        <span className="rk-label">Verified method</span>
        <select className="rk-input" value={form.verified_method} onChange={(e) => set('verified_method', e.target.value)}>
          <option value="IAT">IAT</option>
          <option value="Genotyping">Genotyping</option>
          <option value="Reference panel">Reference panel</option>
        </select>
      </label>
      <label className="block sm:col-span-3">
        <span className="rk-label">Verified by institution ID (UUID)</span>
        <input className="rk-input font-mono text-xs" value={form.verified_by_institution_id} onChange={(e) => set('verified_by_institution_id', e.target.value)} placeholder="paste blood bank or hospital UUID" required />
      </label>
      <label className="col-span-full inline-flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.broadcast_consent}
          onChange={(e) => set('broadcast_consent', e.target.checked)}
        />
        Donor has consented to national broadcasting (cross-state alerts)
      </label>

      {err ? <p className="col-span-full text-sm text-rk-700">{err}</p> : null}
      <div className="col-span-full flex justify-end">
        <button type="submit" className="rk-button-primary text-sm" disabled={create.isPending}>
          {create.isPending ? '…' : 'Enrol'}
        </button>
      </div>
    </form>
  );
}
