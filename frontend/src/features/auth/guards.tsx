import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { FullPageMessage } from '@/components/ui/FullPageMessage';

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageMessage>Memuat sesi…</FullPageMessage>;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Menyembunyikan halaman bila permission tidak ada. Backend tetap menjadi penentu akhir. */
export function RequirePermission({ permission }: { permission: string }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold">Tidak ada akses</h1>
        <p className="mt-1 text-sm text-slate-600">Akun Anda tidak memiliki izin untuk membuka halaman ini.</p>
      </div>
    );
  }
  return <Outlet />;
}

export function RequireAnyPermission({ permissions }: { permissions: string[] }) {
  const { can } = useAuth();
  if (!permissions.some(can)) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold">Tidak ada akses</h1>
        <p className="mt-1 text-sm text-slate-600">Akun Anda tidak memiliki izin untuk membuka halaman ini.</p>
      </div>
    );
  }
  return <Outlet />;
}
