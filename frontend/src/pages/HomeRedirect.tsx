import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { NAV_ITEMS } from '@/components/layout/nav';

/** Halaman awal mengikuti kewenangan: Kasir -> /pos, Admin -> dashboard, dst. */
export function HomeRedirect() {
  const { can } = useAuth();
  const first = NAV_ITEMS.find((i) =>
    Array.isArray(i.permission) ? i.permission.some(can) : can(i.permission),
  );
  return <Navigate to={first?.to ?? '/products'} replace />;
}
