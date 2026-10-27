import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { getVisibleNavGroups } from '@/components/layout/nav';

/** Halaman awal mengikuti kewenangan: Kasir -> /pos, Admin -> dashboard, dst. */
export function HomeRedirect() {
  const { can } = useAuth();
  const isAdmin = can('shift.review');
  const items = getVisibleNavGroups(can, isAdmin).flatMap((group) => group.items);
  const preferred = items.find((item) => item.to === (isAdmin ? '/dashboard' : '/pos'));
  return <Navigate to={preferred?.to ?? items[0]?.to ?? '/products'} replace />;
}
