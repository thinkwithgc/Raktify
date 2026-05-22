import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { apiRequest } from '../../lib/api.js';
import { donationSchema, openingStockSchema, zodFlatten } from '../../lib/schemas.js';
import { useT } from '../../i18n/useT.js';

// Spec §7 Blood Bank Portal: inventory dashboard, record donation, TTI entry,
// supervisor verification (4-eyes). Opening-stock and incoming-request alerts
// are deferred to the next pass.

function tabsFor(t) {
  return [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'inventory', label: t('inventory') },
    { id: 'record', label: t('record_donation') },
    { id: 'screening', label: t('tti_screening') },
    { id: 'opening', label: t('opening_stock') },
  ];
}

export function BloodBankPortal() {
  const { t } = useT();
  const [tab, setTab] = useState('dashboard');
  const TABS = tabsFor(t);

  return (
    <div className="flex min-h-full flex-col">
      <Header subtitle="Blood bank portal" />
      <main className="mx-auto w-full max-w-4xl px-4 py-6">
        <nav className="mb-4 flex gap-2 border-b border-slate-200">
          {TABS.map((tt) => (
            <button
              key={tt.id}
              type="button"
              onClick={() => setTab(tt.id)}
              className={
                'border-b-2 px-3 py-2 text-sm font-medium transition-colors ' +
                (tab === tt.id
                  ? 'border-rk-700 text-rk-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800')
              }
            >
              {tt.label}
            </button>
          ))}
        </nav>

        {tab === 'dashboard' ? <BBDashboard /> : null}
        {tab === 'inventory' ? <InventoryView /> : null}
        {tab === 'record' ? <RecordDonation /> : null}
        {tab === 'screening' ? <ScreeningEntry /> : null}
        {tab === 'opening' ? <OpeningStock /> : null}
      </main>
      <Footer variant="compact" />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard tab — at-a-glance overview for the blood bank
// ────────────────────────────────────────────────────────────────────────────
const GRID_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const URG = {
  CR: { label: 'Critical', cls: 'bg-rk-700 text-white' },
  UR: { label: 'Urgent', cls: 'bg-amber-500 text-white' },
  PL: { label: 'Planned', cls: 'bg-slate-300 text-slate-800' },
};

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return String(v);
  }
}

function KpiCard({ label, value, tone }) {
  return (
    <div className="rk-card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={'mt-1 text-3xl font-bold ' + (tone || 'text-slate-900')}>{value}</div>
    </div>
  );
}

function BBDashboard() {
  const q = useQuery({
    queryKey: ['bb', 'dashboard'],
    queryFn: () => apiRequest('GET', '/inventory/dashboard'),
    staleTime: 15_000,
  });

  if (q.isLoading) return <div className="rk-card text-center text-slate-500">…</div>;
  if (q.error)
    return (
      <div className="rk-card text-rk-700">
        {q.error?.response?.data?.error || 'load_failed'}
      </div>
    );

  const d = q.data || {};
  const k = d.kpis || {};
  const grid = d.inventory_grid || [];
  const components = [...new Set(grid.map((r) => r.component))].sort();
  const cellFor = (g, comp) => grid.find((r) => r.blood_group === g && r.component === comp);

  return (
    <section className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard label="Available units" value={k.available_units ?? 0} tone="text-green-700" />
        <KpiCard
          label="Expiring <48h"
          value={k.expiring_48h ?? 0}
          tone={k.expiring_48h ? 'text-rk-700' : 'text-slate-900'}
        />
        <KpiCard
          label="Pending TTI"
          value={k.pending_tti ?? 0}
          tone={k.pending_tti ? 'text-amber-600' : 'text-slate-900'}
        />
        <KpiCard label="Issued this month" value={k.issued_this_month ?? 0} />
        <KpiCard label="Donations today" value={k.donations_today ?? 0} />
      </div>

      {/* Inventory grid */}
      <article className="rk-card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Inventory at a glance
        </h2>
        {components.length === 0 ? (
          <p className="text-sm text-slate-500">
            No inventory yet — record a donation to build stock.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 text-left">Group</th>
                    {components.map((comp) => (
                      <th key={comp} className="px-3 py-2 text-center">
                        {comp}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {GRID_GROUPS.map((g) => (
                    <tr key={g}>
                      <td className="px-3 py-2 font-semibold text-rk-700">{g}</td>
                      {components.map((comp) => {
                        const cell = cellFor(g, comp);
                        const avail = cell?.available ?? 0;
                        return (
                          <td key={comp} className="px-3 py-2 text-center">
                            <span
                              className={
                                avail > 0 ? 'font-semibold text-slate-900' : 'text-slate-300'
                              }
                            >
                              {avail}
                            </span>
                            {cell && cell.total > avail ? (
                              <span className="text-xs text-slate-400"> /{cell.total}</span>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Cell = available units · /n = total bags incl. quarantine.
            </p>
          </>
        )}
      </article>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Incoming requests */}
        <article className="rk-card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Incoming requests · your district
          </h2>
          {(d.incoming_requests || []).length === 0 ? (
            <p className="text-sm text-slate-500">No open requests in your district.</p>
          ) : (
            <ul className="space-y-2">
              {d.incoming_requests.map((r) => {
                const u = URG[r.urgency_tier] || URG.PL;
                return (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${u.cls}`}>
                      {u.label}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">{r.request_number}</span>
                    <span className="font-medium text-slate-900">
                      {r.blood_group} · {r.component} · {r.units_required}u
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        {/* Recent donations */}
        <article className="rk-card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recent donations
          </h2>
          {(d.recent_donations || []).length === 0 ? (
            <p className="text-sm text-slate-500">No donations recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {d.recent_donations.map((dn) => (
                <li key={dn.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-900">{dn.donor_name}</span>
                  <span className="text-xs text-slate-500">
                    {dn.component} · {dn.volume_ml}ml · {fmtDate(dn.collection_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Inventory tab — bag list with expiry colour-coding
// ────────────────────────────────────────────────────────────────────────────
function expiryClass(expiry) {
  if (!expiry) return 'bg-slate-100 text-slate-600';
  const days = Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000);
  if (days < 2) return 'bg-rk-700 text-white';        // < 48h
  if (days <= 7) return 'bg-amber-500 text-white';    // 2–7d
  return 'bg-green-100 text-green-800';               // > 7d
}

function InventoryView() {
  const [statusFilter, setStatusFilter] = useState('');
  const inventoryQ = useQuery({
    queryKey: ['inventory', statusFilter],
    queryFn: () =>
      apiRequest('GET', `/inventory${statusFilter ? `?status=${statusFilter}` : ''}`),
    staleTime: 10_000,
  });
  const bags = inventoryQ.data?.bags || [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Inventory</h1>
        <select
          aria-label="status filter"
          className="rk-input max-w-[12rem]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="QA">QA — quarantine</option>
          <option value="AV">AV — available</option>
          <option value="RE">RE — reserved</option>
          <option value="IS">IS — issued</option>
          <option value="TR">TR — transfused</option>
          <option value="EX">EX — expired</option>
          <option value="RC">RC — recalled</option>
        </select>
      </div>

      {inventoryQ.isLoading ? (
        <div className="rk-card text-center text-slate-500">…</div>
      ) : bags.length === 0 ? (
        <div className="rk-card text-sm text-slate-500">
          No bags{statusFilter ? ` in status ${statusFilter}` : ''}.
        </div>
      ) : (
        <div className="rk-card overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">ISBT</th>
                <th className="px-3 py-2 text-left">Group</th>
                <th className="px-3 py-2 text-left">Component</th>
                <th className="px-3 py-2 text-right">Volume</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bags.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2 font-mono text-xs">{b.isbt_barcode}</td>
                  <td className="px-3 py-2 font-semibold">{b.blood_group_code || '—'}</td>
                  <td className="px-3 py-2">{b.component_code || '—'}</td>
                  <td className="px-3 py-2 text-right">{b.volume_ml ?? '—'} ml</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {b.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-xs font-medium ' + expiryClass(b.expiry_date)
                      }
                    >
                      {b.expiry_date || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Record donation tab
// ────────────────────────────────────────────────────────────────────────────
const COMPONENTS = [
  { id: 1, code: 'WB', name: 'Whole Blood' },
  { id: 2, code: 'RBC', name: 'Red Cells' },
  { id: 3, code: 'FFP', name: 'Fresh Frozen Plasma' },
  { id: 4, code: 'PLT', name: 'Platelets' },
  { id: 5, code: 'CRY', name: 'Cryoprecipitate' },
  { id: 6, code: 'SDP', name: 'Single-Donor Platelet' },
];

const blankDonation = {
  donor_id: '',
  collection_date: new Date().toISOString().slice(0, 10),
  collection_time: '',
  component_id: 1,
  volume_ml: 350,
  hb_gdl: 13.5,
  hb_method: 'CS',
  pulse_bpm: '',
  bp_systolic: '',
  bp_diastolic: '',
  weight_kg: '',
  isbt_barcode: '',
  notes: '',
};

function RecordDonation() {
  const qc = useQueryClient();
  const [form, setForm] = useState(blankDonation);
  const [result, setResult] = useState(null);
  const [mobileQuery, setMobileQuery] = useState('');
  const [donorPreview, setDonorPreview] = useState(null);
  const [lookupError, setLookupError] = useState('');
  const [validationErrors, setValidationErrors] = useState(null);

  const lookup = useMutation({
    mutationFn: (mobile) =>
      apiRequest('GET', `/donors/lookup?mobile=${encodeURIComponent(mobile)}`),
    onSuccess: (data) => {
      setDonorPreview(data);
      setForm((prev) => ({ ...prev, donor_id: data.donor_id }));
      setLookupError('');
    },
    onError: (err) => {
      setDonorPreview(null);
      setLookupError(err?.response?.data?.error || 'lookup_failed');
    },
  });

  const create = useMutation({
    mutationFn: (payload) => apiRequest('POST', '/donations', payload),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  function update(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function clearDonor() {
    setDonorPreview(null);
    setMobileQuery('');
    setForm((prev) => ({ ...prev, donor_id: '' }));
  }

  function submit(e) {
    e.preventDefault();
    setResult(null);
    setValidationErrors(null);
    const candidate = {
      donor_id: form.donor_id.trim(),
      collection_date: form.collection_date,
      ...(form.collection_time ? { collection_time: form.collection_time } : {}),
      component_id: Number(form.component_id),
      volume_ml: Number(form.volume_ml),
      hb_gdl: Number(form.hb_gdl),
      hb_method: form.hb_method,
      ...(form.pulse_bpm ? { pulse_bpm: Number(form.pulse_bpm) } : {}),
      ...(form.bp_systolic ? { bp_systolic: Number(form.bp_systolic) } : {}),
      ...(form.bp_diastolic ? { bp_diastolic: Number(form.bp_diastolic) } : {}),
      ...(form.weight_kg ? { weight_kg: Number(form.weight_kg) } : {}),
      isbt_barcode: form.isbt_barcode.trim(),
      ...(form.notes ? { notes: form.notes } : {}),
    };
    const parsed = donationSchema.safeParse(candidate);
    if (!parsed.success) {
      setValidationErrors(zodFlatten(parsed.error));
      return;
    }
    create.mutate(parsed.data);
  }

  const error = create.error?.response?.data;

  return (
    <section className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-900">Record donation</h1>

      {result ? (
        <div className="rk-card border-l-4 border-green-500">
          <div className="font-mono text-xs text-slate-700">{result.donation_id}</div>
          <div className="font-semibold text-green-800">Donation recorded</div>
          <div className="text-sm text-slate-600">
            ISBT {result.isbt_barcode} · bag status {result.inventory_bag?.status || 'pending'}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Move to the TTI screening tab to enter the test panel — the bag stays in QA until
            screening is verified.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rk-button-secondary"
              onClick={() => {
                setResult(null);
                setForm(blankDonation);
                clearDonor();
              }}
            >
              Record another
            </button>
          </div>
        </div>
      ) : null}

      <form className="rk-card grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div className="sm:col-span-2 space-y-2">
          <label className="rk-label" htmlFor="donor-mobile">
            Donor mobile lookup
          </label>
          <div className="flex gap-2">
            <input
              id="donor-mobile"
              inputMode="tel"
              className="rk-input flex-1"
              placeholder="+91 9XXXXXXXXX"
              value={mobileQuery}
              onChange={(e) => setMobileQuery(e.target.value)}
              disabled={Boolean(donorPreview)}
            />
            {donorPreview ? (
              <button type="button" className="rk-button-secondary" onClick={clearDonor}>
                Clear
              </button>
            ) : (
              <button
                type="button"
                className="rk-button-primary"
                onClick={() => lookup.mutate(mobileQuery.trim())}
                disabled={lookup.isPending || mobileQuery.trim().length < 10}
              >
                {lookup.isPending ? '…' : 'Look up'}
              </button>
            )}
          </div>
          {lookupError ? <p className="text-sm text-rk-700">{lookupError}</p> : null}
          {donorPreview ? (
            <div className="rounded-md bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
              <div className="font-semibold text-slate-900">{donorPreview.full_name}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-rk-50 px-2 py-0.5 font-medium text-rk-700">
                  {donorPreview.blood_group_verified
                    ? `Verified ${donorPreview.blood_group_verified_code}`
                    : donorPreview.blood_group_self_reported_code
                      ? `Self ${donorPreview.blood_group_self_reported_code} (unverified)`
                      : 'No blood group'}
                </span>
                <span
                  className={
                    'rounded-full px-2 py-0.5 font-medium ' +
                    (donorPreview.deferral_status === 'P' || donorPreview.deferral_status === 'T'
                      ? 'bg-rk-700 text-white'
                      : 'bg-green-100 text-green-800')
                  }
                >
                  Deferral: {donorPreview.deferral_status || 'N'}
                </span>
                {donorPreview.next_eligible_date ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                    Next eligible: {donorPreview.next_eligible_date}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 font-mono text-[10px] text-slate-500">
                id {donorPreview.donor_id}
              </div>
              {!donorPreview.blood_group_verified ? (
                <p className="mt-1 text-xs text-amber-800">
                  Donor has no verified blood group — POST /donations will fail. Verify via{' '}
                  <code>POST /donors/:id/blood-group/verify</code> first.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <Field label="Collection date" htmlFor="cd">
          <input
            id="cd"
            type="date"
            className="rk-input"
            value={form.collection_date}
            onChange={(e) => update('collection_date', e.target.value)}
            required
          />
        </Field>
        <Field label="Time (optional)" htmlFor="ct">
          <input
            id="ct"
            type="time"
            className="rk-input"
            value={form.collection_time}
            onChange={(e) => update('collection_time', e.target.value)}
          />
        </Field>

        <Field label="Component" htmlFor="comp">
          <select
            id="comp"
            className="rk-input"
            value={form.component_id}
            onChange={(e) => update('component_id', e.target.value)}
          >
            {COMPONENTS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Volume (ml)" htmlFor="vol">
          <input
            id="vol"
            type="number"
            min={50}
            max={500}
            className="rk-input"
            value={form.volume_ml}
            onChange={(e) => update('volume_ml', e.target.value)}
            required
          />
        </Field>

        <Field label="Hb (g/dL)" htmlFor="hb">
          <input
            id="hb"
            type="number"
            step="0.1"
            min={5}
            max={25}
            className="rk-input"
            value={form.hb_gdl}
            onChange={(e) => update('hb_gdl', e.target.value)}
          />
        </Field>
        <Field label="Hb method" htmlFor="hbm">
          <select
            id="hbm"
            className="rk-input"
            value={form.hb_method}
            onChange={(e) => update('hb_method', e.target.value)}
          >
            <option value="CS">CS — copper sulphate</option>
            <option value="HC">HC — HemoCue</option>
            <option value="LB">LB — lab analyser</option>
          </select>
        </Field>

        <Field label="Pulse" htmlFor="pulse">
          <input
            id="pulse"
            type="number"
            className="rk-input"
            value={form.pulse_bpm}
            onChange={(e) => update('pulse_bpm', e.target.value)}
          />
        </Field>
        <Field label="Weight (kg)" htmlFor="wt">
          <input
            id="wt"
            type="number"
            step="0.1"
            className="rk-input"
            value={form.weight_kg}
            onChange={(e) => update('weight_kg', e.target.value)}
          />
        </Field>

        <Field label="BP systolic" htmlFor="sys">
          <input
            id="sys"
            type="number"
            className="rk-input"
            value={form.bp_systolic}
            onChange={(e) => update('bp_systolic', e.target.value)}
          />
        </Field>
        <Field label="BP diastolic" htmlFor="dia">
          <input
            id="dia"
            type="number"
            className="rk-input"
            value={form.bp_diastolic}
            onChange={(e) => update('bp_diastolic', e.target.value)}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="ISBT barcode" htmlFor="isbt">
            <input
              id="isbt"
              className="rk-input font-mono"
              value={form.isbt_barcode}
              onChange={(e) => update('isbt_barcode', e.target.value)}
              required
              minLength={4}
              maxLength={64}
            />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Notes" htmlFor="notes">
            <textarea
              id="notes"
              rows={2}
              className="rk-input"
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
            />
          </Field>
        </div>

        <div className="sm:col-span-2 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            DB triggers create the QA bag automatically — TTI screening unlocks it for AV.
          </div>
          <button type="submit" className="rk-button-primary" disabled={create.isPending}>
            {create.isPending ? '…' : 'Record donation'}
          </button>
        </div>

        {validationErrors ? (
          <ul className="sm:col-span-2 rounded-md bg-rk-50 p-3 text-sm text-rk-900 ring-1 ring-rk-100">
            {Object.entries(validationErrors).map(([field, msg]) => (
              <li key={field}>
                <code className="font-mono text-xs">{field}</code>: {msg}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="sm:col-span-2 text-sm text-rk-700">
            {error.error}
            {error.detail ? ` — ${JSON.stringify(error.detail)}` : ''}
          </p>
        ) : null}
      </form>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TTI screening tab
// ────────────────────────────────────────────────────────────────────────────
const TTI_FIELDS = [
  { id: 'hiv_status', label: 'HIV' },
  { id: 'hbsag_status', label: 'HBsAg' },
  { id: 'hcv_status', label: 'HCV' },
  { id: 'syphilis_status', label: 'Syphilis' },
  { id: 'malaria_status', label: 'Malaria' },
];
const TTI_RESULTS = [
  { code: 'PE', label: 'Pending' },
  { code: 'NR', label: 'Non-reactive' },
  { code: 'RR', label: 'Reactive' },
  { code: 'ID', label: 'Indeterminate' },
];

const blankScreening = TTI_FIELDS.reduce(
  (acc, f) => ({ ...acc, [f.id]: 'PE' }),
  { notes: '' },
);

function ScreeningEntry() {
  const qc = useQueryClient();
  const [donationId, setDonationId] = useState('');
  const [activeId, setActiveId] = useState(''); // committed lookup
  const [tti, setTti] = useState(blankScreening);
  const [postedSummary, setPostedSummary] = useState(null);

  const detailQ = useQuery({
    enabled: Boolean(activeId),
    queryKey: ['donation', activeId],
    queryFn: () => apiRequest('GET', `/donations/${activeId}`),
    staleTime: 5_000,
  });
  const donation = detailQ.data;

  const submitScreening = useMutation({
    mutationFn: () => apiRequest('POST', `/donations/${activeId}/screening`, tti),
    onSuccess: (data) => {
      setPostedSummary(data);
      qc.invalidateQueries({ queryKey: ['donation', activeId] });
    },
  });

  const verifyScreening = useMutation({
    mutationFn: () => apiRequest('POST', `/donations/${activeId}/screening/verify`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['donation', activeId] }),
  });

  const screeningExists = Boolean(donation?.screening_id);
  const verified = Boolean(donation?.verified_at);
  const verificationRequired = donation?.verification_required;

  return (
    <section className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-900">TTI screening</h1>

      <div className="rk-card flex gap-2">
        <input
          className="rk-input flex-1 font-mono text-xs"
          placeholder="Donation ID (UUID)"
          value={donationId}
          onChange={(e) => setDonationId(e.target.value)}
        />
        <button
          type="button"
          className="rk-button-primary"
          onClick={() => {
            setActiveId(donationId.trim());
            setPostedSummary(null);
            setTti(blankScreening);
          }}
        >
          Open
        </button>
      </div>

      {detailQ.isLoading ? (
        <div className="rk-card text-center text-slate-500">…</div>
      ) : null}
      {detailQ.error ? (
        <div className="rk-card text-rk-700">
          {detailQ.error?.response?.data?.error || 'load_failed'}
        </div>
      ) : null}

      {donation ? (
        <article className="rk-card space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Component</div>
              <div className="font-medium">{donation.component_code || '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">ISBT</div>
              <div className="font-mono text-xs">{donation.isbt_barcode || '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Bag status</div>
              <div className="font-medium">{donation.bag_status || '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Clearance</div>
              <div className="font-medium">{donation.overall_clearance || 'PE'}</div>
            </div>
          </div>

          {!screeningExists ? (
            <ScreeningForm
              tti={tti}
              setTti={setTti}
              onSubmit={() => submitScreening.mutate()}
              busy={submitScreening.isPending}
              error={submitScreening.error?.response?.data?.error}
              postedSummary={postedSummary}
            />
          ) : (
            <div className="space-y-2">
              <div className="rounded-md bg-slate-50 p-3 text-sm">
                Screening recorded by user{' '}
                <span className="font-mono text-xs">{donation.entered_by}</span>.
              </div>
              {verificationRequired && !verified ? (
                <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                  <p className="font-semibold">4-eyes verification required</p>
                  <p className="text-xs">
                    A second blood-bank user (different from the entry author) must verify before
                    the bag clears or recalls.
                  </p>
                  <button
                    type="button"
                    className="rk-button-primary mt-2"
                    onClick={() => verifyScreening.mutate()}
                    disabled={verifyScreening.isPending}
                  >
                    {verifyScreening.isPending ? '…' : 'Verify screening'}
                  </button>
                  {verifyScreening.error ? (
                    <p className="mt-1 text-xs text-rk-700">
                      {verifyScreening.error?.response?.data?.error}
                    </p>
                  ) : null}
                </div>
              ) : verified ? (
                <div className="rounded-md bg-green-50 p-3 text-sm text-green-900 ring-1 ring-green-200">
                  Verified at {donation.verified_at}.
                </div>
              ) : null}
            </div>
          )}
        </article>
      ) : null}
    </section>
  );
}

function ScreeningForm({ tti, setTti, onSubmit, busy, error, postedSummary }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Enter the test panel. Any RR (reactive) result will require 4-eyes supervisor verification before the system acts (deferral, recall, lookback).</p>
      <div className="space-y-2">
        {TTI_FIELDS.map((f) => (
          <details key={f.id} className="rounded-md border border-slate-200">
            <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm">
              <span className="font-medium">{f.label}</span>
              <span
                className={
                  'rounded-full px-2 py-0.5 text-xs font-medium ' +
                  (tti[f.id] === 'RR'
                    ? 'bg-rk-700 text-white'
                    : tti[f.id] === 'NR'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-slate-100 text-slate-700')
                }
              >
                {tti[f.id]}
              </span>
            </summary>
            <div className="flex gap-2 px-3 py-2">
              {TTI_RESULTS.map((r) => (
                <button
                  type="button"
                  key={r.code}
                  className={
                    'rounded-full border px-3 py-1 text-xs font-medium ' +
                    (tti[f.id] === r.code
                      ? 'border-rk-700 bg-rk-50 text-rk-900'
                      : 'border-slate-300 bg-white text-slate-700')
                  }
                  onClick={() => setTti((prev) => ({ ...prev, [f.id]: r.code }))}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
      <div>
        <label className="rk-label" htmlFor="screening-notes">
          Notes
        </label>
        <textarea
          id="screening-notes"
          rows={2}
          className="rk-input"
          value={tti.notes}
          onChange={(e) => setTti((prev) => ({ ...prev, notes: e.target.value }))}
        />
      </div>
      <button type="button" className="rk-button-primary" onClick={onSubmit} disabled={busy}>
        {busy ? '…' : 'Submit screening'}
      </button>
      {error ? <p className="text-sm text-rk-700">{error}</p> : null}
      {postedSummary ? (
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          Submitted. overall_clearance =
          <span className="ml-1 font-mono">{postedSummary.overall_clearance}</span>
          {postedSummary.verification_required ? ' · 4-eyes required' : ''}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, htmlFor, children }) {
  return (
    <div>
      <label className="rk-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Opening-stock tab — one-time legacy stock entry at BB onboarding (spec §7).
// Backend POST /inventory/opening-stock accepts a single collection_date and
// an array of {blood_group_id, component_id, units, volume_ml_each} rows.
// ────────────────────────────────────────────────────────────────────────────
const OS_BLOOD_GROUPS = [
  { id: 1, code: 'A+' },
  { id: 2, code: 'A-' },
  { id: 3, code: 'B+' },
  { id: 4, code: 'B-' },
  { id: 5, code: 'AB+' },
  { id: 6, code: 'AB-' },
  { id: 7, code: 'O+' },
  { id: 8, code: 'O-' },
];

const blankBag = { blood_group_id: 7, component_id: 2, units: 1, volume_ml_each: 280 };

function OpeningStock() {
  const qc = useQueryClient();
  const [collectionDate, setCollectionDate] = useState(new Date().toISOString().slice(0, 10));
  const [bags, setBags] = useState([{ ...blankBag }]);
  const [result, setResult] = useState(null);
  const [validationErrors, setValidationErrors] = useState(null);

  const submit = useMutation({
    mutationFn: (payload) => apiRequest('POST', '/inventory/opening-stock', payload),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  function trySubmit() {
    setValidationErrors(null);
    const candidate = {
      collection_date: collectionDate,
      bags: bags.map((b) => ({
        blood_group_id: Number(b.blood_group_id),
        component_id: Number(b.component_id),
        units: Number(b.units),
        volume_ml_each: Number(b.volume_ml_each),
      })),
    };
    const parsed = openingStockSchema.safeParse(candidate);
    if (!parsed.success) {
      setValidationErrors(zodFlatten(parsed.error));
      return;
    }
    submit.mutate(parsed.data);
  }

  function updateBag(idx, k, v) {
    setBags((prev) => prev.map((b, i) => (i === idx ? { ...b, [k]: v } : b)));
  }
  function addBag() {
    setBags((prev) => (prev.length >= 50 ? prev : [...prev, { ...blankBag }]));
  }
  function removeBag(idx) {
    setBags((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  const totalUnits = bags.reduce((sum, b) => sum + (Number(b.units) || 0), 0);

  return (
    <section className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-900">Opening stock</h1>
      <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
        One-time entry at onboarding. Bags created here are tagged{' '}
        <code>source='WB'</code> (legacy) and skip TTI gating per spec §6 — they're labelled
        <em> "no TTI record"</em> for matching. Use only for stock that pre-dates platform onboarding.
      </p>

      {result ? (
        <div className="rk-card border-l-4 border-green-500">
          <div className="font-semibold text-green-800">
            {result.bags_created ?? totalUnits} bags created
          </div>
          {result.skipped_reasons ? (
            <p className="text-sm text-slate-600">
              Skipped: {JSON.stringify(result.skipped_reasons)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rk-card space-y-4">
        <div>
          <label className="rk-label" htmlFor="os-date">
            Collection date (legacy bags share one date)
          </label>
          <input
            id="os-date"
            type="date"
            className="rk-input max-w-[14rem]"
            value={collectionDate}
            onChange={(e) => setCollectionDate(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Group</th>
                <th className="px-2 py-2 text-left">Component</th>
                <th className="px-2 py-2 text-right">Units</th>
                <th className="px-2 py-2 text-right">Vol (ml/bag)</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bags.map((b, i) => (
                <tr key={i}>
                  <td className="px-2 py-1">
                    <select
                      aria-label="blood group"
                      className="rk-input"
                      value={b.blood_group_id}
                      onChange={(e) => updateBag(i, 'blood_group_id', e.target.value)}
                    >
                      {OS_BLOOD_GROUPS.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <select
                      aria-label="component"
                      className="rk-input"
                      value={b.component_id}
                      onChange={(e) => updateBag(i, 'component_id', e.target.value)}
                    >
                      {COMPONENTS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      aria-label="units"
                      className="rk-input text-right"
                      value={b.units}
                      onChange={(e) => updateBag(i, 'units', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      min={50}
                      max={500}
                      aria-label="volume per bag"
                      className="rk-input text-right"
                      value={b.volume_ml_each}
                      onChange={(e) => updateBag(i, 'volume_ml_each', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      className="text-xs text-rk-700 hover:underline disabled:opacity-30"
                      onClick={() => removeBag(i)}
                      disabled={bags.length <= 1}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="rk-button-secondary"
            onClick={addBag}
            disabled={bags.length >= 50}
          >
            + Add row
          </button>
          <div className="text-sm text-slate-600">
            Total: <strong>{totalUnits}</strong> units across {bags.length} groups
          </div>
        </div>

        <button
          type="button"
          className="rk-button-primary w-full"
          onClick={trySubmit}
          disabled={submit.isPending || bags.length === 0 || totalUnits === 0}
        >
          {submit.isPending ? '…' : 'Submit opening stock'}
        </button>

        {validationErrors ? (
          <ul className="rounded-md bg-rk-50 p-3 text-sm text-rk-900 ring-1 ring-rk-100">
            {Object.entries(validationErrors).map(([field, msg]) => (
              <li key={field}>
                <code className="font-mono text-xs">{field}</code>: {msg}
              </li>
            ))}
          </ul>
        ) : null}

        {submit.error ? (
          <p className="text-sm text-rk-700">
            {submit.error?.response?.data?.error || 'submit_failed'}
          </p>
        ) : null}
      </div>
    </section>
  );
}
