import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { apiRequest } from '../../lib/api.js';

const GRID_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const STATUS = {
  CL: { label: 'Fulfilled', cls: 'bg-green-100 text-green-800' },
  FU: { label: 'Fulfilled (await crossmatch)', cls: 'bg-green-100 text-green-800' },
  EX: { label: 'Expired', cls: 'bg-rk-700 text-white' },
  CA: { label: 'Cancelled', cls: 'bg-slate-200 text-slate-700' },
  OP: { label: 'Open', cls: 'bg-amber-100 text-amber-800' },
  MT: { label: 'Matching', cls: 'bg-amber-100 text-amber-800' },
  AS: { label: 'Assigned', cls: 'bg-sky-100 text-sky-800' },
  PF: { label: 'Partly fulfilled', cls: 'bg-sky-100 text-sky-800' },
};

const GRADE = {
  A: { label: 'A', cls: 'bg-green-100 text-green-800' },
  B: { label: 'B', cls: 'bg-amber-100 text-amber-800' },
  C: { label: 'C', cls: 'bg-amber-100 text-amber-800' },
  F: { label: 'Flag', cls: 'bg-rk-700 text-white' },
};

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return String(v);
  }
}

function fmtDateTime(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(v);
  }
}

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} m`;
}

function KpiCard({ label, value, sub, tone }) {
  return (
    <div className="rk-card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={'mt-1 text-2xl font-bold sm:text-3xl ' + (tone || 'text-slate-900')}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

export function DhoDashboard() {
  const [windowDays, setWindowDays] = useState(30);
  const qs = `?window_days=${windowDays}`;

  const [dashQ, complianceQ, shortagesQ, criticalQ, hemoQ] = useQueries({
    queries: [
      { queryKey: ['dho', 'dashboard', windowDays], queryFn: () => apiRequest('GET', `/dho/dashboard${qs}`), staleTime: 30_000 },
      { queryKey: ['dho', 'compliance', windowDays], queryFn: () => apiRequest('GET', `/dho/compliance${qs}`), staleTime: 30_000 },
      { queryKey: ['dho', 'shortages'], queryFn: () => apiRequest('GET', '/dho/shortages'), staleTime: 30_000 },
      { queryKey: ['dho', 'critical', windowDays], queryFn: () => apiRequest('GET', `/dho/critical-timeline${qs}`), staleTime: 30_000 },
      { queryKey: ['dho', 'hemo', windowDays], queryFn: () => apiRequest('GET', `/dho/hemovigilance${qs}`), staleTime: 30_000 },
    ],
  });

  const dash = dashQ.data;
  const compliance = complianceQ.data?.institutions || [];
  const shortages = shortagesQ.data?.shortages || [];
  const criticals = criticalQ.data?.critical_requests || [];
  const hemo = hemoQ.data;

  const components = useMemo(() => {
    const s = new Set(shortages.map((r) => r.component));
    return [...s].sort();
  }, [shortages]);
  const cellFor = (g, c) => shortages.find((r) => r.blood_group === g && r.component === c);

  if (dashQ.isLoading) {
    return (
      <Shell>
        <div className="rk-card text-center text-slate-500">Loading district overview…</div>
      </Shell>
    );
  }

  if (dashQ.error) {
    return (
      <Shell>
        <div className="rk-card text-rk-700">
          {dashQ.error?.response?.data?.error || 'load_failed'}
        </div>
      </Shell>
    );
  }

  const k = dash?.kpis || {};
  const districtName = dash?.district?.name || `District ${dash?.district?.id || ''}`;

  return (
    <Shell>
      {/* ── Top band — district + period ──────────────────────────── */}
      <header className="rk-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-rk-700">District Health Office</div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
            {districtName} · Raktify governance dashboard
          </h1>
          <p className="text-xs text-slate-500">
            Aggregate, read-only view for hemovigilance, compliance &amp; emergency response oversight.
            District-scoped — never includes donor or patient personally-identifying information.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="window" className="text-xs text-slate-500">
            Window
          </label>
          <select
            id="window"
            className="rk-input max-w-[8rem]"
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last year</option>
          </select>
          <Link
            to="/admin/reports"
            className="rk-button-secondary text-xs"
            title="Open the multi-month reports viewer"
          >
            Reports →
          </Link>
        </div>
      </header>

      {/* ── KPI cards ────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Donations"
          value={k.donations ?? 0}
          sub="collected this window"
          tone="text-rk-700"
        />
        <KpiCard
          label="Requests raised"
          value={k.requests_raised ?? 0}
          sub={`${k.requests_fulfilled ?? 0} fulfilled · ${k.requests_expired ?? 0} expired`}
        />
        <KpiCard
          label="Critical < 4 h"
          value={k.critical_within_4h_pct == null ? '—' : `${k.critical_within_4h_pct}%`}
          sub={
            k.critical_raised
              ? `${k.critical_within_4h}/${k.critical_raised} CR requests`
              : 'no critical requests'
          }
          tone={
            k.critical_within_4h_pct == null
              ? 'text-slate-900'
              : k.critical_within_4h_pct >= 80
                ? 'text-green-700'
                : k.critical_within_4h_pct >= 50
                  ? 'text-amber-600'
                  : 'text-rk-700'
          }
        />
        <KpiCard
          label="Lives saved estimate"
          value={k.lives_saved_estimate ?? 0}
          sub="3 lives per donated unit"
          tone="text-rk-700"
        />
        <KpiCard
          label="Wastage rate"
          value={k.wastage_rate_pct == null ? '—' : `${k.wastage_rate_pct}%`}
          sub={`${k.bags_used ?? 0} used · ${k.bags_expired ?? 0} expired`}
          tone={
            k.wastage_rate_pct == null
              ? 'text-slate-900'
              : k.wastage_rate_pct <= 5
                ? 'text-green-700'
                : k.wastage_rate_pct <= 15
                  ? 'text-amber-600'
                  : 'text-rk-700'
          }
        />
        <KpiCard
          label="Active institutions"
          value={(k.active_hospitals ?? 0) + (k.active_blood_banks ?? 0)}
          sub={`${k.active_hospitals ?? 0} hosp · ${k.active_blood_banks ?? 0} BB · ${k.pending_applications ?? 0} pending`}
        />
      </section>

      {/* ── Camps ─────────────────────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-3">
        <KpiCard label="Camps held" value={k.camps_held ?? 0} sub="this window" />
        <KpiCard label="Upcoming camps" value={k.camps_upcoming ?? 0} />
        <KpiCard label="Units from camps" value={k.units_from_camps ?? 0} />
      </section>

      {/* ── Compliance matrix ────────────────────────────────────── */}
      <article className="rk-card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Institutional compliance
            </h2>
            <p className="text-xs text-slate-400">
              Per-institution operational health on the platform. Grade is computed from
              licence validity, 4-eyes verification rate, and activity.
            </p>
          </div>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Institution</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Last donation</th>
              <th className="px-3 py-2 text-right">Donations ({windowDays}d)</th>
              <th className="px-3 py-2 text-right">4-eyes %</th>
              <th className="px-3 py-2 text-right">Requests ({windowDays}d)</th>
              <th className="px-3 py-2 text-left">Licence expiry</th>
              <th className="px-3 py-2 text-left">Grade</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {compliance.map((r) => {
              const g = GRADE[r.compliance_grade] || GRADE.A;
              const fourEyesPct =
                r.kind === 'BB' && r.screenings_completed > 0
                  ? Math.round((100 * r.screenings_4eyes_verified) / r.screenings_completed)
                  : null;
              return (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{r.display_name}</div>
                    <div className="text-[10px] text-slate-400">@{r.shortname}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{r.kind === 'BB' ? 'Blood bank' : 'Hospital'}</td>
                  <td className="px-3 py-2 text-slate-700">{fmtDate(r.last_donation)}</td>
                  <td className="px-3 py-2 text-right">
                    {r.kind === 'BB' ? r.donations_recent : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fourEyesPct == null ? '—' : `${fourEyesPct}%`}
                  </td>
                  <td className="px-3 py-2 text-right">{r.requests_recent}</td>
                  <td className="px-3 py-2 text-slate-700">{fmtDate(r.cdsco_licence_expires)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${g.cls}`}
                      title={r.compliance_reasons?.join(' · ')}
                    >
                      {g.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {compliance.length === 0 && !complianceQ.isLoading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                  No active institutions in this district yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </article>

      {/* ── Shortage heatmap ─────────────────────────────────────── */}
      <article className="rk-card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Live blood availability in {districtName}
        </h2>
        {components.length === 0 ? (
          <p className="text-sm text-slate-500">
            No usable units in district inventory right now. Camps + active matching will fill this in.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">Group</th>
                  {components.map((c) => (
                    <th key={c} className="px-3 py-2 text-center">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {GRID_GROUPS.map((g) => (
                  <tr key={g}>
                    <td className="px-3 py-2 font-semibold text-rk-700">{g}</td>
                    {components.map((c) => {
                      const cell = cellFor(g, c);
                      const avail = cell?.available ?? 0;
                      const expiring = cell?.expiring_48h ?? 0;
                      const tone =
                        avail === 0
                          ? 'text-rk-700'
                          : avail < 3
                            ? 'text-amber-600'
                            : 'text-slate-900';
                      return (
                        <td key={c} className="px-3 py-2 text-center">
                          <span className={'font-semibold ' + tone}>{avail}</span>
                          {expiring ? (
                            <span className="ml-1 text-[10px] text-amber-600">↘{expiring}</span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-400">
              Numbers are district-wide totals. <span className="text-amber-600">↘N</span> indicates units expiring within 48 hours.
            </p>
          </div>
        )}
      </article>

      {/* ── Critical request timeline ────────────────────────────── */}
      <article className="rk-card overflow-x-auto p-0">
        <div className="px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Critical requests · last {windowDays} days
          </h2>
          <p className="text-xs text-slate-400">
            Every Critical-tier emergency raised in this district. Use this to validate that the platform is responding within target time.
          </p>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Request #</th>
              <th className="px-3 py-2 text-left">Hospital</th>
              <th className="px-3 py-2 text-left">Group · Comp</th>
              <th className="px-3 py-2 text-right">Units</th>
              <th className="px-3 py-2 text-left">Raised</th>
              <th className="px-3 py-2 text-left">Fulfilment</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {criticals.map((r) => {
              const s = STATUS[r.status] || STATUS.OP;
              const tone =
                r.fulfilment_seconds == null
                  ? 'text-slate-500'
                  : r.fulfilment_seconds < 14400
                    ? 'font-semibold text-green-700'
                    : r.fulfilment_seconds < 28800
                      ? 'font-semibold text-amber-600'
                      : 'font-semibold text-rk-700';
              return (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{r.request_number}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {r.requesting_hospital_name || 'Guest hospital'}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    <span className="font-semibold text-rk-700">{r.blood_group}</span> · {r.component}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.units_fulfilled}/{r.units_required}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{fmtDateTime(r.raised_at)}</td>
                  <td className={`px-3 py-2 ${tone}`}>{fmtDuration(r.fulfilment_seconds)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                      {s.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {criticals.length === 0 && !criticalQ.isLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                  No critical-tier requests in this window.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </article>

      {/* ── Hemovigilance summary ────────────────────────────────── */}
      <article className="rk-card">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Hemovigilance summary
            </h2>
            <p className="text-xs text-slate-400">
              For your monthly DGHS / State Blood Transfusion Council filing.
            </p>
          </div>
          <Link to="/admin/reports" className="text-xs font-medium text-rk-700 hover:underline">
            Download CSV for filing →
          </Link>
        </div>
        {hemo ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-stone-500">
                Lookback investigations
              </h3>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Opened</dt>
                <dd className="font-semibold text-slate-900">{hemo.lookback?.opened ?? 0}</dd>
                <dt className="text-slate-500">Closed</dt>
                <dd className="font-semibold text-green-700">{hemo.lookback?.closed ?? 0}</dd>
                <dt className="text-slate-500">Overdue (&gt; 14 days)</dt>
                <dd className={'font-semibold ' + ((hemo.lookback?.overdue ?? 0) > 0 ? 'text-rk-700' : 'text-slate-900')}>
                  {hemo.lookback?.overdue ?? 0}
                </dd>
                <dt className="text-slate-500">Avg resolution time</dt>
                <dd className="font-semibold text-slate-900">
                  {fmtDuration(hemo.lookback?.avg_resolution_seconds)}
                </dd>
              </dl>
            </div>
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-stone-500">
                Reactive TTI screenings
              </h3>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">HIV</dt>
                <dd className="font-semibold text-slate-900">{hemo.reactive_tti?.hiv ?? 0}</dd>
                <dt className="text-slate-500">HBsAg</dt>
                <dd className="font-semibold text-slate-900">{hemo.reactive_tti?.hbsag ?? 0}</dd>
                <dt className="text-slate-500">HCV</dt>
                <dd className="font-semibold text-slate-900">{hemo.reactive_tti?.hcv ?? 0}</dd>
                <dt className="text-slate-500">Syphilis</dt>
                <dd className="font-semibold text-slate-900">{hemo.reactive_tti?.syphilis ?? 0}</dd>
                <dt className="text-slate-500">Malaria</dt>
                <dd className="font-semibold text-slate-900">{hemo.reactive_tti?.malaria ?? 0}</dd>
                <dt className="text-slate-500">Cleared total</dt>
                <dd className="font-semibold text-green-700">{hemo.reactive_tti?.cleared_total ?? 0}</dd>
              </dl>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Loading hemovigilance data…</p>
        )}
      </article>

      {/* ── Footnote ─────────────────────────────────────────────── */}
      <p className="text-center text-xs text-slate-400">
        This dashboard contains aggregate data only. Donor names, patient identities and individual TTI test
        results are never visible from this view, as required by the DPDP Act 2023.
      </p>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="flex min-h-full flex-col bg-cream">
      <Header subtitle="DHO" />
      <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6">{children}</main>
      <Footer variant="compact" />
    </div>
  );
}
