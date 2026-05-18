import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';

export function AuditTab() {
  const [filter, setFilter] = useState({
    table_name: '',
    actor_user_id: '',
    event_type: '',
    since: '',
    until: '',
    limit: 100,
  });

  // Bound key changes whenever the user clicks "Apply" — until then the
  // query reuses the previous result. Keeps the API call out of every keypress.
  const [activeFilter, setActiveFilter] = useState({ ...filter });

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(activeFilter)) {
    if (v !== '' && v != null) params.set(k, String(v));
  }

  const auditQ = useQuery({
    queryKey: ['admin', 'audit', activeFilter],
    queryFn: () => apiRequest('GET', `/admin/audit?${params.toString()}`),
    staleTime: 0,
  });

  const integrityQ = useQuery({
    queryKey: ['admin', 'audit', 'integrity'],
    queryFn: () => apiRequest('GET', '/admin/audit/integrity?limit=200'),
    enabled: false, // run on demand via the button
  });

  function update(k, v) {
    setFilter((prev) => ({ ...prev, [k]: v }));
  }

  return (
    <section className="space-y-3">
      {/* Filter bar */}
      <div className="rk-card grid gap-3 sm:grid-cols-3">
        <Field label="Table">
          <input
            className="rk-input"
            value={filter.table_name}
            placeholder="e.g. donors"
            onChange={(e) => update('table_name', e.target.value)}
          />
        </Field>
        <Field label="Actor (UUID)">
          <input
            className="rk-input font-mono text-xs"
            value={filter.actor_user_id}
            onChange={(e) => update('actor_user_id', e.target.value)}
          />
        </Field>
        <Field label="Event">
          <select
            className="rk-input"
            value={filter.event_type}
            onChange={(e) => update('event_type', e.target.value)}
          >
            <option value="">Any</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </Field>
        <Field label="Since (UTC)">
          <input
            type="datetime-local"
            className="rk-input"
            value={filter.since}
            onChange={(e) => update('since', e.target.value ? `${e.target.value}:00.000Z` : '')}
          />
        </Field>
        <Field label="Until (UTC)">
          <input
            type="datetime-local"
            className="rk-input"
            value={filter.until}
            onChange={(e) => update('until', e.target.value ? `${e.target.value}:00.000Z` : '')}
          />
        </Field>
        <Field label="Limit">
          <input
            type="number"
            min={1}
            max={500}
            className="rk-input"
            value={filter.limit}
            onChange={(e) => update('limit', Number(e.target.value || 100))}
          />
        </Field>
        <div className="sm:col-span-3 flex justify-between gap-2">
          <button
            type="button"
            className="rk-button-primary"
            onClick={() => setActiveFilter({ ...filter })}
          >
            Apply
          </button>
          <button
            type="button"
            className="rk-button-secondary"
            onClick={() => integrityQ.refetch()}
            disabled={integrityQ.isFetching}
          >
            {integrityQ.isFetching ? 'Checking…' : 'Run hash-chain integrity check'}
          </button>
        </div>
        {integrityQ.data ? (
          <div
            className={
              'sm:col-span-3 rounded-md p-2 text-sm ' +
              (integrityQ.data.ok
                ? 'bg-green-50 text-green-900 ring-1 ring-green-200'
                : 'bg-rk-50 text-rk-900 ring-1 ring-rk-100')
            }
          >
            Sampled {integrityQ.data.sampled} rows · breaks: {integrityQ.data.breaks}{' '}
            {integrityQ.data.ok ? '· chain intact ✓' : '· investigate broken_examples'}
          </div>
        ) : null}
        {integrityQ.error ? (
          <div className="sm:col-span-3 rounded-md bg-rk-50 p-2 text-sm text-rk-900">
            {integrityQ.error?.response?.data?.error}:{' '}
            {integrityQ.error?.response?.data?.detail || integrityQ.error?.message}
          </div>
        ) : null}
      </div>

      {/* Result table */}
      <div className="rk-card overflow-x-auto p-0">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Table</th>
              <th className="px-3 py-2 text-left">Event</th>
              <th className="px-3 py-2 text-left">Actor</th>
              <th className="px-3 py-2 text-left">Field</th>
              <th className="px-3 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(auditQ.data?.rows || []).map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {new Date(r.event_time).toLocaleString()}
                </td>
                <td className="px-3 py-2 font-medium">{r.table_name}</td>
                <td className="px-3 py-2">{r.event_type}</td>
                <td className="px-3 py-2">
                  <div>{r.actor_role}</div>
                  <div className="font-mono text-[10px] text-slate-400">{r.actor_user_id}</div>
                </td>
                <td className="px-3 py-2">{r.field_name || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{r.change_reason || '—'}</td>
              </tr>
            ))}
            {auditQ.isLoading ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  …
                </td>
              </tr>
            ) : null}
            {auditQ.data && auditQ.data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No audit rows match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="rk-label">{label}</label>
      {children}
    </div>
  );
}
