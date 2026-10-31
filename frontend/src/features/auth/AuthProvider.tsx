import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/lib/api/endpoints';
import { setUnauthorizedHandler, tokenStore } from '@/lib/api/client';
import type { Me } from '@/lib/api/types';

type Status = 'loading' | 'authed' | 'anon';

interface AuthValue {
  status: Status;
  me: Me | null;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  /** UI saja. Keputusan akhir tetap di backend (403). */
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>(tokenStore.get() ? 'loading' : 'anon');
  const [me, setMe] = useState<Me | null>(null);

  const reset = useCallback(() => {
    tokenStore.clear();
    setMe(null);
    setStatus('anon');
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(reset);
    return () => setUnauthorizedHandler(null);
  }, [reset]);

  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    authApi.me().then(
      (m) => { if (!cancelled) { setMe(m); setStatus('authed'); } },
      () => { if (!cancelled) reset(); },
    );
    return () => { cancelled = true; };
  }, [reset]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    tokenStore.set(res.token);
    try {
      const currentUser = await authApi.me();
      setMe(currentUser);
      setStatus('authed');
      return currentUser;
    } catch (e) {
      tokenStore.clear();
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* token mungkin sudah tidak berlaku; tetap keluar */ }
    reset();
  }, [reset]);

  const value = useMemo<AuthValue>(() => {
    const perms = new Set(me?.permissions ?? []);
    return { status, me, login, logout, can: (p) => perms.has(p) };
  }, [status, me, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam <AuthProvider>');
  return ctx;
}
