import { lazy, Suspense, type ReactNode } from 'react';
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
import { PosPage } from '@/features/sales/PosPage';
const SalesHistoryPage = lazy(() => import('@/features/sales/SalesHistoryPage').then((module) => ({ default: module.SalesHistoryPage })));
import { DiscountsPage } from '@/features/pricing/DiscountsPage';
import { VatSettingsPage } from '@/features/pricing/VatSettingsPage';
const FloatPolicyPage = lazy(() => import('@/features/shifts/FloatPolicyPage').then((module) => ({ default: module.FloatPolicyPage })));
const ShiftPage = lazy(() => import('@/features/shifts/ShiftPage').then((module) => ({ default: module.ShiftPage })));
const ShiftsAdminPage = lazy(() => import('@/features/shifts/ShiftsAdminPage').then((module) => ({ default: module.ShiftsAdminPage })));
const DepositQueuePage = lazy(() => import('@/features/shifts/DepositQueuePage').then((module) => ({ default: module.DepositQueuePage })));
const GoodsReceiptsPage = lazy(() => import('@/features/purchasing/GoodsReceiptsPage').then((module) => ({ default: module.GoodsReceiptsPage })));

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="p-6 text-slate-500">Memuat layar…</div>}>{children}</Suspense>;
}

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
            children: [
              { path: 'pos', element: <PosPage /> },
              { path: 'sales', element: <LazyPage><SalesHistoryPage /></LazyPage> },
            ],
          },
          {
            element: <RequirePermission permission="shift.open" />,
            children: [{ path: 'shift', element: <LazyPage><ShiftPage /></LazyPage> }],
          },
          {
            element: <RequirePermission permission="shift.review" />,
            children: [{ path: 'shifts', element: <LazyPage><ShiftsAdminPage /></LazyPage> }],
          },
          {
            element: <RequirePermission permission="cash_deposit.receive" />,
            children: [{ path: 'cash-deposits', element: <LazyPage><DepositQueuePage /></LazyPage> }],
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
            element: <RequirePermission permission="goods_receipt.create" />,
            children: [{ path: 'goods-receipts', element: <LazyPage><GoodsReceiptsPage /></LazyPage> }],
          },
          {
            element: <RequirePermission permission="discount.manage" />,
            children: [{ path: 'discounts', element: <DiscountsPage /> }],
          },
          {
            element: <RequirePermission permission="settings.manage" />,
            children: [{ path: 'settings/vat', element: <VatSettingsPage /> }],
          },
          {
            element: <RequirePermission permission="float.configure" />,
            children: [{
              path: 'settings/float-policy',
              element: <LazyPage><FloatPolicyPage /></LazyPage>,
            }],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
