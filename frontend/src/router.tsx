import { createBrowserRouter } from 'react-router-dom';
import { RequireAuth, RequirePermission } from '@/features/auth/guards';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { HomeRedirect } from '@/pages/HomeRedirect';
import { Placeholder } from '@/pages/Placeholder';
import { NotFound } from '@/pages/NotFound';
import { ProductsPage } from '@/features/products/ProductsPage';
import { CategoriesPage } from '@/features/categories/CategoriesPage';
import { SuppliersPage } from '@/features/suppliers/SuppliersPage';
import { OpeningBalancePage } from '@/features/inventory/OpeningBalancePage';
import { MovementsPage } from '@/features/inventory/MovementsPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomeRedirect /> },
          {
            element: <RequirePermission permission="sales.create" />,
            children: [{ path: 'pos', element: <Placeholder title="Kasir" note="Layar kasir (prioritas minggu 2): scan barcode, keranjang, tunai/kredit karyawan." /> }],
          },
          {
            element: <RequirePermission permission="reports.view" />,
            children: [{ path: 'dashboard', element: <Placeholder title="Dashboard" /> }],
          },
          {
            element: <RequirePermission permission="inventory.view" />,
            children: [{ path: 'products', element: <ProductsPage /> }],
          },
          {
            element: <RequirePermission permission="category.manage" />,
            children: [{ path: 'categories', element: <CategoriesPage /> }],
          },
          {
            element: <RequirePermission permission="supplier.manage" />,
            children: [{ path: 'suppliers', element: <SuppliersPage /> }],
          },
          {
            element: <RequirePermission permission="inventory.adjust.approve" />,
            children: [{ path: 'inventory/opening', element: <OpeningBalancePage /> }],
          },
          {
            element: <RequirePermission permission="inventory.view" />,
            children: [{ path: 'inventory/movements', element: <MovementsPage /> }],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
