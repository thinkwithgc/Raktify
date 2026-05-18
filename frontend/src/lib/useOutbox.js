import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { apiRequest } from './api.js';
import * as outbox from './outbox.js';

// Hook that:
//   - exposes pending outbox count + manual flush
//   - auto-flushes when window emits 'online'
//   - lets callers enqueue {method, url, body} entries
//   - on a successful flush, invalidates given React Query keys so UI redraws
//
// invalidateKeys is an array of QueryKey arrays.

export function useOutbox({ invalidateKeys = [] } = {}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(0);
  const [flushing, setFlushing] = useState(false);

  const refreshCount = useCallback(async () => {
    if (!outbox.isAvailable()) return;
    try {
      const c = await outbox.count();
      setPending(c);
    } catch {
      // ignore — IDB unavailable in private mode etc
    }
  }, []);

  const flushNow = useCallback(async () => {
    if (!outbox.isAvailable()) return { sent: 0, failed: 0 };
    setFlushing(true);
    try {
      const result = await outbox.flush(({ method, url, body }) =>
        apiRequest(method, url, body),
      );
      await refreshCount();
      if (result.sent > 0) {
        for (const key of invalidateKeys) {
          qc.invalidateQueries({ queryKey: key });
        }
      }
      return result;
    } finally {
      setFlushing(false);
    }
  }, [qc, refreshCount, invalidateKeys]);

  const enqueue = useCallback(
    async (entry) => {
      await outbox.enqueue(entry);
      await refreshCount();
    },
    [refreshCount],
  );

  useEffect(() => {
    refreshCount();
    if (typeof window === 'undefined') return undefined;
    const onOnline = () => {
      flushNow();
    };
    window.addEventListener('online', onOnline);
    // Try once on mount in case we already have pending from a previous tab.
    if (navigator.onLine) flushNow();
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pending, flushing, enqueue, flushNow, refreshCount };
}

// Convenience helper: detect "this looks like a network error" so the caller
// can decide whether to enqueue. We treat "no response" or 5xx as offline-ish.
export function isOfflineError(err) {
  if (!err) return false;
  if (err.code === 'ECONNABORTED') return true;
  if (!err.response) return true;
  return err.response.status >= 500;
}
