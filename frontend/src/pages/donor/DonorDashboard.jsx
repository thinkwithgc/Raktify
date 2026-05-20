import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Header } from '../../components/Header.jsx';
import { apiRequest } from '../../lib/api.js';
import { useT } from '../../i18n/useT.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { isOfflineError, useOutbox } from '../../lib/useOutbox.js';

function formatDate(s, lang) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString(lang || 'en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return s;
  }
}

export function DonorDashboard() {
  const { t, lang } = useT();
  const { logout } = useAuth();
  const qc = useQueryClient();
  const { pending: outboxPending, enqueue: enqueueOutbox, flushNow } = useOutbox({
    invalidateKeys: [['donor', 'me']],
  });

  const passportQuery = useQuery({
    queryKey: ['donor', 'me'],
    queryFn: () => apiRequest('GET', '/donors/me'),
    staleTime: 0, // donor surfaces shouldn't show stale availability
  });

  // Spec §7.6: availability toggle must work offline. Strategy:
  //   1. Optimistic update of the cached passport so the UI flips immediately
  //   2. Try the network call
  //   3. If it fails with a network/5xx, enqueue to the IndexedDB outbox; the
  //      `online` listener in useOutbox replays it on reconnect
  const availability = useMutation({
    mutationFn: async ({ donorId, isAvailable }) => {
      try {
        return await apiRequest('POST', `/donors/${donorId}/availability`, {
          is_available: isAvailable,
        });
      } catch (err) {
        if (isOfflineError(err)) {
          await enqueueOutbox({
            method: 'POST',
            url: `/donors/${donorId}/availability`,
            body: { is_available: isAvailable },
          });
          return { queued: true };
        }
        throw err;
      }
    },
    onMutate: async ({ isAvailable }) => {
      await qc.cancelQueries({ queryKey: ['donor', 'me'] });
      const prev = qc.getQueryData(['donor', 'me']);
      if (prev?.donor?.stats) {
        qc.setQueryData(['donor', 'me'], {
          ...prev,
          donor: {
            ...prev.donor,
            stats: { ...prev.donor.stats, is_available: isAvailable },
          },
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['donor', 'me'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['donor', 'me'] }),
  });

  const passport = passportQuery.data;
  const donor = passport?.donor;

  return (
    <div className="min-h-full">
      <Header subtitle={donor?.full_name || ''} />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {outboxPending > 0 ? (
          <div className="flex items-center justify-between rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <span>
              {outboxPending === 1
                ? t('pending_sync_one')
                : t('pending_sync_many', { n: outboxPending })}{' '}
              {navigator.onLine ? `· ${t('loading')}` : `· ${t('will_sync_when_online')}`}
            </span>
            <button type="button" className="text-xs font-medium underline" onClick={flushNow}>
              {t('retry')}
            </button>
          </div>
        ) : null}
        {passportQuery.isLoading ? (
          <div className="rk-card text-center text-slate-500">…</div>
        ) : passportQuery.error ? (
          <div className="rk-card">
            <p className="text-rk-700">
              {passportQuery.error?.response?.data?.error || 'load_failed'}
            </p>
            <button className="rk-button-secondary mt-3" onClick={logout}>
              {t('logout')}
            </button>
          </div>
        ) : (
          <>
            <AvailabilityCard
              donor={donor}
              t={t}
              busy={availability.isPending}
              onToggle={() =>
                availability.mutate({
                  donorId: donor.id,
                  isAvailable: !donor.stats.is_available,
                })
              }
            />

            <BadgeCard donations={donor.stats.total_donations ?? 0} />

            <section className="grid gap-4 sm:grid-cols-2">
              <StatCard
                label={t('blood_group')}
                value={
                  donor.blood_group.verified?.code ||
                  donor.blood_group.self_reported?.code ||
                  '—'
                }
                badge={
                  donor.blood_group.verified ? null : t('unverified')
                }
              />
              <StatCard
                label={t('total_donations')}
                value={donor.stats.total_donations ?? 0}
              />
              <StatCard
                label={t('next_eligible')}
                value={formatDate(donor.eligibility.next_eligible_date, lang)}
              />
              <StatCard
                label="reliability"
                value={
                  donor.stats.reliability_score == null
                    ? '—'
                    : `${donor.stats.reliability_score}/100`
                }
              />
            </section>

            <UpcomingCampsSection donorDistrictId={donor?.location?.district_id} />

            <section>
              <h2 className="px-1 pb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Donation history
              </h2>
              <div className="space-y-2">
                {(passport.donations || []).slice(0, 5).map((d) => (
                  <article key={d.id} className="rk-card flex items-center justify-between">
                    <div>
                      <div className="font-medium">{d.component?.name || '—'}</div>
                      <div className="text-sm text-slate-500">
                        {formatDate(d.date, lang)} · {d.blood_bank || '—'}
                      </div>
                    </div>
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-xs font-medium ' +
                        (d.trust_level === 'V'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-amber-100 text-amber-800')
                      }
                    >
                      {d.trust_level === 'V' ? 'Verified' : 'Pending'}
                    </span>
                  </article>
                ))}
                {(passport.donations || []).length === 0 ? (
                  <div className="rk-card text-sm text-slate-500">
                    No donations yet — your first one will appear here.
                  </div>
                ) : null}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function UpcomingCampsSection({ donorDistrictId }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['donor', 'camps', donorDistrictId || 'all'],
    queryFn: () =>
      apiRequest(
        'GET',
        donorDistrictId ? `/camps?district_id=${donorDistrictId}` : '/camps',
      ),
    staleTime: 60_000,
  });

  const rsvp = useMutation({
    mutationFn: (campId) => apiRequest('POST', `/camps/${campId}/register`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['donor', 'camps'] }),
  });
  const cancel = useMutation({
    mutationFn: (campId) => apiRequest('DELETE', `/camps/${campId}/register`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['donor', 'camps'] }),
  });

  // Note: until we wire a /camps/mine endpoint, RSVP state is local-optimistic.
  const [registered, setRegistered] = useState({});

  const camps = (q.data?.camps || []).slice(0, 5);

  return (
    <section>
      <h2 className="px-1 pb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Upcoming camps
      </h2>
      <div className="space-y-2">
        {q.isLoading ? (
          <div className="rk-card text-center text-slate-500">…</div>
        ) : camps.length === 0 ? (
          <div className="rk-card text-sm text-slate-500">
            No camps scheduled near you right now. We&apos;ll notify you on WhatsApp when one
            is announced.
          </div>
        ) : (
          camps.map((c) => {
            const isRegistered = registered[c.id];
            return (
              <article key={c.id} className="rk-card space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">
                      {new Date(c.scheduled_date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })}
                      {' · '}
                      {(c.start_time || '').slice(0, 5)}–{(c.end_time || '').slice(0, 5)}
                      {' · '}
                      {c.venue}
                    </div>
                    <div className="text-xs text-slate-500">
                      {c.district_name} · {c.organiser_name}
                    </div>
                  </div>
                  {isRegistered ? (
                    <button
                      type="button"
                      className="rk-button-secondary text-xs"
                      onClick={() => {
                        cancel.mutate(c.id);
                        setRegistered((r) => ({ ...r, [c.id]: false }));
                      }}
                    >
                      Cancel RSVP
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rk-button-primary text-xs"
                      onClick={() => {
                        rsvp.mutate(c.id);
                        setRegistered((r) => ({ ...r, [c.id]: true }));
                      }}
                      disabled={rsvp.isPending}
                    >
                      I&apos;ll be there
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function AvailabilityCard({ donor, t, busy, onToggle }) {
  const isOn = Boolean(donor?.stats?.is_available);
  return (
    <section
      className={
        'rounded-2xl p-5 shadow-sm ring-1 transition-colors ' +
        (isOn ? 'bg-rk-700 text-white ring-rk-700' : 'bg-white text-slate-800 ring-slate-200')
      }
    >
      <div className="text-sm uppercase tracking-wide opacity-80">
        {isOn ? t('available_today') : t('not_available_today')}
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={
          'mt-4 inline-flex h-14 w-full items-center justify-center rounded-full px-6 text-lg font-semibold transition-colors ' +
          (isOn
            ? 'bg-white text-rk-700 hover:bg-slate-100'
            : 'bg-rk-700 text-white hover:bg-rk-900')
        }
      >
        {busy ? '…' : isOn ? 'Pause availability' : 'Mark me available'}
      </button>
    </section>
  );
}

// Tiers track lifetime verified donations. Numbers picked to match Indian
// blood-donor recognition norms (10 = "Many-time donor" badge in most state
// blood-bank programmes, 25 = the Maharashtra State "Maha Rakta Doot" cut).
const TIERS = [
  { min: 0,  label: 'New donor',    cls: 'bg-slate-100 text-slate-700 ring-slate-200',
    medal: 'rgb(148 163 184)', next: 1,  hint: 'Donate once to earn your Bronze badge.' },
  { min: 1,  label: 'Bronze donor', cls: 'bg-amber-50 text-amber-900 ring-amber-200',
    medal: '#cd7f32', next: 5,  hint: '4 more donations until Silver.' },
  { min: 5,  label: 'Silver donor', cls: 'bg-slate-100 text-slate-800 ring-slate-300',
    medal: '#c0c0c0', next: 10, hint: '5 more until Gold.' },
  { min: 10, label: 'Gold donor',   cls: 'bg-amber-100 text-amber-900 ring-amber-300',
    medal: '#d4af37', next: 25, hint: 'On track for Champion status.' },
  { min: 25, label: 'Champion',     cls: 'bg-rk-50 text-rk-700 ring-rk-200',
    medal: '#ef4a32', next: null, hint: 'You’ve saved an estimated 75+ lives.' },
];

function tierFor(donations) {
  return [...TIERS].reverse().find((t) => donations >= t.min) || TIERS[0];
}

function BadgeCard({ donations }) {
  const tier = tierFor(donations);
  const tierIndex = TIERS.indexOf(tier);
  const nextTier = TIERS[tierIndex + 1];
  // Progress = how far between this tier's floor and the next tier's floor.
  let progressPct = null;
  if (nextTier) {
    const span = nextTier.min - tier.min;
    progressPct = Math.min(100, Math.round(((donations - tier.min) / span) * 100));
  }
  // Lives-saved heuristic: each verified donation = ~3 lives (RBC + plasma + plt).
  const livesSaved = donations * 3;

  return (
    <section className={`rounded-2xl p-5 ring-1 ${tier.cls}`}>
      <div className="flex items-center gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl font-bold text-white shadow-soft"
          style={{ background: tier.medal }}
          aria-hidden="true"
        >
          ★
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide opacity-70">Donor tier</div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold">{tier.label}</span>
            <span className="text-sm opacity-70">
              · {donations} donation{donations === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mt-0.5 text-xs opacity-70">{tier.hint}</div>
        </div>
        <div className="hidden text-right text-xs opacity-80 sm:block">
          <div className="font-semibold">~{livesSaved} lives</div>
          <div>impacted</div>
        </div>
      </div>
      {progressPct != null ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/40">
            <div
              className="h-full rounded-full bg-current opacity-70 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide opacity-70">
            <span>{tier.label}</span>
            <span>
              {nextTier.min - donations} to {nextTier.label}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StatCard({ label, value, badge }) {
  return (
    <div className="rk-card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-2xl font-semibold text-slate-900">{value}</span>
        {badge ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}
