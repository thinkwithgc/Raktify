import { QueryClient } from '@tanstack/react-query';

// Spec §7: "No stale data shown to coordinators in emergency view." We default
// to a short stale window globally; views that require fresher data should set
// their own `staleTime: 0`.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, err) => {
        const status = err?.response?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});
