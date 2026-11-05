import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getVisibleNavGroups } from '@/components/layout/nav';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { useAuth } from '@/features/auth/AuthProvider';
import { billingApi, inventoryApi, shiftApi, supplierReturnApi } from '@/lib/api/endpoints';
import type { BillingPeriod, Movement, Shift } from '@/lib/api/types';
import { formatQty, formatRupiah } from '@/lib/format';
import { milliToQty } from '@/lib/money';
import { summarizeCashierShifts, summarizeInventoryMovements, sumBillingPeriods } from './dashboardSummary';

interface DashboardMenuSummariesProps {
  applied: { dateFrom: string; dateTo: string };
}

interface Summary {
  value: string;
  detail: string;
}

interface SummaryCard {
  id: string;
  to: string;
  label: string;
  queryKey?: unknown[];
  load?: () => Promise<Summary>;
  summary?: Summary;
  pending?: boolean;
  error?: unknown;
}

async function loadMovements(dateFrom: string, dateTo: string): Promise<Movement[]> {
  const firstPage = await inventoryApi.movements({ date_from: dateFrom, date_to: dateTo, page: 1, per_page: 100 });
  const movements = [...firstPage.data];
  for (let page = 2; page <= firstPage.last_page; page++) {
    const result = await inventoryApi.movements({ date_from: dateFrom, date_to: dateTo, page, per_page: 100 });
    movements.push(...result.data);
  }
  return movements;
}

async function loadBillingPeriods(): Promise<BillingPeriod[]> {
  const firstPage = await billingApi.periods(1, 100);
  const periods = [...firstPage.data];
  for (let page = 2; page <= firstPage.last_page; page++) {
    const result = await billingApi.periods(page, 100);
    periods.push(...result.data);
  }
  return periods;
}

async function loadShifts(dateFrom: string, dateTo: string): Promise<Shift[]> {
  const firstPage = await shiftApi.list({ date_from: dateFrom, date_to: dateTo, page: 1, per_page: 100 });
  const shifts = [...firstPage.data];
  for (let page = 2; page <= firstPage.last_page; page++) {
    const result = await shiftApi.list({ date_from: dateFrom, date_to: dateTo, page, per_page: 100 });
    shifts.push(...result.data);
  }
  return shifts;
}

function amountFromCents(cents: bigint): string {
  return formatRupiah(`${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`);
}

function getLocalYearMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('Tanggal WIB untuk ringkasan tagihan tidak dapat ditentukan.');
  }
  return { year, month };
}

function SummaryCardView({
  card,
  summary,
  pending,
  error,
}: {
  card: SummaryCard;
  summary?: Summary;
  pending: boolean;
  error?: unknown;
}) {
  return (
    <Link
      to={card.to}
      className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-400"
    >
      <h2 className="text-sm font-medium text-slate-600">{card.label}</h2>
      {pending ? (
        <p role="status" className="mt-2 text-sm text-slate-500">Memuat…</p>
      ) : error ? (
        <div className="mt-2"><ErrorNotice error={error} /></div>
      ) : summary ? (
        <>
          <p className="mt-2 font-semibold text-slate-900">{summary.value}</p>
          <p className="mt-1 text-sm text-slate-500">{summary.detail}</p>
        </>
      ) : null}
    </Link>
  );
}

export function DashboardMenuSummaries({ applied }: DashboardMenuSummariesProps) {
  const { can } = useAuth();
  const isAdmin = can('shift.review');
  const visibleRoutes = useMemo(
    () => new Set(getVisibleNavGroups(can, isAdmin).flatMap((group) => group.items.map((item) => item.to))),
    [can, isAdmin],
  );
  const canViewBilling = visibleRoutes.has('/billing');
  const { year, month } = getLocalYearMonth();
  const billingQuery = useQuery({
    queryKey: ['dashboard', 'billing-periods'],
    queryFn: loadBillingPeriods,
    enabled: canViewBilling,
  });
  const periods = billingQuery.data ?? [];
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthPeriods = periods.filter(
    (period) => period.status !== 'cancelled' && period.period_month.startsWith(monthPrefix),
  );
  const yearPeriods = periods.filter(
    (period) => period.status !== 'cancelled' && period.period_month.startsWith(String(year)),
  );
  const cards: SummaryCard[] = [];

  if (visibleRoutes.has('/inventory/movements')) {
    cards.push({
      id: 'inventory-movements',
      to: '/inventory/movements',
      label: 'Barang Masuk & Keluar',
      queryKey: ['dashboard', 'inventory-movements', applied.dateFrom, applied.dateTo],
      load: async () => {
        const totals = summarizeInventoryMovements(await loadMovements(applied.dateFrom, applied.dateTo));
        const detail = `Nilai modal: masuk ${amountFromCents(totals.inboundCents)} · keluar ${amountFromCents(totals.outboundCents)}`;
        return {
          value: `Masuk ${formatQty(milliToQty(totals.inboundQtyMilli))} unit · Keluar ${formatQty(milliToQty(totals.outboundQtyMilli))} unit`,
          detail: totals.missingCostCount > 0
            ? `${detail} · HPP tidak tersedia untuk ${totals.missingCostCount} pergerakan`
            : detail,
        };
      },
    });
  }
  if (visibleRoutes.has('/shifts')) {
    cards.push({
      id: 'cashier-shifts',
      to: '/shifts',
      label: 'Laporan Kasir Jaga',
      queryKey: ['dashboard', 'cashier-shifts', applied.dateFrom, applied.dateTo],
      load: async () => {
        const totals = summarizeCashierShifts(await loadShifts(applied.dateFrom, applied.dateTo));
        const salesCents = totals.cashSalesCents + totals.creditSalesCents;
        return {
          value: `${totals.reportCount} laporan · total penjualan ${amountFromCents(salesCents)}`,
          detail: `Tunai ${amountFromCents(totals.cashSalesCents)} · kredit ${amountFromCents(totals.creditSalesCents)} · kas masuk ${amountFromCents(totals.cashInCents)} · kas keluar ${amountFromCents(totals.cashOutCents)}`,
        };
      },
    });
  }
  if (canViewBilling) {
    cards.push(
      {
        id: 'billing-month',
        to: '/billing',
        label: 'Tagihan Bulan Berjalan',
        summary: {
          value: amountFromCents(sumBillingPeriods(periods, year, month)),
          detail: `${monthPeriods.length} periode tagihan`,
        },
        pending: billingQuery.isPending,
        error: billingQuery.error,
      },
      {
        id: 'billing-year',
        to: '/billing',
        label: 'Tagihan Tahun Berjalan',
        summary: {
          value: amountFromCents(sumBillingPeriods(periods, year)),
          detail: `${yearPeriods.length} periode tagihan`,
        },
        pending: billingQuery.isPending,
        error: billingQuery.error,
      },
    );
  }
  if (visibleRoutes.has('/supplier-returns')) {
    cards.push({
      id: 'supplier-returns',
      to: '/supplier-returns',
      label: 'Retur Supplier',
      queryKey: ['dashboard', 'supplier-returns'],
      load: async () => {
        const returns = await supplierReturnApi.list({ page: 1, per_page: 1 });
        return { value: `${returns.total} retur`, detail: 'Jumlah seluruh retur supplier' };
      },
    });
  }

  const queryCards = cards.filter(
    (card): card is SummaryCard & { queryKey: unknown[]; load: () => Promise<Summary> } =>
      card.queryKey !== undefined && card.load !== undefined,
  );
  const queries = useQueries({
    queries: queryCards.map((card) => ({
      queryKey: card.queryKey,
      queryFn: card.load,
    })),
  });
  const queryById = new Map(queryCards.map((card, index) => [card.id, queries[index]]));

  return (
    <section aria-label="Ringkasan dashboard" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        const query = queryById.get(card.id);
        return (
          <SummaryCardView
            key={card.id}
            card={card}
            summary={card.summary ?? query?.data}
            pending={card.pending ?? query?.isPending ?? true}
            error={card.error ?? query?.error}
          />
        );
      })}
    </section>
  );
}
