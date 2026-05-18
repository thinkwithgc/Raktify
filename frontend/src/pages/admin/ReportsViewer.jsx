import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Header } from '../../components/Header.jsx';
import { apiRequest, tokenStore } from '../../lib/api.js';

// Phase 8 reports viewer. Three reports, common month picker. JSON view +
// "Download CSV" buttons that hit the same endpoint with ?format=csv.
//
// PDF generation (spec §10) is intentionally not wired client-side — the spec
// expects backend HTML-to-PDF (Puppeteer / wkhtmltopdf). The Download-PDF
// button is hidden until that's implemented; CSV is the DHO submission format
// in the meantime.

const REPORTS = [
  { id: 'district', label: 'District summary' },
  { id: 'hemovigilance', label: 'Hemovigilance' },
  { id: 'bb_performance', label: 'Blood-bank performance' },
];

function defaultMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function ReportsViewer() {
  const [tab, setTab] = useState('district');
  const [month, setMonth] = useState(defaultMonth());
  const [districtId, setDistrictId] = useState(1); // ngo_admin picks; coord auto-scopes
  const [bbId, setBbId] = useState('');

  const url =
    tab === 'district'
      ? `/reports/district/${districtId}/summary?month=${month}`
      : tab === 'hemovigilance'
        ? `/reports/hemovigilance?month=${month}`
        : tab === 'bb_performance' && bbId
          ? `/reports/blood-bank/${bbId}/performance?month=${month}`
          : null;

  const q = useQuery({
    enabled: Boolean(url),
    queryKey: ['report', url],
    queryFn: () => apiRequest('GET', url),
    staleTime: 30_000,
  });

  function downloadCsv() {
    if (!url) return;
    // CSV download is a separate fetch with Authorization header, then we
    // synthesise an <a> click. The axios interceptor would parse this as
    // text fine, but using fetch sidesteps content-type assumptions and
    // gives us the Blob directly.
    const csvUrl = `${url}${url.includes('?') ? '&' : '?'}format=csv`;
    fetch(csvUrl, {
      headers: tokenStore.token ? { Authorization: `Bearer ${tokenStore.token}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error(`csv_${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        a.href = objectUrl;
        a.download = `report-${tab}-${month}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      })
      // eslint-disable-next-line no-console
      .catch((err) => console.error('csv download failed', err));
  }

  return (
    <div className="min-h-full">
      <Header subtitle="Reports" />
      <main className="mx-auto max-w-5xl px-4 py-6 space-y-4">
        <Link to="/admin" className="text-sm font-medium text-rk-700 hover:underline">
          ← Back to dashboard
        </Link>
        <nav className="flex flex-wrap gap-2 border-b border-slate-200">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setTab(r.id)}
              className={
                'border-b-2 px-3 py-2 text-sm font-medium transition-colors ' +
                (tab === r.id
                  ? 'border-rk-700 text-rk-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800')
              }
            >
              {r.label}
            </button>
          ))}
        </nav>

        <section className="rk-card grid gap-3 sm:grid-cols-4">
          <div>
            <label className="rk-label" htmlFor="month">
              Month
            </label>
            <input
              id="month"
              type="month"
              className="rk-input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          {tab === 'district' ? (
            <div>
              <label className="rk-label" htmlFor="dist">
                District ID
              </label>
              <input
                id="dist"
                type="number"
                className="rk-input"
                value={districtId}
                onChange={(e) => setDistrictId(Number(e.target.value || 0))}
              />
            </div>
          ) : null}
          {tab === 'bb_performance' ? (
            <div className="sm:col-span-2">
              <label className="rk-label" htmlFor="bb">
                Blood bank ID (UUID)
              </label>
              <input
                id="bb"
                className="rk-input font-mono text-xs"
                value={bbId}
                onChange={(e) => setBbId(e.target.value)}
              />
            </div>
          ) : null}
          <div className="sm:col-span-1 flex items-end gap-2">
            <button
              type="button"
              className="rk-button-primary"
              onClick={() => q.refetch()}
              disabled={!url || q.isFetching}
            >
              {q.isFetching ? '…' : 'Refresh'}
            </button>
            <button
              type="button"
              className="rk-button-secondary"
              onClick={downloadCsv}
              disabled={!url}
            >
              CSV
            </button>
          </div>
        </section>

        {q.error ? (
          <div className="rk-card text-rk-700">
            {q.error?.response?.data?.error || 'load_failed'}
          </div>
        ) : null}

        {q.data ? <ReportRender data={q.data} kind={tab} /> : null}
      </main>
    </div>
  );
}

function ReportRender({ data, kind }) {
  if (kind === 'district') return <DistrictRender data={data} />;
  if (kind === 'hemovigilance') return <HemoRender data={data} />;
  if (kind === 'bb_performance') return <BbRender data={data} />;
  return null;
}

function StatBlock({ title, stats }) {
  return (
    <article className="rk-card">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {Object.entries(stats || {}).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right font-semibold text-slate-900">
              {v == null ? '—' : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function DistrictRender({ data }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatBlock title="Requests" stats={data.requests} />
        <StatBlock title="Donors" stats={data.donors} />
        <StatBlock title="Camps" stats={data.camps} />
        <StatBlock title="Wastage" stats={data.wastage} />
      </div>
      <article className="rk-card">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Shortages by blood group
        </h3>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="px-2 py-1">Group</th>
              <th className="px-2 py-1 text-right">Expired unfulfilled</th>
              <th className="px-2 py-1 text-right">Open critical</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data.shortages || []).map((s) => (
              <tr key={s.blood_group}>
                <td className="px-2 py-1 font-medium">{s.blood_group}</td>
                <td className="px-2 py-1 text-right">{s.expired_unfulfilled}</td>
                <td className="px-2 py-1 text-right">{s.open_critical}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  );
}

function HemoRender({ data }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatBlock title="Lookback cases" stats={data.lookback} />
        <StatBlock title="Reactive TTI" stats={data.reactive_tti} />
        <StatBlock title="Adverse reactions" stats={data.adverse_reactions} />
      </div>
      <article className="rk-card">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Donation source breakdown
        </h3>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="px-2 py-1">Source</th>
              <th className="px-2 py-1 text-right">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data.donation_source_breakdown || []).map((s) => (
              <tr key={s.source}>
                <td className="px-2 py-1 font-medium">{s.source}</td>
                <td className="px-2 py-1 text-right">{s.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  );
}

function BbRender({ data }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatBlock title="Inventory accuracy" stats={data.inventory_accuracy} />
      <StatBlock title="Fulfilment" stats={data.fulfilment} />
      <StatBlock title="TTI latency" stats={data.tti_latency} />
    </div>
  );
}
