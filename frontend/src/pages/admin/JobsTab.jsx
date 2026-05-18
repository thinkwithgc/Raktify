import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';
import { useAuth } from '../../auth/AuthContext.jsx';

export function JobsTab() {
  const { role } = useAuth();
  const qc = useQueryClient();

  const jobsQ = useQuery({
    queryKey: ['admin', 'jobs'],
    queryFn: () => apiRequest('GET', '/admin/jobs'),
    staleTime: 60_000,
  });

  const run = useMutation({
    mutationFn: (name) => apiRequest('POST', '/admin/jobs/run', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'jobs'] }),
  });

  const jobs = jobsQ.data?.jobs || [];

  return (
    <section className="space-y-3">
      <p className="text-sm text-slate-600">
        Scheduled jobs (Phase 6 scheduler). Manual run is restricted to <code>super_admin</code>.
      </p>
      <div className="rk-card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Job</th>
              <th className="px-3 py-2 text-left">Schedule</th>
              <th className="px-3 py-2 text-left">Last run</th>
              <th className="px-3 py-2 text-left">Last result</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((j) => (
              <tr key={j.name}>
                <td className="px-3 py-2 font-medium">{j.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{j.schedule}</td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {j.last_run_at ? new Date(j.last_run_at).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">{j.last_result || '—'}</td>
                <td className="px-3 py-2 text-right">
                  {role === 'super_admin' ? (
                    <button
                      type="button"
                      className="rk-button-secondary text-xs"
                      onClick={() => run.mutate(j.name)}
                      disabled={run.isPending}
                    >
                      Run now
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && !jobsQ.isLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                  No jobs registered (set <code>SCHEDULER_ENABLED=true</code> to enable).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {run.error ? (
        <div className="rk-card text-sm text-rk-700">
          {run.error?.response?.data?.error || 'run_failed'}
        </div>
      ) : null}
    </section>
  );
}
