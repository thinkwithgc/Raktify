import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';

export function DuplicatesTab() {
  const qc = useQueryClient();

  const listQ = useQuery({
    queryKey: ['admin', 'duplicates'],
    queryFn: () => apiRequest('GET', '/admin/duplicates'),
    staleTime: 30_000,
  });

  const clear = useMutation({
    mutationFn: (id) => apiRequest('POST', `/admin/duplicates/${id}/clear`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'duplicates'] }),
  });

  // Merge endpoint is a 501 stub server-side — see services/donors/merge.js
  // design notes. UI surfaces a button anyway so the operator sees the path.
  const merge = useMutation({
    mutationFn: (id) => apiRequest('POST', `/admin/duplicates/${id}/merge`),
  });

  const pairs = listQ.data?.pairs || [];

  return (
    <section className="space-y-3">
      <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
        Suspected-duplicate detection runs at registration (`services/donors/duplicates.js`).
        FLAG-action pairs land here; clear false positives or trigger merge once the
        medical advisor confirms merge semantics (deferral, donation history reconciliation).
      </div>

      {listQ.error ? (
        <div className="rk-card text-rk-700">
          {listQ.error?.response?.data?.error || 'load_failed'}
        </div>
      ) : null}

      <div className="space-y-2">
        {pairs.map((p) => (
          <article key={p.suspected_id} className="rk-card">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Suspected dup</div>
                <div className="font-medium">{p.full_name}</div>
                <div className="text-xs text-slate-500">DOB {p.date_of_birth}</div>
                <div className="font-mono text-[10px] text-slate-400">{p.suspected_id}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Canonical</div>
                <div className="font-medium">{p.canonical_name}</div>
                <div className="text-xs text-slate-500">DOB {p.canonical_dob}</div>
                <div className="font-mono text-[10px] text-slate-400">{p.canonical_id}</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rk-button-secondary text-sm"
                onClick={() => clear.mutate(p.suspected_id)}
                disabled={clear.isPending}
              >
                Clear flag (false positive)
              </button>
              <button
                type="button"
                className="rk-button-primary text-sm"
                onClick={() => merge.mutate(p.suspected_id)}
                disabled={merge.isPending}
                title="Backend currently returns 501 — pending medical-advisor sign-off"
              >
                Merge
              </button>
              {merge.error ? (
                <span className="text-xs text-rk-700">
                  {merge.error?.response?.data?.error || 'merge_failed'}
                </span>
              ) : null}
            </div>
          </article>
        ))}
        {pairs.length === 0 && !listQ.isLoading ? (
          <div className="rk-card text-sm text-slate-500">
            No flagged duplicates — every registration is currently considered unique.
          </div>
        ) : null}
      </div>
    </section>
  );
}
