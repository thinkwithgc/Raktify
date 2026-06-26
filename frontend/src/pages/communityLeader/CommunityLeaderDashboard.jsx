import { useQuery } from '@tanstack/react-query';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { apiRequest } from '../../lib/api.js';

/**
 * Community-leader dashboard (Phase 1 — placeholder).
 *
 * Phase 1 shows just the leader's profile + impact counters (all zero
 * initially). Phase 2 adds the communities list + creation flow. Phase 3
 * adds the donor roster + referral toolkit + camp wiring.
 *
 * Philosophy reminder (per planning conversation):
 *   • Raktify is the OPERATIONS layer, not the COMMUNICATION layer.
 *   • The leader's WhatsApp group stays the leader's WhatsApp group.
 *   • This dashboard surfaces stats + shareable assets — the leader
 *     posts them in their group on their own terms.
 *   • Donor mobiles are NEVER shown here; the leader already has them
 *     via their existing WhatsApp group.
 */
export function CommunityLeaderDashboard() {
  const meQ = useQuery({
    queryKey: ['community-leader', 'me'],
    queryFn: () => apiRequest('GET', '/community-leader/me'),
    staleTime: 60_000,
  });

  const profile = meQ.data?.profile;

  return (
    <div className="flex min-h-full flex-col bg-cream font-sans">
      <Header subtitle="Community leader" />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 space-y-5">
        {meQ.isLoading ? (
          <p className="text-slate-500">Loading…</p>
        ) : meQ.error ? (
          <div className="rk-card text-rk-700">
            {meQ.error?.response?.data?.error || 'profile_load_failed'}
          </div>
        ) : profile ? (
          <>
            <section className="rk-card">
              <h1 className="text-xl font-semibold text-stone-900">
                Welcome, {profile.display_name}
              </h1>
              <p className="mt-1 text-sm text-stone-600">
                Your communities + referral tools + impact stats will land here as we ship the
                next phases. For now, this is just your profile + a confirmation that the
                platform recognises you as a community leader.
              </p>
              {profile.suspended_at ? (
                <div className="mt-3 rounded border border-rk-200 bg-rk-50 p-3 text-sm text-rk-900">
                  <strong>Your account is suspended.</strong>{' '}
                  {profile.suspension_reason
                    ? `Reason: ${profile.suspension_reason}.`
                    : null}{' '}
                  Please contact the NGO administrator.
                </div>
              ) : null}
            </section>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Communities" value={profile.communities_count} />
              <StatCard label="Donors in network" value={profile.total_donor_count} />
              <StatCard label="Donations facilitated" value={profile.donations_facilitated} />
              <StatCard label="Camps hosted" value={profile.camps_hosted} />
            </section>

            <section className="rk-card">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                Your details
              </h2>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <ProfileRow label="Mobile" value={profile.mobile} mono />
                {profile.email ? <ProfileRow label="Email" value={profile.email} /> : null}
                <ProfileRow
                  label="Region"
                  value={
                    [profile.district_name, profile.state_name].filter(Boolean).join(', ') || '—'
                  }
                />
                <ProfileRow
                  label="Preferred language"
                  value={
                    profile.preferred_language === 'mr'
                      ? 'मराठी'
                      : profile.preferred_language === 'hi'
                        ? 'हिंदी'
                        : 'English'
                  }
                />
                <ProfileRow
                  label="Joined"
                  value={profile.joined_at ? new Date(profile.joined_at).toLocaleDateString() : '—'}
                />
                {profile.invitation_notes ? (
                  <ProfileRow label="Notes" value={profile.invitation_notes} colSpan />
                ) : null}
              </dl>
            </section>

            <section className="rk-card bg-sand/40">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                Coming next
              </h2>
              <ul className="mt-2 space-y-1.5 text-sm text-stone-700">
                <li>• <strong>Phase 2:</strong> Create + manage your communities with a co-leader.</li>
                <li>• <strong>Phase 3:</strong> See your donors, get referral links + QR codes to bring more in, host camps.</li>
              </ul>
              <p className="mt-3 text-xs text-stone-500">
                <strong>Reminder:</strong> Raktify is your operations layer. Your WhatsApp group
                remains your communication channel — we don't send messages to your community
                members on your behalf, and we don't show you their mobile numbers (you already
                have them in WhatsApp anyway).
              </p>
            </section>
          </>
        ) : null}
      </main>
      <Footer variant="compact" />
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rk-card">
      <div className="text-2xl font-semibold text-stone-900">{value ?? 0}</div>
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
    </div>
  );
}

function ProfileRow({ label, value, mono, colSpan }) {
  return (
    <div className={colSpan ? 'sm:col-span-2' : ''}>
      <dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className={`text-stone-800 ${mono ? 'font-mono text-sm' : ''}`}>{value || '—'}</dd>
    </div>
  );
}
