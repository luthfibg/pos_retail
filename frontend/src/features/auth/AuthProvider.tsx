import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/lib/api/endpoints';
import { setUnauthorizedHandler, tokenStore } from '@/lib/api/client';
import type { Me } from '@/lib/api/types';
import { countSyncQueue, offlineSessionIndex, type QueuedCountOperation } from '@/features/inventory/opnameOfflineStore';
import { syncUserCountQueue } from '@/features/inventory/opnameOfflineSync';

type Status = 'loading' | 'authed' | 'anon';

interface AuthValue {
  status: Status;
  me: Me | null;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  /** Muat ulang /auth/me (mis. setelah izin berubah) agar menu mengikuti permission terbaru. */
  refreshMe: () => Promise<void>;
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
    if (me?.user.id) {
      let queued: QueuedCountOperation[];
      try {
        queued = await countSyncQueue.forUser(me.user.id);
      } catch (error) {
        window.alert(error instanceof Error ? `Antrean opname tidak dapat diperiksa: ${error.message}` : 'Antrean opname tidak dapat diperiksa.');
        return;
      }
      if (queued.length > 0) {
        if (!window.confirm(`${queued.length} hitungan belum tersinkron. Pilih OK untuk mencoba sinkronisasi sekarang; pilih Batal untuk tetap di halaman dan sinkronkan nanti.`)) return;
        try {
          await syncUserCountQueue(me.user.id);
        } catch (error) {
          window.alert(error instanceof Error ? `Sinkronisasi belum selesai: ${error.message}` : 'Sinkronisasi belum selesai.');
        }
        try {
          queued = await countSyncQueue.forUser(me.user.id);
        } catch (error) {
          window.alert(error instanceof Error ? `Antrean opname tidak dapat diperiksa: ${error.message}` : 'Antrean opname tidak dapat diperiksa.');
          return;
        }
        if (queued.length > 0 && !window.confirm(`${queued.length} operasi masih tersimpan di perangkat ini. Tetap keluar? Antrean akan tetap terpisah untuk akun ini dan dilanjutkan saat akun yang sama masuk kembali.`)) return;
      }
      if (queued.length === 0) {
        try {
          await offlineSessionIndex.removeForUser(me.user.id);
        } catch (error) {
          if (!window.confirm(`Indeks offline akun ini tidak dapat dihapus: ${error instanceof Error ? error.message : 'penyimpanan lokal gagal'}. Tetap keluar? Data tersimpan tetap terpisah untuk akun ini.`)) return;
        }
      }
    }
    try { await authApi.logout(); } catch { /* token mungkin sudah tidak berlaku; tetap keluar */ }
    reset();
  }, [me, reset]);

  const refreshMe = useCallback(async () => {
    setMe(await authApi.me());
  }, []);

  const value = useMemo<AuthValue>(() => {
    const perms = new Set(me?.permissions ?? []);
    return { status, me, login, logout, refreshMe, can: (p) => perms.has(p) };
  }, [status, me, login, logout, refreshMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam <AuthProvider>');
  return ctx;
}
