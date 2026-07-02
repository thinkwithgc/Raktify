import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';

import { apiRequest, tokenStore } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';

// Cross-role switcher — shows a subtle card in the dashboard when the
// current mobile also holds another OTP-cluster role (donor <-> community
// leader). One click mints a fresh JWT for the target role — no logout,
// no OTP again.

const ROLE_META = {
  donor: {
    label: 'Donor',
    icon: '🩸',
    dest: '/donor',
    invite: 'Switch to your donor profile',
    hint: 'Track your donations, availability, and next eligible date.',
  },
  community_leader: {
    label: 'Community leader',
    icon: '👥',
    dest: '/community-leader',
    invite: 'Switch to your community leader dashboard',
    hint: 'Manage communities, invite donors, host camps.',
  },
};

export function RoleSwitcher({ from }) {
  const nav = useNavigate();
  const { setSession, role: currentRole } = useAuth();

  const q = useQuery({
    queryKey: ['auth', 'available-roles', currentRole],
    queryFn: () => apiRequest('GET', '/auth/available-roles'),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const m = useMutation({
    mutationFn: (targetRole) =>
      apiRequest('POST', '/auth/switch-role', { target_role: targetRole }),
    onSuccess: (data) => {
      tokenStore.set({ token: data.token, role: data.role, user_id: data.user_id });
      setSession(data);
      const meta = ROLE_META[data.role];
      nav(meta?.dest || '/', { replace: true });
    },
  });

  // Defensive filter: never render a card for the role we're already in.
  // The API also filters, but if a stale cache or historical data anomaly
  // leaks through, don't offer a "switch to X" that goes nowhere.
  const roles = (q.data?.roles || []).filter((r) => r.role !== currentRole);
  if (roles.length === 0) return null;

  return (
    <div className="space-y-2">
      {roles.map((r) => {
        const meta = ROLE_META[r.role];
        if (!meta) return null;
        return (
          <button
            key={r.user_id}
            type="button"
            onClick={() => m.mutate(r.role)}
            disabled={m.isPending}
            className="group flex w-full items-center gap-3 rounded-lg border border-rk-200 bg-rk-50 p-3 text-left transition hover:border-rk-700 hover:bg-white disabled:opacity-60"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl">
              {meta.icon}
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-rk-700">
                {m.isPending ? 'Switching…' : meta.invite}
              </div>
              <div className="text-xs text-slate-600">{meta.hint}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-400">
                you&apos;re currently in <strong>{from}</strong> profile · same mobile, no re-login
              </div>
            </div>
            <span
              aria-hidden="true"
              className="text-lg text-rk-700 transition group-hover:translate-x-0.5"
            >
              →
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default RoleSwitcher;
