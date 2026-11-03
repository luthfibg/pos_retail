import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportApi } from '@/lib/api/endpoints';
import { formatDate, formatQty, formatRupiah } from '@/lib/format';
import { useAuth } from '@/features/auth/AuthProvider';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import type { ProfitReport } from '@/lib/api/types';
import { chartHeight, profitComposition, validateDashboardFilters, type DashboardFilterValues } from './dashboardFilters';
import { DashboardMenuSummaries } from './DashboardMenuSummaries';

function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());
}

function amountLabel(value: string): string {
  return formatRupiah(value);
}

export function DashboardPage() {
  const { can } = useAuth();
  const canReviewShifts = can('shift.review');
  const canViewProfit = can('reports.profit.view');
  const today = todayWib();
  const [filters, setFilters] = useState<DashboardFilterValues>({
    dateFrom: today,
    dateTo: today,
    cashierId: '',
  });
  const [applied, setApplied] = useState({ dateFrom: today, dateTo: today, cashierId: '' });
  const [filterError, setFilterError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['reports', 'dashboard', applied],
    queryFn: () => reportApi.dashboard({
      date_from: applied.dateFrom,
      date_to: applied.dateTo,
      ...(canReviewShifts && applied.cashierId ? { cashier_id: Number(applied.cashierId) } : {}),
    }),
  });
  const profitQuery = useQuery({
    queryKey: ['reports', 'profit', applied.dateFrom, applied.dateTo],
    queryFn: () => reportApi.profit({
      date_from: applied.dateFrom,
      date_to: applied.dateTo,
    }),
    enabled: canViewProfit,
  });

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateDashboardFilters({ ...filters, cashierId: canReviewShifts ? filters.cashierId : '' });
    setFilterError(error);
    if (error) return;
    setApplied({
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      cashierId: canReviewShifts ? filters.cashierId : '',
    });
  }

  const report = query.data;
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Ringkasan menu yang tersedia untuk akun Anda.</p>
      </header>

      <form onSubmit={applyFilters} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
        <Field label="Tanggal awal">
          <input className={inputCls} type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} />
        </Field>
        <Field label="Tanggal akhir">
          <input className={inputCls} type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} />
        </Field>
        {canReviewShifts && (
          <Field label="ID kasir" hint="Kosongkan untuk melihat seluruh kasir.">
            <input
              className={inputCls}
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={filters.cashierId}
              onChange={(event) => setFilters({ ...filters, cashierId: event.target.value })}
              placeholder="Semua kasir"
            />
          </Field>
        )}
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Terapkan
        </button>
        {filterError && <p role="alert" className="text-sm text-red-700 sm:col-span-2 lg:col-span-full">{filterError}</p>}
      </form>

      <ErrorNotice error={query.error} />
      {canViewProfit && <ErrorNotice error={profitQuery.error} />}
      {canViewProfit && canReviewShifts && applied.cashierId && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
          Laba mencakup semua kasir di toko; filter kasir hanya berlaku untuk ringkasan penjualan dan kas.
        </p>
      )}
      <DashboardMenuSummaries
        report={report}
        profit={profitQuery.data}
        reportPending={query.isPending}
        profitPending={profitQuery.isPending}
        applied={applied}
      />
      {query.isPending ? (
        <p role="status" className="py-8 text-center text-sm text-slate-500">Memuat dashboard…</p>
      ) : report ? (
        <details className="rounded-lg border border-slate-200 bg-white p-4" aria-busy={query.isFetching}>
          <summary className="cursor-pointer font-semibold">Rincian penjualan, kas, persediaan, dan laba</summary>
          <div className="mt-4 space-y-6">
          {canViewProfit && (
            <section aria-label="Laporan laba kotor" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
              <div>
                <h2 className="text-lg font-semibold">Laporan Laba/Rugi (Gross Profit)</h2>
                <p className="text-sm text-slate-500">
                  {profitQuery.data
                    ? `${formatDate(profitQuery.data.period.date_from)} – ${formatDate(profitQuery.data.period.date_to)}`
                    : `${formatDate(applied.dateFrom)} – ${formatDate(applied.dateTo)}`}
                  {' · '}Pendapatan setelah diskon, sebelum PPN, dikurangi HPP snapshot.
                </p>
              </div>
              {profitQuery.isPending ? (
                <p role="status" className="py-4 text-sm text-slate-500">Memuat laporan laba…</p>
              ) : profitQuery.data ? (
                <ProfitSummary report={profitQuery.data} />
              ) : null}
            </section>
          )}

          <section className="grid gap-6 xl:grid-cols-2">
            <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">Penjualan harian</h2>
                  <p className="text-sm text-slate-500">{formatDate(report.period.date_from)} – {formatDate(report.period.date_to)}</p>
                </div>
                <p className="text-sm text-slate-600">Bruto {amountLabel(report.sales.summary.gross_sales)}</p>
              </div>
              {report.sales.summary.transaction_count === 0 ? (
                <p className="py-12 text-center text-sm text-slate-500">Belum ada transaksi pada periode ini.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <div className="flex min-w-max items-end gap-2 border-b border-slate-200 px-1 pt-2">
                    {report.sales.daily.map((day) => {
                      const height = chartHeight(day.net_sales, report.sales.summary.net_sales);
                      return (
                        <div key={day.date} className="flex w-12 flex-col items-center gap-2" title={`${formatDate(day.date)}: ${amountLabel(day.net_sales)}`}>
                          <span className="text-[10px] text-slate-500">{day.transaction_count || ''}</span>
                          <div className="flex h-36 w-full items-end">
                            <div
                              className={`w-full rounded-t-sm ${height > 0 ? 'bg-slate-800' : 'bg-slate-100'}`}
                              style={{ height: `${height || 2}%` }}
                              aria-label={`${formatDate(day.date)} ${amountLabel(day.net_sales)}`}
                            />
                          </div>
                          <span className="pb-2 text-[10px] text-slate-600">{new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${day.date}T00:00:00Z`))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
                <div><dt className="text-slate-500">Diskon</dt><dd className="font-medium">{amountLabel(report.sales.summary.discount_total)}</dd></div>
                <div><dt className="text-slate-500">PPN</dt><dd className="font-medium">{amountLabel(report.sales.summary.tax_amount)}</dd></div>
              </dl>
            </article>

            <article className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="font-semibold">Ringkasan kas</h2>
              <p className="mb-3 text-sm text-slate-500">Periode laporan terpilih</p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Metric label="Kas masuk" value={amountLabel(report.cash.movements.cash_in)} />
                <Metric label="Kas keluar" value={amountLabel(report.cash.movements.cash_out)} />
                <Metric label="Setoran dihitung" value={amountLabel(report.cash.deposits.counted_amount)} />
                <Metric label="Setoran diterima" value={amountLabel(report.cash.deposits.received_amount)} />
                <Metric label="Setoran final / diajukan" value={amountLabel(report.cash.deposits.settled_amount)} />
                <Metric label="Penjualan potong gaji" value={amountLabel(report.cash.sales.payroll_credit)} />
              </dl>
              {canReviewShifts && report.cash.fund_balances.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-semibold">Saldo akun dana saat ini</h3>
                  <ul className="divide-y divide-slate-100 text-sm">
                    {report.cash.fund_balances.map((fund) => (
                      <li key={fund.id} className="flex justify-between gap-3 py-2">
                        <span>{fund.name}</span><span className="font-medium">{amountLabel(fund.balance)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Stok menipis</h2>
                  <p className="text-sm text-slate-500">{report.inventory.counts.low_stock} produk di bawah batas minimum</p>
                </div>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-sm font-medium text-amber-800">{report.inventory.counts.low_stock}</span>
              </div>
              {report.inventory.low_stock.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Tidak ada produk dengan stok menipis.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-slate-500"><tr><th className="py-2 pr-3">Produk</th><th className="py-2 pr-3">Stok</th><th className="py-2">Status</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.inventory.low_stock.map((item) => (
                        <tr key={item.product_id}>
                          <td className="py-2 pr-3"><span className="block font-medium">{item.name}</span><span className="text-xs text-slate-500">{item.sku}</span></td>
                          <td className="whitespace-nowrap py-2 pr-3">{formatQty(item.qty_sellable)} {item.unit_name}<span className="block text-xs text-slate-500">Min. {formatQty(item.min_stock)}</span></td>
                          <td className="py-2"><StockBadge status={item.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>

            <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Batch mendekati kedaluwarsa</h2>
                  <p className="text-sm text-slate-500">Termasuk stok kedaluwarsa yang masih tercatat.</p>
                </div>
                <span className="rounded-full bg-red-50 px-2.5 py-1 text-sm font-medium text-red-800">{report.inventory.counts.expiring_batches}</span>
              </div>
              {report.inventory.expiring_batches.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Tidak ada batch yang mendekati kedaluwarsa.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-slate-500"><tr><th className="py-2 pr-3">Produk / batch</th><th className="py-2 pr-3">Kedaluwarsa</th><th className="py-2">Stok</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.inventory.expiring_batches.map((item) => (
                        <tr key={item.balance_id}>
                          <td className="py-2 pr-3"><span className="block font-medium">{item.name}</span><span className="text-xs text-slate-500">{item.batch_code || `Batch #${item.batch_id}`}</span></td>
                          <td className="whitespace-nowrap py-2 pr-3"><span className="block">{formatDate(item.expiry_date)}</span><ExpiryBadge status={item.status} days={item.days_to_expiry} /></td>
                          <td className="whitespace-nowrap py-2">{formatQty(item.qty_sellable)} {item.unit_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </section>
          <p className="text-xs text-slate-500">Ambang peringatan kedaluwarsa toko: {report.inventory.warning_days} hari. Data inventori menunjukkan kondisi stok saat ini.</p>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ProfitSummary({ report }: { report: ProfitReport }) {
  const contribution = profitComposition(report.valid_profit, report.expected_profit);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4">
          <h3 className="text-sm font-medium text-emerald-900">Laba kotor diterima</h3>
          <p className="mt-1 text-2xl font-semibold text-emerald-950">{amountLabel(report.valid_profit)}</p>
          <p className="mt-1 text-xs text-emerald-900">Tunai + bagian laba kredit HRD yang sudah dibayar.</p>
        </article>
        <article className="rounded-md border border-amber-200 bg-amber-50/70 p-4">
          <h3 className="text-sm font-medium text-amber-900">Laba kotor belum diterima</h3>
          <p className="mt-1 text-2xl font-semibold text-amber-950">{amountLabel(report.expected_profit)}</p>
          <p className="mt-1 text-xs text-amber-900">Bagian laba kredit HRD yang belum tervalidasi pembayaran.</p>
        </article>
        <article className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-medium text-slate-700">Total laba kotor</h3>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{amountLabel(report.total_gross_profit)}</p>
          <p className="mt-1 text-xs text-slate-600">Valid + expected.</p>
        </article>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="rounded-md border border-slate-200 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">Komposisi laba</h3>
            <p className="text-xs text-slate-500">Berdasarkan status pembayaran</p>
          </div>
          {contribution ? (
            <>
              <div
                className="mt-3 flex h-5 overflow-hidden rounded-full bg-slate-100"
                role="img"
                aria-label={`Komposisi laba: valid ${amountLabel(report.valid_profit)}, expected ${amountLabel(report.expected_profit)}`}
              >
                {contribution.valid > 0 && <div className="bg-emerald-600" style={{ width: `${contribution.valid}%` }} />}
                {contribution.expected > 0 && <div className="bg-amber-400" style={{ width: `${contribution.expected}%` }} />}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-emerald-600" />Valid {contribution.valid}%</span>
                <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-amber-400" />Expected {contribution.expected}%</span>
              </div>
            </>
          ) : (
            <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              Komposisi persentase tidak ditampilkan karena total laba nol/negatif atau terdapat nilai laba negatif. Nilai valid dan expected tetap ditampilkan terpisah di atas.
            </p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
            <Metric label="Pendapatan (setelah diskon, sebelum PPN)" value={amountLabel(report.sales_revenue)} />
            <Metric label="HPP barang terjual" value={amountLabel(report.cost_of_goods_sold)} />
          </dl>
        </div>

        <div className="rounded-md border border-slate-200 p-4">
          <h3 className="font-semibold">Rincian menurut pembayaran</h3>
          <dl className="mt-3 space-y-3 text-sm">
            <div className="rounded-md bg-slate-50 p-3">
              <dt className="font-medium">Penjualan tunai kasir</dt>
              <dd className="mt-1 flex justify-between gap-3"><span className="text-slate-500">Laba kotor diterima</span><span className="font-medium">{amountLabel(report.by_payment_mode.cash.valid_profit)}</span></dd>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <dt className="font-medium">Penjualan potong gaji</dt>
              <dd className="mt-1 flex justify-between gap-3"><span className="text-slate-500">Laba kotor diterima</span><span className="font-medium">{amountLabel(report.by_payment_mode.payroll_credit.valid_profit)}</span></dd>
              <dd className="mt-1 flex justify-between gap-3"><span className="text-slate-500">Laba kotor belum diterima</span><span className="font-medium">{amountLabel(report.by_payment_mode.payroll_credit.expected_profit)}</span></dd>
            </div>
          </dl>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Pembayaran invoice diperhitungkan sampai akhir tanggal akhir laporan. Ini laba kotor: belum dikurangi biaya operasional atau kerugian retur/write-off.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>;
}

function StockBadge({ status }: { status: string }) {
  const label: Record<string, string> = { habis: 'Habis', kritis: 'Kritis', hampir_habis: 'Hampir habis', aman: 'Aman' };
  return <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">{label[status] ?? status}</span>;
}

function ExpiryBadge({ status, days }: { status: string; days: number }) {
  const text = status === 'kedaluwarsa' ? `Lewat ${Math.abs(days)} hari` : status === 'hari_ini' ? 'Hari ini' : `${days} hari lagi`;
  const style = status === 'kedaluwarsa' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{text}</span>;
}
