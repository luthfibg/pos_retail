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
    const ticket = new URLSearchParams(window.location.hash.slice(1)).get('ticket');
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    tokenStore.clear();

    try {
      if (!ticket) throw new Error('Tiket login CLI tidak ditemukan.');
      const { token } = await platformCliLoginApi.exchange(ticket);
      tokenStore.set(token);
      window.location.replace('/platform/stores');
      return;
    } catch {
      sessionStorage.setItem('platform-cli-login-error', 'Login CLI gagal atau tiket sudah kedaluwarsa. Jalankan kembali command login.');
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
