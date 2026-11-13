import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { financialApi } from '@/lib/api/endpoints';
import type { FinancialPurchaseOrder } from '@/lib/api/types';
import { formatRupiah } from '@/lib/format';
import { formatPurchaseOrderPaymentTerms } from '@/features/purchasing/paymentTerms';

function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());
}

export function FinancialPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canRecord = can('financial.transaction.create');
  const today = todayWib();
  const [filters, setFilters] = useState({ date_from: today, date_to: today });
  const [applied, setApplied] = useState(filters);
  const [expense, setExpense] = useState({
    category: 'operational' as 'operational' | 'payroll',
    description: '',
    amount: '',
    paid_on: today,
  });
  const [paymentAmounts, setPaymentAmounts] = useState<Record<number, string>>({});
  const [poPage, setPoPage] = useState(1);
  const report = useQuery({
    queryKey: ['financial-report', applied],
    queryFn: () => financialApi.report(applied),
  });
  const purchaseOrders = useQuery({
    queryKey: ['financial-purchase-orders', poPage],
    queryFn: () => financialApi.purchaseOrders(poPage),
    enabled: canRecord,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['financial-report'] });
    void queryClient.invalidateQueries({ queryKey: ['financial-purchase-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  }

  const recordExpense = useMutation({
    mutationFn: () => financialApi.recordExpense({
      ...expense,
      description: expense.description.trim(),
    }),
    onSuccess: () => {
      setExpense({ category: 'operational', description: '', amount: '', paid_on: todayWib() });
      refresh();
    },
  });
  const recordPayment = useMutation({
    mutationFn: (po: FinancialPurchaseOrder) =>
      financialApi.recordPurchaseOrderPayment(po.id, { amount: paymentAmounts[po.id] ?? '' }),
    onSuccess: (_, po) => {
      setPaymentAmounts((current) => ({ ...current, [po.id]: '' }));
      refresh();
    },
  });

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (filters.date_from > filters.date_to) return;
    setApplied({ ...filters });
  }

  function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    recordExpense.mutate();
  }

  const summary = report.data;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Laporan Keuangan</h1>
        <button type="button" onClick={() => window.print()} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
          Cetak laporan
        </button>
      </header>

      <form onSubmit={applyFilters} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <Field label="Tanggal awal">
          <input className={inputCls} type="date" required value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        </Field>
        <Field label="Tanggal akhir">
          <input className={inputCls} type="date" required value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        </Field>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Buat laporan
        </button>
        {filters.date_from > filters.date_to && <p role="alert" className="text-sm text-red-700 sm:col-span-2">Tanggal awal harus sebelum tanggal akhir.</p>}
      </form>

      <ErrorNotice error={report.error} />
      {report.isLoading ? (
        <p className="text-sm text-slate-500">Memuat laporan…</p>
      ) : summary ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label={summary.cash.account_name} value={formatRupiah(summary.cash.closing_balance)} detail="Saldo akhir" />
            <SummaryCard label="Kas masuk" value={formatRupiah(summary.cash.cash_in)} detail={`Saldo awal ${formatRupiah(summary.cash.opening_balance)}`} />
            <SummaryCard label="Kas keluar" value={formatRupiah(summary.cash.cash_out)} detail={`Pembayaran PO ${formatRupiah(summary.supplier_payments)}`} />
            <SummaryCard label="Laba bersih" value={formatRupiah(summary.profit.net_profit)} detail={`Laba kotor ${formatRupiah(summary.profit.gross_profit)}`} />
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <SummaryCard label="Biaya operasional" value={formatRupiah(summary.profit.operating_expenses)} />
            <SummaryCard label="Gaji" value={formatRupiah(summary.profit.payroll_expenses)} />
            <SummaryCard label="Kerugian write-off retur" value={formatRupiah(summary.profit.approved_return_losses)} />
          </section>

        </>
      ) : null}

      {canRecord && (
        <section className="grid gap-5 xl:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold">Pembayaran PO</h2>
            <ErrorNotice error={purchaseOrders.error} />
            <ErrorNotice error={recordPayment.error} />
            {purchaseOrders.data?.data.length === 0 && <p className="text-sm text-slate-500">Tidak ada PO tertunggak.</p>}
            <div className="space-y-3">
              {purchaseOrders.data?.data.map((po) => (
                <form key={po.id} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); recordPayment.mutate(po); }}>
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">{po.doc_number} · {po.supplier_name}</div>
                    <div className="text-slate-600">Sisa {formatRupiah(po.amount_remaining)} · {formatPurchaseOrderPaymentTerms(po.payment_terms, po.payment_term_days)}</div>
                  </div>
                  <div className="flex gap-2">
                    <LocalDecimalInput
                      className={`${inputCls} min-w-0`}
                      kind="price"
                      required
                      aria-label={`Pembayaran ${po.doc_number}`}
                      value={paymentAmounts[po.id] ?? ''}
                      onChange={(value) => setPaymentAmounts((current) => ({ ...current, [po.id]: value }))}
                    />
                    <button disabled={recordPayment.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">Bayar</button>
                  </div>
                </form>
              ))}
            </div>
            {purchaseOrders.data && (
              <Pagination
                page={purchaseOrders.data.current_page}
                lastPage={purchaseOrders.data.last_page}
                from={purchaseOrders.data.from}
                to={purchaseOrders.data.to}
                total={purchaseOrders.data.total}
                onPage={setPoPage}
              />
            )}
          </div>

          <form onSubmit={submitExpense} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold">Catat biaya</h2>
            <ErrorNotice error={recordExpense.error} />
            <Field label="Jenis">
              <select className={inputCls} value={expense.category} onChange={(event) => setExpense({ ...expense, category: event.target.value as 'operational' | 'payroll' })}>
                <option value="operational">Biaya operasional</option>
                <option value="payroll">Gaji karyawan</option>
              </select>
            </Field>
            <Field label="Keterangan">
              <input className={inputCls} required maxLength={255} placeholder={expense.category === 'payroll' ? 'Nama karyawan · periode' : 'Contoh: listrik'} value={expense.description} onChange={(event) => setExpense({ ...expense, description: event.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Jumlah">
                <LocalDecimalInput className={inputCls} kind="price" required value={expense.amount} onChange={(amount) => setExpense({ ...expense, amount })} />
              </Field>
              <Field label="Tanggal dibayar">
                <input className={inputCls} type="date" max={today} required value={expense.paid_on} onChange={(event) => setExpense({ ...expense, paid_on: event.target.value })} />
              </Field>
            </div>
            <button disabled={recordExpense.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Simpan</button>
          </form>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {detail && <div className="mt-1 text-xs text-slate-500">{detail}</div>}
    </div>
  );
}
