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
