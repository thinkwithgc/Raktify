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

  // Custody chain: coordinator confirms receipt on the requestor's behalf
  // (after verifying by phone), and can mark transfused on behalf of a
  // non-onboarded requestor who has no hospital login.
  const confirmReceived = useMutation({
    mutationFn: () =>
      apiRequest('POST', `/coordinator/requests/${id}/confirm-received`, { verified_with: 'PR' }),
    onSuccess: refresh,
  });
  const confirmTransfused = useMutation({
    mutationFn: () => apiRequest('POST', `/coordinator/requests/${id}/confirm-transfused`, {}),
    onSuccess: refresh,
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

            <CustodyActions
              r={r}
              onReceived={() => confirmReceived.mutate()}
              onTransfused={() => confirmTransfused.mutate()}
              busy={confirmReceived.isPending || confirmTransfused.isPending}
              lastError={
                confirmReceived.error?.response?.data?.error ||
                confirmTransfused.error?.response?.data?.error ||
                null
              }
            />

            <ClinicalCard r={r} />

            <DonorAlertGatePanel requestId={id} />

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

// Custody-chain actions for the coordinator: confirm receipt on the requestor's
// behalf (after verifying by phone), and — for non-onboarded requestors — mark
// transfused on their behalf. Only shown when there are bags at the relevant
// stage, so it stays out of the way until the BB has issued.
function CustodyActions({ r, onReceived, onTransfused, busy, lastError }) {
  const issued = r.units_issued || 0;
  const received = r.units_received || 0;
  const transfused = r.units_transfused || 0;
  if (issued === 0 && received === 0 && transfused === 0) return null;

  return (
    <section className="rk-card">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Custody &amp; receipt
      </h2>
      <p className="text-xs text-slate-500">
        {issued} in transit · {received} received · {transfused} transfused
      </p>
      {lastError ? <p className="mt-2 text-sm text-rk-700">{lastError}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {issued > 0 ? (
          <button
            type="button"
            onClick={onReceived}
            disabled={busy}
            className="rk-button-primary"
            title="Confirm with the patient's relative, the hospital, or the community leader that the units arrived"
          >
            {busy ? '…' : `Confirm ${issued} unit${issued !== 1 ? 's' : ''} received`}
          </button>
        ) : null}
        {issued + received > 0 ? (
          <button
            type="button"
            onClick={onTransfused}
            disabled={busy}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Only for requestors with no hospital login (guest / community / citizen)"
          >
            Mark transfused (on behalf)
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Confirm receipt only after verifying by phone. Transfused-on-behalf is for requestors with
        no hospital login.
      </p>
    </section>
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

// ────────────────────────────────────────────────────────────────────────────
// DonorAlertGatePanel (V2) — shows BB decision matrix + donor-alert queue
// state + Alert-now / Hold override buttons.
// ────────────────────────────────────────────────────────────────────────────
function DonorAlertGatePanel({ requestId }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['request', requestId, 'gate-status'],
    queryFn: () => apiRequest('GET', `/coordinator/requests/${requestId}/gate-status`),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const alertNow = useMutation({
    mutationFn: () =>
      apiRequest('POST', `/coordinator/requests/${requestId}/alert-donors-now`, {}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['request', requestId, 'gate-status'] }),
  });

  const [holdOpen, setHoldOpen] = useState(false);

  if (q.isLoading)
    return (
      <section className="rk-card text-center text-sm text-slate-500">Loading gate…</section>
    );
  if (q.error) return null;

  const d = q.data;
  const gate = d?.gate;
  const bbs = d?.bb_decisions || [];

  const offered = bbs.filter((b) => b.state === 'offered');
  const declined = bbs.filter((b) => b.state === 'declined');
  const silent = bbs.filter((b) => b.state === 'silent');

  const fireIn = gate?.scheduled_fire_at
    ? Math.round((new Date(gate.scheduled_fire_at).getTime() - Date.now()) / 60_000)
    : null;
  const isHeld = !!gate?.held_at;
  const isFired = !!gate?.fired_at;

  return (
    <section className="rk-card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Donor alert gate
        </h2>
        <span className="text-xs text-slate-400">
          {d.units_committed} of {d.units_required} committed · {d.units_still_needed} still needed
        </span>
      </div>

      {/* BB decision matrix */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded border border-green-200 bg-green-50 p-2">
          <div className="font-semibold text-green-800">✓ Offered ({offered.length})</div>
          {offered.length === 0 ? (
            <div className="mt-1 text-slate-400">no BB has offered yet</div>
          ) : (
            <ul className="mt-1 space-y-1">
              {offered.map((b) => (
                <li key={b.bb_id} className="text-slate-800">
                  {b.display_name}{' '}
                  <span className="text-[11px] text-slate-500">({b.units_offered}u)</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded border border-rk-200 bg-rk-50 p-2">
          <div className="font-semibold text-rk-700">✗ Declined ({declined.length})</div>
          {declined.length === 0 ? (
            <div className="mt-1 text-slate-400">no BB declined</div>
          ) : (
            <ul className="mt-1 space-y-1">
              {declined.map((b) => (
                <li key={b.bb_id} className="text-slate-800">
                  {b.display_name}{' '}
                  <span className="text-[11px] text-slate-500">({b.decline_reason})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="font-semibold text-slate-700">⏳ Silent ({silent.length})</div>
          {silent.length === 0 ? (
            <div className="mt-1 text-slate-400">none</div>
          ) : (
            <ul className="mt-1 space-y-1">
              {silent.map((b) => (
                <li key={b.bb_id} className="text-slate-800">
                  {b.display_name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Cascade signal */}
      {d.eligible_bb_count > 0 && d.ns_decline_count >= d.eligible_bb_count ? (
        <div className="rounded border border-rk-200 bg-rk-50 p-2 text-xs text-rk-700">
          All eligible BBs declined with &quot;No stock&quot; — donor alerts will fire immediately on the
          next scheduler tick (zero-timer cascade).
        </div>
      ) : null}

      {/* Alert queue state */}
      <div className="rounded border border-slate-200 p-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-700">Alert queue</span>
          {gate ? (
            <span className="text-slate-500">
              trigger: {gate.trigger_source} · urgency: {gate.urgency_snapshot}
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-slate-700">
          {!gate ? (
            <span className="text-slate-500">
              No pending alert (matcher may not have run, or donor_activation_required=false)
            </span>
          ) : isFired ? (
            <span className="text-green-700">
              ✓ Fired — {gate.fired_alert_count} donors alerted at{' '}
              {fmtDateTime(gate.fired_at)}
            </span>
          ) : isHeld ? (
            <span className="text-amber-700">
              ⏸ Held — {gate.held_reason || 'reason not given'}
            </span>
          ) : fireIn !== null && fireIn > 0 ? (
            <span>
              Scheduled to fire in <span className="font-bold">{fireIn} min</span>{' '}
              (at {fmtDateTime(gate.scheduled_fire_at)})
            </span>
          ) : (
            <span>
              Ready to fire on next scheduler tick (target: {fmtDateTime(gate.scheduled_fire_at)})
            </span>
          )}
        </div>
        {d.donor_alerts.total > 0 ? (
          <div className="mt-1 text-slate-500">
            Cumulative: {d.donor_alerts.total} alerted · {d.donor_alerts.accepted} accepted ·{' '}
            {d.donor_alerts.declined} declined
          </div>
        ) : null}
      </div>

      {/* Override buttons */}
      {!isFired ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => alertNow.mutate()}
            disabled={alertNow.isPending}
            className="rounded bg-rk-700 px-3 py-2 text-xs font-semibold text-white hover:bg-rk-800 disabled:opacity-60"
          >
            🚨 {alertNow.isPending ? 'Firing…' : 'Alert donors NOW'}
          </button>
          {!isHeld ? (
            <button
              type="button"
              onClick={() => setHoldOpen(true)}
              className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              ⏸ Hold donor alerts
            </button>
          ) : null}
        </div>
      ) : null}

      {holdOpen ? (
        <HoldModal
          requestId={requestId}
          onClose={() => setHoldOpen(false)}
          onDone={() => {
            setHoldOpen(false);
            qc.invalidateQueries({ queryKey: ['request', requestId, 'gate-status'] });
          }}
        />
      ) : null}
    </section>
  );
}

function HoldModal({ requestId, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const m = useMutation({
    mutationFn: () =>
      apiRequest('POST', `/coordinator/requests/${requestId}/hold-donor-alerts`, { reason }),
    onSuccess: onDone,
    onError: (e) => setErr(e?.response?.data?.error || 'hold_failed'),
  });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">Hold donor alerts</h3>
        <p className="mt-1 text-xs text-slate-500">
          Suppress donor alerts even if the timer fires. Use when a BB has confirmed offline that
          they&apos;ll handle the request, or when this case needs human triage first.
        </p>
        <textarea
          rows={3}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          className="mt-3 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-rk-700 focus:outline-none"
          placeholder="Why are you holding (e.g. 'GMCH called — Amravati BB dispatching now')"
        />
        {err ? <p className="mt-2 text-xs text-rk-700">Error: {err}</p> : null}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (reason.trim().length < 3) {
                setErr('reason_too_short');
                return;
              }
              m.mutate();
            }}
            disabled={m.isPending}
            className="flex-1 rounded bg-rk-700 px-3 py-2 text-sm font-semibold text-white hover:bg-rk-800 disabled:opacity-60"
          >
            {m.isPending ? 'Saving…' : 'Confirm hold'}
          </button>
        </div>
      </div>
    </div>
  );
}
