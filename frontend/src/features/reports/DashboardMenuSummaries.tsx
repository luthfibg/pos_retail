import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  billingApi,
  cashDepositApi,
  categoryApi,
  customerApi,
  goodsReceiptApi,
  inventoryApi,
  productApi,
  purchaseOrderApi,
  purchaseRequisitionApi,
  shiftApi,
  supplierApi,
  supplierReturnApi,
  userApi,
} from '@/lib/api/endpoints';
import type { DashboardReport, ProfitReport } from '@/lib/api/types';
import { formatRupiah } from '@/lib/format';
import { getVisibleNavGroups } from '@/components/layout/nav';
import { visibleSections } from '@/features/settings/settingsSections';
import type { DashboardFilterValues } from './dashboardFilters';

interface MenuSummary {
  value: string;
  detail: string;
}

interface SummaryCard {
  to: string;
  label: string;
  queryKey: unknown[];
  load: () => Promise<MenuSummary>;
}

interface DashboardMenuSummariesProps {
  report: DashboardReport | undefined;
  profit: ProfitReport | undefined;
  reportPending: boolean;
  profitPending: boolean;
  applied: DashboardFilterValues;
}

const numberFormat = new Intl.NumberFormat('id-ID');

function countLabel(value: number, noun: string): string {
  return `${numberFormat.format(value)} ${noun}`;
}

async function countStatuses<T extends { total: number }>(
  requests: Array<Promise<T>>,
): Promise<number> {
  const results = await Promise.all(requests);
  return results.reduce((total, result) => total + result.total, 0);
}

export function DashboardMenuSummaries({
  report,
  profit,
  reportPending,
  profitPending,
  applied,
}: DashboardMenuSummariesProps) {
  const { can } = useAuth();
  const isAdmin = can('shift.review');
  const visibleRoutes = new Set(
    getVisibleNavGroups(can, isAdmin).flatMap((group) => group.items.map((item) => item.to)),
  );
  const cards: SummaryCard[] = [];

  function add(
    to: string,
    label: string,
    queryKey: unknown[],
    load: () => Promise<MenuSummary>,
  ) {
    if (visibleRoutes.has(to)) cards.push({ to, label, queryKey, load });
  }

  add('/shift', 'Shift Saya', ['dashboard-menu', 'shift'], async () => {
    const shift = await shiftApi.current();
    if (!shift) return { value: 'Belum dibuka', detail: 'Buka shift untuk mulai berjualan.' };
    const status = shift.status === 'open' ? 'Sedang berjalan' : 'Sedang dihitung';
    return { value: status, detail: shift.doc_number };
  });

  add('/pos', 'Kasir', ['dashboard-menu', 'sales-today', applied.dateFrom, applied.dateTo, report?.sales.summary.net_sales], async () => ({
    value: report ? countLabel(report.sales.summary.transaction_count, 'transaksi') : '—',
    detail: report ? `Penjualan ${formatRupiah(report.sales.summary.net_sales)}` : 'Ringkasan penjualan hari ini.',
  }));
  add('/sales', 'Riwayat Penjualan', ['dashboard-menu', 'sales-history', applied.dateFrom, applied.dateTo, report?.sales.summary.net_sales], async () => ({
    value: report ? countLabel(report.sales.summary.transaction_count, 'transaksi') : '—',
    detail: report
      ? `${formatRupiah(report.sales.summary.net_sales)} pada periode terpilih`
      : 'Ringkasan penjualan pada periode terpilih.',
  }));

  add('/shifts', 'Tinjau Shift', ['dashboard-menu', 'shifts-to-review'], async () => {
    const shifts = await shiftApi.list({ status: 'closed', per_page: 1 });
    return { value: countLabel(shifts.total, 'shift'), detail: 'Menunggu ditinjau.' };
  });

  add('/cash-deposits', 'Setoran Masuk', ['dashboard-menu', 'deposits-to-process'], async () => {
    const total = await countStatuses([
      cashDepositApi.list({ status: 'submitted', per_page: 1 }),
      cashDepositApi.list({ status: 'discrepancy', per_page: 1 }),
    ]);
    return { value: countLabel(total, 'setoran'), detail: 'Perlu diproses atau dikoreksi.' };
  });

  add('/billing', 'Tagihan HRD', ['dashboard-menu', 'billing', can('billing_period.manage')], async () => {
    if (can('billing_period.manage')) {
      const period = await billingApi.currentPeriod();
      return period
        ? { value: period.label, detail: `${countLabel(period.sales_count, 'transaksi')} pada periode berjalan.` }
        : { value: 'Belum ada periode aktif', detail: 'Buka periode tagihan untuk mulai mencatat.' };
    }
    const invoices = await billingApi.invoices('issued', 1);
    return { value: countLabel(invoices.total, 'tagihan'), detail: 'Menunggu proses pembayaran.' };
  });

  add('/purchase-requisitions', 'Permintaan Pembelian', ['dashboard-menu', 'purchase-requisitions'], async () => {
    const canSeeAll = can('purchase_requisition.finance_check')
      || can('purchase_requisition.approve')
      || can('purchase_order.create')
      || can('purchase_order.send');
    let statuses: Array<'submitted' | 'finance_checked' | 'approved' | 'draft' | 'returned'>;
    let detail: string;
    if (can('purchase_requisition.finance_check')) {
      statuses = ['submitted'];
      detail = 'Menunggu pemeriksaan Finance.';
    } else if (can('purchase_requisition.approve')) {
      statuses = ['finance_checked'];
      detail = 'Menunggu persetujuan.';
    } else if (can('purchase_order.create') || can('purchase_order.send')) {
      statuses = ['approved'];
      detail = 'Siap diproses menjadi pesanan.';
    } else {
      statuses = ['draft', 'returned'];
      detail = 'Draft atau perlu diperbaiki.';
    }
    const prCount = await countStatuses(statuses.map((status) =>
      purchaseRequisitionApi.list({ status, mine: !canSeeAll, per_page: 1 }),
    ));
    let extra = '';
    if (can('goods_receipt.create')) {
      const orders = await purchaseOrderApi.receivable({ per_page: 1 });
      extra = ` · ${countLabel(orders.total, 'pesanan siap diterima')}`;
    } else if (can('purchase_order.create') || can('purchase_order.send')) {
      const orders = await purchaseOrderApi.list({ status: 'pending_confirmation', per_page: 1 });
      extra = ` · ${countLabel(orders.total, 'pesanan menunggu konfirmasi')}`;
    }
    return { value: countLabel(prCount, 'permintaan'), detail: `${detail}${extra}` };
  });

  add('/goods-receipts', 'Penerimaan Barang', ['dashboard-menu', 'goods-receipts'], async () => {
    const [ready, documents] = await Promise.all([
      goodsReceiptApi.list({ status: 'checked', per_page: 1 }),
      goodsReceiptApi.list({ document_status: 'pending', per_page: 1 }),
    ]);
    return {
      value: countLabel(ready.total, 'penerimaan siap diposting'),
      detail: `${countLabel(documents.total, 'dokumen')} menunggu verifikasi.`,
    };
  });

  add('/supplier-returns', 'Retur Supplier', ['dashboard-menu', 'supplier-returns'], async () => {
    const total = await countStatuses([
      supplierReturnApi.list({ status: 'submitted', per_page: 1 }),
      supplierReturnApi.list({ status: 'accepted', per_page: 1 }),
    ]);
    return { value: countLabel(total, 'retur'), detail: 'Menunggu keputusan atau barang pengganti.' };
  });

  add('/inventory/opening', 'Stok Awal', ['dashboard-menu', 'opening-stock', report?.inventory.counts.low_stock], async () => ({
    value: report ? countLabel(report.inventory.counts.low_stock, 'produk menipis') : '—',
    detail: 'Periksa kebutuhan stok toko.',
  }));
  add('/inventory/transfers', 'Transfer Stok', ['dashboard-menu', 'stock-transfers'], async () => {
    const transfers = await inventoryApi.transfers({ status: 'draft', page: 1, per_page: 1 });
    return { value: countLabel(transfers.total, 'transfer'), detail: 'Draft yang belum diposting.' };
  });
  add('/inventory/adjustments', 'Adjustment & Opname', ['dashboard-menu', 'stock-adjustments'], async () => {
    const adjustments = await inventoryApi.adjustments({ status: 'requested', page: 1, per_page: 1 });
    return { value: countLabel(adjustments.total, 'pengajuan'), detail: 'Menunggu persetujuan.' };
  });
  add('/inventory/movements', 'Riwayat Stok', ['dashboard-menu', 'stock-movements', applied.dateFrom, applied.dateTo], async () => {
    const movements = await inventoryApi.movements({
      date_from: applied.dateFrom,
      date_to: applied.dateTo,
      page: 1,
      per_page: 1,
    });
    return { value: countLabel(movements.total, 'pergerakan'), detail: 'Pada periode terpilih.' };
  });

  add('/categories', 'Kategori', ['dashboard-menu', 'categories'], async () => {
    const categories = await categoryApi.list(true);
    return { value: countLabel(categories.length, 'kategori aktif'), detail: 'Kelola pengelompokan produk.' };
  });
  add('/products', 'Produk', ['dashboard-menu', 'products'], async () => {
    const [all, pending] = await Promise.all([
      productApi.list({ per_page: 1 }),
      productApi.list({ status: 'pending_price', per_page: 1 }),
    ]);
    return { value: countLabel(all.total, 'produk'), detail: `${countLabel(pending.total, 'belum punya harga jual')}.` };
  });
  add('/suppliers', 'Supplier', ['dashboard-menu', 'suppliers'], async () => {
    const suppliers = await supplierApi.list({ active_only: true, per_page: 1 });
    return { value: countLabel(suppliers.total, 'supplier aktif'), detail: 'Kelola data pemasok.' };
  });
  add('/customers', 'Karyawan', ['dashboard-menu', 'customers', can('customer.verify')], async () => {
    const active = await customerApi.list({ status: 'active', per_page: 1 });
    if (!can('customer.verify')) {
      return { value: countLabel(active.total, 'karyawan aktif'), detail: 'Tersedia untuk transaksi.' };
    }
    const pending = await customerApi.list({ status: 'pending_verification', per_page: 1 });
    return {
      value: countLabel(pending.total, 'menunggu verifikasi'),
      detail: `${countLabel(active.total, 'karyawan aktif')}.`,
    };
  });

  const settingsCount = visibleSections(can).length;
  add('/settings', 'Pengaturan', ['dashboard-menu', 'settings', settingsCount], async () => ({
    value: countLabel(settingsCount, 'bagian tersedia'),
    detail: can('user.manage')
      ? `${countLabel((await userApi.list({ status: 'active', page: 1 })).total, 'akun aktif')} · konfigurasi toko yang dapat Anda kelola.`
      : 'Konfigurasi toko yang dapat Anda kelola.',
  }));

  const queries = useQueries({
    queries: cards.map((card) => ({
      queryKey: card.queryKey,
      queryFn: card.load,
      staleTime: 60_000,
    })),
  });

  return (
    <section aria-label="Ringkasan menu" className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Ringkasan menu</h2>
        <p className="text-sm text-slate-500">Ringkasan ditampilkan sesuai menu yang dapat Anda akses.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card, index) => {
          const query = queries[index];
          if (!query) return null;
          return (
            <Link
              key={card.to}
              to={card.to}
              className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <h3 className="font-semibold">{card.label}</h3>
              {query.isPending ? (
                <p role="status" className="mt-2 text-sm text-slate-500">Memuat ringkasan…</p>
              ) : query.error ? (
                <div className="mt-2"><ErrorNotice error={query.error} /></div>
              ) : (
                <>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{query.data?.value ?? '—'}</p>
                  <p className="mt-1 text-sm text-slate-500">{query.data?.detail ?? ''}</p>
                </>
              )}
              {reportPending && ['/pos', '/sales', '/inventory/opening'].includes(card.to) && (
                <p role="status" className="mt-2 text-xs text-slate-500">Memuat data laporan…</p>
              )}
              {card.to === '/pos' && report && !profitPending && profit && (
                <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
                  Laba diterima {formatRupiah(profit.valid_profit)} · Belum diterima {formatRupiah(profit.expected_profit)}
                </p>
              )}
              {card.to === '/sales' && (
                <p className="mt-1 text-xs text-slate-500">{applied.dateFrom} – {applied.dateTo}</p>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
