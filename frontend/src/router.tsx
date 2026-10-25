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
import { CustomersPage } from '@/features/customers/CustomersPage';
import { ShiftPage } from '@/features/shifts/ShiftPage';
import { ShiftsAdminPage } from '@/features/shifts/ShiftsAdminPage';
import { PosPage } from '@/features/sales/PosPage';
import { DiscountsPage } from '@/features/pricing/DiscountsPage';
import { VatSettingsPage } from '@/features/pricing/VatSettingsPage';

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
            children: [{ path: 'pos', element: <PosPage /> }],
          },
          {
            element: <RequirePermission permission="shift.open" />,
            children: [{ path: 'shift', element: <ShiftPage /> }],
          },
          {
            element: <RequirePermission permission="shift.review" />,
            children: [{ path: 'shifts', element: <ShiftsAdminPage /> }],
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
            element: <RequirePermission permission="customer.select" />,
            children: [{ path: 'customers', element: <CustomersPage /> }],
          },
          {
            element: <RequirePermission permission="inventory.adjust.approve" />,
            children: [{ path: 'inventory/opening', element: <OpeningBalancePage /> }],
          },
          {
            element: <RequirePermission permission="inventory.view" />,
            children: [{ path: 'inventory/movements', element: <MovementsPage /> }],
          },
          {
            element: <RequirePermission permission="discount.manage" />,
            children: [{ path: 'discounts', element: <DiscountsPage /> }],
          },
          {
            element: <RequirePermission permission="settings.manage" />,
            children: [{ path: 'settings/vat', element: <VatSettingsPage /> }],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
