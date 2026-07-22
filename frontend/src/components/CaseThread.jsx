import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../lib/api.js';
import { errorMessage } from '../lib/errorMessage.js';
import { useAuth } from '../auth/AuthContext.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// CaseThread — the per-request case chat, shared by EVERY portal (coordinator,
// hospital, blood bank, community leader).
//
// There is deliberately no role logic here beyond presentation: the backend
// decides which messages a caller may read and whether they may post at all,
// so the same component is safe everywhere. That check is the isRequestParty()
// guard in routes/requests.js — NOT the RLS policies in migrations 299/300,
// which are inert at runtime because the app connects as a BYPASSRLS role.
// Do not weaken the route guard on the assumption that RLS is backing it up.
//
// Polling: 10s while the tab is focused, paused when hidden (Page Visibility) so
// background tabs don't hammer the API. Messages come from ONE query, so a
// WebSocket feed can replace the poll later without touching this UI.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_LABEL = {
  coordinator: 'Coordinator',
  hospital: 'Hospital',
  blood_bank: 'Blood bank',
  community_leader: 'Community leader',
  ngo_admin: 'NGO admin',
  super_admin: 'Admin',
  system: 'System',
};

const ALL_ROLES = [
  'coordinator',
  'hospital',
  'blood_bank',
  'community_leader',
  'ngo_admin',
  'super_admin',
];

// Audience presets. Kept deliberately short — a long checkbox list is how people
// post to the wrong audience under time pressure.
// "Staff only" was ambiguous in testing — whose staff? Hospital, blood bank,
// NGO? Each option now names the roles outright, and the caption under the
// picker spells out who will and will not see the message before it is sent.
const SCOPES = {
  all: {
    label: 'Everyone on this case',
    who: 'Hospital, blood bank, NGO coordinator and community leader.',
    roles: undefined,
  },
  staff: {
    label: 'Hospital + blood bank + NGO coordinator',
    who: 'Hospital staff, blood-bank staff and the NGO coordinator. The community leader will NOT see this.',
    roles: ['coordinator', 'hospital', 'blood_bank', 'ngo_admin', 'super_admin'],
  },
  coord: {
    label: 'NGO coordinator + Raktify admin only',
    who: 'Only the NGO coordinator and Raktify admins. The hospital, blood bank and community leader will NOT see this.',
    roles: ['coordinator', 'ngo_admin', 'super_admin'],
  },
};

function fmt(iso) {
  if (!iso) return '';
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

export function CaseThread({ requestId, className = '' }) {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [scope, setScope] = useState('all');
  const [err, setErr] = useState('');
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );

  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const threadKey = ['request', requestId, 'thread'];
  const thread = useQuery({
    queryKey: threadKey,
    queryFn: () => apiRequest('GET', `/requests/${requestId}/thread`),
    refetchInterval: tabVisible ? 10_000 : false,
    staleTime: 0,
  });
  const messages = thread.data?.messages || [];

  // Mark read when we're actually looking at it. The ref stops this from
  // re-posting on every poll — only when the message count actually moves.
  const markRead = useMutation({
    mutationFn: () => apiRequest('POST', `/requests/${requestId}/thread/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unread-threads'] }),
  });
  const markedAt = useRef(-1);
  useEffect(() => {
    if (!tabVisible || messages.length === 0) return;
    if (markedAt.current === messages.length) return;
    markedAt.current = messages.length;
    markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabVisible, messages.length, requestId]);

  const post = useMutation({
    mutationFn: (body) => apiRequest('POST', `/requests/${requestId}/thread`, body),
    onSuccess: () => {
      setText('');
      setErr('');
      markedAt.current = -1; // our own message shouldn't leave the case "unread"
      qc.invalidateQueries({ queryKey: threadKey });
    },
    onError: (e) => {
      const code = e?.response?.data?.error;
      setErr(
        code === 'invalid_input'
          ? 'Your message is empty or longer than 4000 characters. Shorten it and send again.'
          : errorMessage(e, 'send this message'),
      );
    },
  });

  function send() {
    const body = text.trim();
    if (!body || post.isPending) return;
    const roles = SCOPES[scope]?.roles;
    post.mutate({ message_text: body, ...(roles ? { visible_to_roles: roles } : {}) });
  }

  return (
    <section className={`rk-card ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Case chat</h2>
        <span className="text-xs text-slate-400">
          {thread.isLoading
            ? 'loading…'
            : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
          {tabVisible ? '' : ' · paused'}
        </span>
      </div>

      <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
        {thread.isLoading ? <p className="text-sm text-slate-500">…</p> : null}
        {!thread.isLoading && messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            No messages yet — start the conversation for this case.
          </p>
        ) : null}
        {messages.map((m) => (
          <Message key={m.id} m={m} mine={Boolean(userId) && m.author_user_id === userId} />
        ))}
      </div>

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <textarea
          rows={2}
          className="rk-input"
          placeholder="Message everyone working this case…"
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rk-input max-w-[17rem]"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label="Who can see this message"
          >
            {Object.entries(SCOPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rk-button-primary"
            onClick={send}
            disabled={post.isPending || text.trim().length === 0}
          >
            {post.isPending ? 'Sending…' : 'Send'}
          </button>
          <span className="hidden text-xs text-slate-400 sm:inline">⌘/Ctrl + Enter</span>
        </div>
        <p className="text-xs text-slate-500">
          <span className="font-medium">Who will see this:</span> {SCOPES[scope]?.who}
        </p>
        {err ? <p className="text-sm text-rk-700">{err}</p> : null}
      </div>
    </section>
  );
}

function Message({ m, mine }) {
  // System auto-posts (status changes, escalation, donor confirmations) read as
  // activity events, not chat bubbles.
  if (m.message_type === 'SY') {
    return (
      <p className="py-1 text-center text-xs italic text-slate-500">
        {m.message_text} <span className="text-slate-400">· {fmt(m.posted_at)}</span>
      </p>
    );
  }

  const limited =
    Array.isArray(m.visible_to_roles) && ALL_ROLES.some((r) => !m.visible_to_roles.includes(r));

  return (
    <article className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          mine ? 'bg-rk-50 text-slate-900' : 'bg-slate-50 text-slate-800'
        }`}
      >
        <div className="text-xs text-slate-500">
          <span className="font-medium text-slate-700">
            {ROLE_LABEL[m.author_role] || m.author_role}
          </span>
          {' · '}
          {fmt(m.posted_at)}
          {m.edited_at ? ' · edited' : ''}
          {limited ? (
            <span
              className="ml-1 rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-600"
              title={`Visible to: ${(m.visible_to_roles || []).join(', ')}`}
            >
              limited
            </span>
          ) : null}
        </div>
        <div className="mt-1 whitespace-pre-wrap">{m.message_text}</div>
      </div>
    </article>
  );
}
