// Shared request summary card for the case-detail pages (hospital, blood bank,
// community leader). Every field renders only when present, because the API
// deliberately returns a PII-masked column set to community_leader (no patient
// initials / age / gender, no clinical indication, no ward) — see migration 300.

const URGENCY_BADGE = {
  CR: 'bg-rk-700 text-white',
  UR: 'bg-amber-500 text-white',
  PL: 'bg-slate-300 text-slate-800',
};

const URGENCY_LABEL = { CR: 'Critical', UR: 'Urgent', PL: 'Planned' };

const STATUS_LABEL = {
  OP: 'Open',
  MT: 'Matched',
  AS: 'Assigned',
  PF: 'Partly fulfilled',
  FU: 'Fulfilled (awaiting close)',
  CL: 'Closed',
  CA: 'Cancelled',
  EX: 'Expired',
  RE: 'Replacement pending',
};

function fmt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function Row({ label, value }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{value}</dd>
    </>
  );
}

export function RequestSummary({ r }) {
  const urg = URGENCY_BADGE[r.urgency_tier] || URGENCY_BADGE.PL;
  const hasPatient = r.patient_initials || r.patient_age != null || r.patient_gender;

  return (
    <section className="rk-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-1 text-xs font-bold ${urg}`}>
          {URGENCY_LABEL[r.urgency_tier] || r.urgency_tier}
        </span>
        {r.request_number ? (
          <span className="font-mono text-sm text-slate-700">{r.request_number}</span>
        ) : null}
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {STATUS_LABEL[r.status] || r.status}
        </span>
      </div>

      <div className="mt-2 text-2xl font-semibold text-slate-900">
        {r.units_transfused ?? r.units_fulfilled ?? 0}/{r.units_required} units
        <span className="ml-1 align-middle text-xs font-normal text-slate-500">transfused</span>
      </div>
      {/* Custody progress — only present on the staff view (community_leader
          gets a PII-masked column set without these). */}
      {r.units_reserved != null ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
          {[
            { n: r.units_reserved, label: 'reserved', cls: 'bg-slate-400' },
            { n: r.units_issued, label: 'in transit', cls: 'bg-blue-500' },
            { n: r.units_received, label: 'received', cls: 'bg-indigo-500' },
            { n: r.units_transfused, label: 'transfused', cls: 'bg-green-600' },
          ]
            .filter((s) => s.n > 0)
            .map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-full ${s.cls}`} />
                {s.n} {s.label}
              </span>
            ))}
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Row label="Needed by" value={fmt(r.needed_by)} />
        <Row label="Raised at" value={fmt(r.raised_at)} />
        {r.coordinator_name ? <Row label="Coordinator" value={r.coordinator_name} /> : null}
        {hasPatient ? (
          <Row
            label="Patient"
            value={`${r.patient_initials || '—'} · ${r.patient_age ?? '?'}y · ${
              r.patient_gender || '?'
            }`}
          />
        ) : null}
        {r.ward_or_bed ? <Row label="Ward / bed" value={r.ward_or_bed} /> : null}
      </dl>

      {r.clinical_indication ? (
        <p className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-800">
          {r.clinical_indication}
        </p>
      ) : null}
    </section>
  );
}
