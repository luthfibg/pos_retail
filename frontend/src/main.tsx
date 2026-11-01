import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ApiError, tokenStore } from '@/lib/api/client';
import { platformCliLoginApi } from '@/lib/api/endpoints';
import { router } from './router';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // jangan ulangi permintaan yang ditolak server (4xx)
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

async function startApp() {
  if (window.location.pathname === '/platform/cli-login') {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const ticket = fragment.get('ticket');
    const issuedFingerprint = fragment.get('fingerprint') ?? '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    tokenStore.clear();

    try {
      if (!ticket) throw new Error('Tiket login CLI tidak ditemukan.');
      if (!/^[a-f0-9]{12}$/.test(issuedFingerprint)) {
        throw new Error('Tautan ini berasal dari command CLI lama. Jalankan ulang platform:operator-login dari backend terbaru dan gunakan tab browser yang baru terbuka.');
      }

      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket));
      const clientFingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 12);
      if (clientFingerprint !== issuedFingerprint) {
        throw new Error('Tiket pada tautan berbeda dari tiket yang diterbitkan CLI. Jalankan ulang platform:operator-login dan gunakan tab browser yang baru terbuka.');
      }

      const { token } = await platformCliLoginApi.exchange(ticket, issuedFingerprint, clientFingerprint);
      tokenStore.set(token);
      window.location.replace('/platform/stores');
      return;
    } catch (error) {
      const message = error instanceof ApiError
        ? `Login CLI gagal (HTTP ${error.status}): ${error.message}`
        : error instanceof Error
          ? `Login CLI gagal: ${error.message}`
          : 'Login CLI gagal. Browser tidak dapat menghubungi backend; periksa koneksi dan konfigurasi API.';
      sessionStorage.setItem('platform-cli-login-error', message);
      window.location.replace('/login');
      return;
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void startApp();
