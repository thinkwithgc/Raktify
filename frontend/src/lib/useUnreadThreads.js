import { useQuery } from '@tanstack/react-query';

import { apiRequest } from './api.js';

// Per-case unread message counts for the signed-in user, powering the badges on
// the request lists. Deliberately in-app only — no WhatsApp ping per message,
// which is how people end up muting the channel that matters.
//
// Polls slowly (30s): CaseThread polls fast while a case is open and marks it
// read, which invalidates this query, so badges clear immediately on open.
export function useUnreadThreads() {
  const q = useQuery({
    queryKey: ['unread-threads'],
    queryFn: () => apiRequest('GET', '/requests/unread-threads'),
    refetchInterval: 30_000,
    staleTime: 10_000,
    // A failure here must never break the page it decorates.
    retry: 1,
  });

  const unreadByRequest = {};
  for (const row of q.data?.unread || []) {
    unreadByRequest[row.request_id] = row.unread;
  }

  const total = Object.values(unreadByRequest).reduce((a, b) => a + b, 0);
  return { unreadByRequest, total, isLoading: q.isLoading };
}
