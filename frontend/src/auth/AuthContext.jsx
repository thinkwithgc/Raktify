import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { tokenStore } from '../lib/api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => ({
    token: tokenStore.token,
    role: tokenStore.role,
    userId: tokenStore.userId,
  }));

  const setSession = useCallback((session) => {
    tokenStore.set(session);
    setAuth({ token: session.token, role: session.role, userId: session.user_id });
  }, []);

  const clear = useCallback(() => {
    tokenStore.clear();
    setAuth({ token: '', role: '', userId: '' });
  }, []);

  // Listen for the 401 event the axios interceptor dispatches.
  useEffect(() => {
    const onExpired = () => clear();
    window.addEventListener('rk:auth-expired', onExpired);
    return () => window.removeEventListener('rk:auth-expired', onExpired);
  }, [clear]);

  const value = useMemo(
    () => ({
      ...auth,
      isAuthenticated: Boolean(auth.token),
      setSession,
      logout: clear,
    }),
    [auth, setSession, clear],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
