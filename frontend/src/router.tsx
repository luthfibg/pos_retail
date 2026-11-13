import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, createBrowserRouter } from 'react-router-dom';
import { RequireAnyPermission, RequireAnyRole, RequireAuth, RequirePermission, RequirePlatformOperator } from '@/features/auth/guards';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { HomeRedirect } from '@/pages/HomeRedirect';
import { NotFound } from '@/pages/NotFound';
import { ProductsPage } from '@/features/products/ProductsPage';
import { CategoriesPage } from '@/features/categories/CategoriesPage';
import { SuppliersPage } from '@/features/suppliers/SuppliersPage';
import { OpeningBalancePage } from '@/features/inventory/OpeningBalancePage';
import { MovementsPage } from '@/features/inventory/MovementsPage';
import { AdjustmentOpnamePage, AdjustmentOpnameRedirect } from '@/features/inventory/AdjustmentOpnamePage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { PosPage } from '@/features/sales/PosPage';
const SalesHistoryPage = lazy(() => import('@/features/sales/SalesHistoryPage').then((module) => ({ default: module.SalesHistoryPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })));
import { LEGACY_REDIRECTS, SETTINGS_PERMISSIONS } from '@/features/settings/settingsSections';
const ShiftPage = lazy(() => import('@/features/shifts/ShiftPage').then((module) => ({ default: module.ShiftPage })));
const ShiftsAdminPage = lazy(() => import('@/features/shifts/ShiftsAdminPage').then((module) => ({ default: module.ShiftsAdminPage })));
const DepositQueuePage = lazy(() => import('@/features/shifts/DepositQueuePage').then((module) => ({ default: module.DepositQueuePage })));
const AdjustmentsPage = lazy(() => import('@/features/inventory/AdjustmentsPage').then((module) => ({ default: module.AdjustmentsPage })));
const OpnamePage = lazy(() => import('@/features/inventory/OpnamePage').then((module) => ({ default: module.OpnamePage })));
const OpnameProcessPage = lazy(() => import('@/features/inventory/OpnameProcessPage').then((module) => ({ default: module.OpnameProcessPage })));
const TransfersPage = lazy(() => import('@/features/inventory/TransfersPage').then((module) => ({ default: module.TransfersPage })));
const GoodsReceiptsPage = lazy(() => import('@/features/purchasing/GoodsReceiptsPage').then((module) => ({ default: module.GoodsReceiptsPage })));
const SupplierReturnsPage = lazy(() => import('@/features/purchasing/SupplierReturnsPage').then((module) => ({ default: module.SupplierReturnsPage })));
const PurchasingEntryPage = lazy(() => import('@/features/purchasing/PurchaseBoardPage').then((module) => ({ default: module.PurchasingEntryPage })));
const DashboardPage = lazy(() => import('@/features/reports/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const BillingPage = lazy(() => import('@/features/billing/BillingPage').then((module) => ({ default: module.BillingPage })));
const FinancialPage = lazy(() => import('@/features/reports/FinancialPage').then((module) => ({ default: module.FinancialPage })));
const PlatformStoresPage = lazy(() => import('@/features/platform/PlatformStoresPage').then((module) => ({ default: module.PlatformStoresPage })));

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="p-6 text-slate-500">Memuat layar…</div>}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <RequirePlatformOperator />,
        children: [{ path: 'platform/stores', element: <LazyPage><PlatformStoresPage /></LazyPage> }],
      },
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
            children: [{ path: 'dashboard', element: <LazyPage><DashboardPage /></LazyPage> }],
          },
          {
            element: <RequirePermission permission="financial.report.view" />,
            children: [{ path: 'financial', element: <LazyPage><FinancialPage /></LazyPage> }],
          },
          {
            element: <RequireAnyPermission permissions={['billing_period.manage', 'invoice.generate']} />,
            children: [{ path: 'billing', element: <LazyPage><BillingPage /></LazyPage> }],
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
            element: <RequirePermission permission="inventory.opening_balance" />,
            children: [{ path: 'inventory/opening', element: <OpeningBalancePage /> }],
          },
          {
            path: 'inventory/adjustments',
            element: <AdjustmentOpnamePage />,
            children: [
              { index: true, element: <AdjustmentOpnameRedirect /> },
              {
                path: 'adjustment',
                element: <RequireAnyRole roles={['Admin', 'Owner', 'Kasir']} />,
                children: [{ index: true, element: <LazyPage><AdjustmentsPage /></LazyPage> }],
              },
              {
                path: 'opname',
                element: <RequirePermission permission="opname.view" />,
                children: [
                  { index: true, element: <LazyPage><OpnamePage /></LazyPage> },
                  { path: ':sessionId', element: <LazyPage><OpnameProcessPage /></LazyPage> },
                ],
              },
            ],
          },
          {
            element: <RequirePermission permission="stock_transfer.create" />,
            children: [{ path: 'inventory/transfers', element: <LazyPage><TransfersPage /></LazyPage> }],
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
            element: <RequireAnyPermission permissions={['supplier_return.create', 'inventory.adjust.approve']} />,
            children: [{ path: 'supplier-returns', element: <LazyPage><SupplierReturnsPage /></LazyPage> }],
          },
          {
            element: <RequireAnyPermission permissions={[
              'purchase_requisition.create',
              'purchase_requisition.finance_check',
              'purchase_requisition.approve',
              'purchase_order.create',
              'purchase_order.send',
            ]} />,
            children: [{ path: 'purchase-requisitions', element: <LazyPage><PurchasingEntryPage /></LazyPage> }],
          },
          {
            element: <RequireAnyPermission permissions={SETTINGS_PERMISSIONS} />,
            children: [{ path: 'settings', element: <LazyPage><SettingsPage /></LazyPage> }],
          },
          // Rute lama (bookmark, tautan) dialihkan ke bagian yang sesuai di layar Pengaturan.
          ...Object.entries(LEGACY_REDIRECTS).map(([from, id]) => ({
            path: from.slice(1),
            element: <Navigate to={`/settings#${id}`} replace />,
          })),
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
