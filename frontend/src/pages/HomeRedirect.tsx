import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { getVisibleNavGroups } from '@/components/layout/nav';
import { settingsApi } from '@/lib/api/endpoints';

/** Halaman awal mengikuti kewenangan: Kasir -> /pos, Admin -> dashboard, dst. */
export function HomeRedirect() {
  const { can, me } = useAuth();
  const inventoryMenus = useQuery({
    queryKey: ['settings', 'inventory-menus'],
    queryFn: settingsApi.inventoryMenus,
    enabled: !me?.platform_operator,
  });
  if (me?.platform_operator) return <Navigate to="/platform/stores" replace />;
  if (inventoryMenus.isLoading && !inventoryMenus.data) return null;
  const isAdmin = can('shift.review');
  const items = getVisibleNavGroups(can, isAdmin, inventoryMenus.data, me?.roles ?? []).flatMap((group) => group.items);
  const preferred = items.find((item) => item.to === (isAdmin ? '/dashboard' : '/pos'));
  return <Navigate to={preferred?.to ?? items[0]?.to ?? '/products'} replace />;
}
