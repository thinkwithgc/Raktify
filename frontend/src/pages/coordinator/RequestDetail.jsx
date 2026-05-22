import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { apiRequest } from '../../lib/api.js';
import { useT } from '../../i18n/useT.js';
import { useAuth } from '../../auth/AuthContext.jsx';

// Coordinator request detail panel (spec §7.13).
// Surfaces clinical details, the cross-role thread, and the action buttons
// required for triage. Closing wraps the spec's deferrable hospital
// self-service crossmatch flow until that's built.

const URGENCY_BADGE = {
  CR: 'bg-rk-700 text-white',
  UR: 'bg-amber-500 text-white',
  PL: 'bg-slate-300 text-slate-800',
};

const STATUS_LABEL = {
  OP: 'Open',
  MT: 'Matched',
  AS: 'Assigned',
  PF: 'Partly fulfilled',
  FU: 'Fulfilled (awaiting close)',
  CL: 'Closed',
  CA: 'Cancelled',
  EX: 'Expired',
};

export function RequestDetail() {
  const { lang } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const qc = useQueryClient();

  const requestQuery = useQuery({
    queryKey: ['request', id],
    queryFn: () => apiRequest('GET', `/requests/${id}`),
    staleTime: 0,
    refetchInterval: 20_000,
  });

  const threadQuery = useQuery({
    queryKey: ['request', id, 'thread'],
    queryFn: () => apiRequest('GET', `/coordinator/requests/${id}/thread`),
    staleTime: 0,
    refetchInterval: 20_000,
  });

  const r = requestQuery.data;
  const messages = threadQuery.data?.messages || [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['request', id] });
    qc.invalidateQueries({ queryKey: ['request', id, 'thread'] });
    qc.invalidateQueries({ queryKey: ['coordinator', 'requests'] });
  };

  const accept = useMutation({
    mutationFn: () => apiRequest('POST', `/coordinator/requests/${id}/accept`),
    onSuccess: refresh,
  });
  const claim = useMutation({
    mutationFn: () => apiRequest('POST', `/coordinator/requests/${id}/claim`),
    onSuccess: refresh,
  });
  const verify = useMutation({
    mutationFn: () => apiRequest('POST', `/coordinator/requests/${id}/verify`),
    onSuccess: refresh,
  });
  const rematch = useMutation({
    mutationFn: () => apiRequest('POST', `/requests/${id}/match`),
    onSuccess: refresh,
  });
  const closeReq = useMutation({
    mutationFn: (bagIds) =>
      apiRequest('POST', `/coordinator/requests/${id}/close`, {
        bag_ids: bagIds,
        crossmatch_confirmed: true,
      }),
    onSuccess: () => {
      refresh();
      navigate('/coordinator', { replace: true });
    },
  });

  const isLoading = requestQuery.isLoading;
  const apiError = requestQuery.error?.response?.data?.error;

  return (
    <div className="flex min-h-full flex-col">
      <Header subtitle="Request detail" />
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
        <div>
          <Link to="/coordinator" className="text-sm text-rk-700 hover:underline">
            ← Back to queue
          </Link>
        </div>

        {isLoading ? (
          <div className="rk-card text-center text-slate-500">…</div>
        ) : apiError ? (
          <div className="rk-card text-rk-700">{apiError}</div>
        ) : r ? (
          <>
            <Header2 r={r} lang={lang} />

            <ActionBar
              r={r}
              role={role}
              busy={
                accept.isPending ||
                claim.isPending ||
                verify.isPending ||
                rematch.isPending ||
                closeReq.isPending
              }
              onAccept={() => accept.mutate()}
              onClaim={() => claim.mutate()}
              onVerify={() => verify.mutate()}
              onRematch={() => rematch.mutate()}
              onClose={(bagIds) => closeReq.mutate(bagIds)}
              lastError={
                accept.error?.response?.data?.error ||
                claim.error?.response?.data?.error ||
                verify.error?.response?.data?.error ||
                rematch.error?.response?.data?.error ||
                closeReq.error?.response?.data?.error ||
                null
              }
            />

            <ClinicalCard r={r} />

            <ThreadPanel
              messages={messages}
              loading={threadQuery.isLoading}
              requestId={id}
              role={role}
              onPosted={refresh}
            />
          </>
        ) : null}
      </main>
      <Footer variant="compact" />
    </div>
  );
}

function fmtDateTime(iso, lang) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(lang || 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function Header2({ r, lang }) {
  const urg = URGENCY_BADGE[r.urgency_tier] || URGENCY_BADGE.PL;
  return (
    <section className="rk-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-1 text-xs font-bold ${urg}`}>
          {r.urgency_tier}
        </span>
        <span className="font-mono text-sm text-slate-700">{r.request_number}</span>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {STATUS_LABEL[r.status] || r.status}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">
        {r.units_fulfilled}/{r.units_required} units
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Row label="Tier" value={r.source_tier} />
        <Row label="Needed by" value={fmtDateTime(r.needed_by, lang)} />
        <Row label="Raised at" value={fmtDateTime(r.raised_at, lang)} />
        <Row label="Coordinator" value={r.coordinator_name || '—'} />
      </dl>
    </section>
  );
}

function Row({ label, value }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{value}</dd>
    </>
  );
}

function ClinicalCard({ r }) {
  return (
    <section className="rk-card">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Clinical
      </h2>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Row label="Patient" value={`${r.patient_initials || '—'} · ${r.patient_age ?? '?'}y · ${r.patient_gender || '?'}`} />
        <Row label="Ward / bed" value={r.ward_or_bed || '—'} />
      </dl>
      {r.clinical_indication ? (
        <p className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-800">
          {r.clinical_indication}
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-500">No clinical note attached.</p>
      )}
      {r.matched_blood_bank_id ? (
        <p className="mt-2 text-xs text-slate-500">
          Matched blood bank id <span className="font-mono">{r.matched_blood_bank_id}</span>
        </p>
      ) : null}
    </section>
  );
}

function ActionBar({ r, role, busy, onAccept, onClaim, onVerify, onRematch, onClose, lastError }) {
  const isCoordinator = role === 'coordinator';
  const tier34 = ['CR', 'CI'].includes(r.source_tier);
  const closableState = ['FU', 'PF', 'MT', 'AS'].includes(r.status);
  const [showClose, setShowClose] = useState(false);
  const [bagIdsText, setBagIdsText] = useState('');

  function tryClose() {
    const ids = bagIdsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return;
    onClose(ids);
  }

  return (
    <section className="rk-card space-y-2">
      <div className="flex flex-wrap gap-2">
        {isCoordinator && !r.coordinator_accepted_at ? (
          <button type="button" className="rk-button-primary" onClick={onAccept} disabled={busy}>
            Accept assignment
          </button>
        ) : null}
        {isCoordinator ? (
          <button type="button" className="rk-button-secondary" onClick={onClaim} disabled={busy}>
            Claim (override)
          </button>
        ) : null}
        {isCoordinator && tier34 ? (
          <button type="button" className="rk-button-secondary" onClick={onVerify} disabled={busy}>
            Verify (Tier 3/4)
          </button>
        ) : null}
        <button type="button" className="rk-button-secondary" onClick={onRematch} disabled={busy}>
          Re-trigger match
        </button>
        {closableState && isCoordinator ? (
          <button
            type="button"
            className="rk-button-primary"
            onClick={() => setShowClose((s) => !s)}
            disabled={busy}
          >
            {showClose ? 'Cancel close' : 'Close (with crossmatch)'}
          </button>
        ) : null}
      </div>

      {showClose ? (
        <div className="rounded-md border border-slate-200 p-3">
          <label className="rk-label" htmlFor="close-bags">
            Bag IDs (UUIDs, one per line or comma-separated)
          </label>
          <textarea
            id="close-bags"
            rows={3}
            className="rk-input font-mono text-xs"
            placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
            value={bagIdsText}
            onChange={(e) => setBagIdsText(e.target.value)}
          />
          <button
            type="button"
            className="rk-button-primary mt-2"
            onClick={tryClose}
            disabled={busy || bagIdsText.trim().length === 0}
          >
            Confirm close
          </button>
          <p className="mt-1 text-xs text-slate-500">
            Confirms crossmatch and marks bags as transfused. Spec §7 wraps this in a hospital
            self-service flow — currently bundled here for coordinator triage.
          </p>
        </div>
      ) : null}

      {lastError ? <p className="text-sm text-rk-700">{lastError}</p> : null}
    </section>
  );
}

function ThreadPanel({ messages, loading, requestId, role, onPosted }) {
  const [text, setText] = useState('');
  const [scope, setScope] = useState('default');
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState('');

  async function post() {
    if (!text.trim()) return;
    setPosting(true);
    setErr('');
    try {
      const visibility =
        scope === 'coord_only'
          ? ['coordinator', 'ngo_admin', 'super_admin']
          : scope === 'with_donor'
            ? ['donor', 'coordinator', 'hospital', 'blood_bank', 'ngo_admin', 'super_admin']
            : undefined;
      await apiRequest('POST', `/coordinator/requests/${requestId}/thread`, {
        message_text: text.trim(),
        message_type: 'CO',
        ...(visibility ? { visible_to_roles: visibility } : {}),
      });
      setText('');
      onPosted?.();
    } catch (e) {
      setErr(e?.response?.data?.error || 'post_failed');
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="rk-card">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Thread
      </h2>
      <div className="space-y-2">
        {loading ? <p className="text-sm text-slate-500">…</p> : null}
        {messages.length === 0 && !loading ? (
          <p className="text-sm text-slate-500">No messages yet.</p>
        ) : null}
        {messages.map((m) => (
          <article key={m.id} className="rounded-md bg-slate-50 p-2 text-sm">
            <div className="text-xs text-slate-500">
              <span className="font-medium text-slate-700">{m.author_role}</span> ·{' '}
              {fmtDateTime(m.posted_at)}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-slate-800">{m.message_text}</div>
          </article>
        ))}
      </div>

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <textarea
          rows={2}
          className="rk-input"
          placeholder="Add a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <select
            className="rk-input max-w-[14rem]"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label="visibility"
          >
            <option value="default">Coord + hospital + bb</option>
            <option value="coord_only">Coordinators only</option>
            {role === 'coordinator' ? (
              <option value="with_donor">Include donor</option>
            ) : null}
          </select>
          <button type="button" className="rk-button-primary" onClick={post} disabled={posting}>
            {posting ? '…' : 'Post'}
          </button>
        </div>
        {err ? <p className="text-sm text-rk-700">{err}</p> : null}
      </div>
    </section>
  );
}
