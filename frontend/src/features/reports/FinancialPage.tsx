import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { financialApi } from '@/lib/api/endpoints';
import type { FinancialPurchaseOrder, FinancialReport } from '@/lib/api/types';
import { formatRupiah } from '@/lib/format';
import { formatPurchaseOrderPaymentTerms } from '@/features/purchasing/paymentTerms';
import { currentMonthDateRange } from './financialPeriod';

function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());
}

export function FinancialPage() {
  const { can, me } = useAuth();
  const queryClient = useQueryClient();
  const canRecord = can('financial.transaction.create');
  const today = todayWib();
  const initialPeriod = currentMonthDateRange(today);
  const [filters, setFilters] = useState(initialPeriod);
  const [applied, setApplied] = useState(filters);
  const [printRequest, setPrintRequest] = useState<{ id: number; period: typeof filters } | null>(null);
  const printRequestId = useRef(0);
  const printedRequestId = useRef<number | null>(null);
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
  useEffect(() => {
    if (!printRequest) return;
    const handleAfterPrint = () => {
      printedRequestId.current = null;
      setPrintRequest(null);
    };
    window.addEventListener('afterprint', handleAfterPrint, { once: true });
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, [printRequest?.id]);

  useEffect(() => {
    if (!printRequest || printedRequestId.current === printRequest.id) return;
    if (report.isError) {
      setPrintRequest(null);
      return;
    }
    if (report.isFetching || !report.data
      || report.data.period.date_from !== printRequest.period.date_from
      || report.data.period.date_to !== printRequest.period.date_to) return;

    printedRequestId.current = printRequest.id;
    window.print();
  }, [printRequest, report.data, report.isError, report.isFetching]);
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
    const period = { ...filters };
    setApplied(period);
    setPrintRequest({ id: ++printRequestId.current, period });
  }

  function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    recordExpense.mutate();
  }

  const summary = report.data;

  const printSummary = printRequest
    && summary?.period.date_from === printRequest.period.date_from
    && summary.period.date_to === printRequest.period.date_to
    ? summary
    : null;

  return (
    <>
    <div className="financial-screen no-print space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Laporan Keuangan</h1>
      </header>

      <form onSubmit={applyFilters} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <Field label="Tanggal awal">
          <input className={inputCls} type="date" required value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        </Field>
        <Field label="Tanggal akhir">
          <input className={inputCls} type="date" required value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        </Field>
        <button type="submit" disabled={printRequest !== null} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60">
          {printRequest ? 'Menyiapkan PDF…' : 'Buat laporan'}
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
    {printSummary && <FinancialPrintSheet report={printSummary} storeName={me?.store?.name ?? ''} preparedBy={me?.user.name ?? ''} />}
    </>
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

// ---------------------------------------------------------------------------------------------
// Lembar cetak laporan keuangan (A4). Hanya tampil saat mencetak (kelas `print-only`); layar memakai `no-print`.
// Tidak memakai `.print-doc` karena kelas itu memberi garis pada setiap sel tabel, sedangkan laporan keuangan
// memakai garis tipis antar-baris, garis atas untuk subtotal, dan garis ganda untuk total akhir.
// ---------------------------------------------------------------------------------------------

/** Halaman bernama untuk laporan ini: A4, margin bawah lebih besar untuk nomor halaman (didukung Chromium; browser lain mengabaikannya). */
const REPORT_PAGE_CSS = `
@page financialReport {
  size: A4 portrait;
  margin: 16mm 16mm 18mm;
  @bottom-left { content: "Laporan Keuangan"; font-size: 8pt; color: #475569; }
  @bottom-right { content: "Halaman " counter(page) " dari " counter(pages); font-size: 8pt; color: #475569; }
}`;

type StatementRow =
  | { kind: 'heading'; label: string }
  | { kind: 'line'; label: string; cents: number; indent?: boolean }
  | { kind: 'subtotal'; label: string; cents: number }
  | { kind: 'total'; label: string; cents: number };

/** Angka uang dari server berupa string desimal; dijumlahkan dalam sen (bilangan bulat) agar subtotal tidak melenceng. */
function toCents(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Format akuntansi: pemisah ribuan id-ID, nilai negatif dalam kurung. Desimal hanya tampil bila ada sen di laporan. */
function statementAmount(cents: number, showCents: boolean): string {
  const digits = showCents ? 2 : 0;
  const text = new Intl.NumberFormat('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(cents) / 100);
  return cents < 0 ? `(${text})` : text;
}

/** "2026-11-01" -> "1 November 2026" (tanggal kalender murni, tanpa pergeseran zona waktu). */
function longDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

function periodLabel(period: FinancialReport['period']): string {
  return period.date_from === period.date_to
    ? longDate(period.date_from)
    : `${longDate(period.date_from)} s.d. ${longDate(period.date_to)}`;
}

function buildStatements(report: FinancialReport) {
  const { cash, profit } = report;
  const gross = toCents(profit.gross_profit);
  const operating = toCents(profit.operating_expenses);
  const payroll = toCents(profit.payroll_expenses);
  const returnLoss = toCents(profit.approved_return_losses);
  const net = toCents(profit.net_profit);
  const opening = toCents(cash.opening_balance);
  const cashIn = toCents(cash.cash_in);
  const cashOut = toCents(cash.cash_out);
  const closing = toCents(cash.closing_balance);
  const supplierPayments = toCents(report.supplier_payments);

  const incomeStatement: StatementRow[] = [
    { kind: 'line', label: 'Laba kotor penjualan', cents: gross },
    { kind: 'heading', label: 'Beban' },
    { kind: 'line', label: 'Biaya operasional', cents: operating, indent: true },
    { kind: 'line', label: 'Gaji karyawan', cents: payroll, indent: true },
    { kind: 'line', label: 'Kerugian write-off retur supplier', cents: returnLoss, indent: true },
    { kind: 'subtotal', label: 'Total beban', cents: operating + payroll + returnLoss },
    { kind: 'total', label: net < 0 ? 'RUGI BERSIH' : 'LABA BERSIH', cents: net },
  ];
  const cashFlow: StatementRow[] = [
    { kind: 'line', label: 'Saldo awal kas', cents: opening },
    { kind: 'line', label: 'Kas masuk', cents: cashIn, indent: true },
    { kind: 'line', label: 'Kas keluar', cents: -cashOut, indent: true },
    { kind: 'subtotal', label: 'Kenaikan (penurunan) kas bersih', cents: cashIn - cashOut },
    { kind: 'total', label: 'SALDO AKHIR KAS', cents: closing },
  ];

  const showCents = [gross, operating, payroll, returnLoss, net, opening, cashIn, cashOut, closing, supplierPayments]
    .some((cents) => cents % 100 !== 0);
  return { incomeStatement, cashFlow, supplierPayments, showCents };
}

function StatementTable({ rows, showCents }: { rows: StatementRow[]; showCents: boolean }) {
  return (
    <table className="w-full border-collapse text-[10.5pt]">
      <thead>
        <tr className="border-y border-black">
          <th className="py-1 pr-2 text-left font-semibold">Uraian</th>
          <th className="w-44 py-1 pl-2 text-right font-semibold">Jumlah (Rp)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          if (row.kind === 'heading') {
            return <tr key={row.label}><td colSpan={2} className="pb-0.5 pt-2 font-semibold">{row.label}</td></tr>;
          }
          const amount = statementAmount(row.cents, showCents);
          if (row.kind === 'line') {
            return (
              <tr key={row.label} className="border-b border-slate-300" style={{ breakInside: 'avoid' }}>
                <td className={`py-1 pr-2 ${row.indent ? 'pl-6' : ''}`}>{row.label}</td>
                <td className="py-1 pl-2 text-right tabular-nums">{amount}</td>
              </tr>
            );
          }
          if (row.kind === 'subtotal') {
            return (
              <tr key={row.label} className="border-t border-black font-semibold" style={{ breakInside: 'avoid' }}>
                <td className="py-1 pr-2">{row.label}</td>
                <td className="py-1 pl-2 text-right tabular-nums">{amount}</td>
              </tr>
            );
          }
          return (
            <tr key={row.label} className="font-bold" style={{ breakInside: 'avoid', borderTop: '1px solid #000', borderBottom: '3px double #000' }}>
              <td className="py-1.5 pr-2">{row.label}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{amount}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ReportSignatures({ preparedBy }: { preparedBy: string }) {
  const cells = [
    { role: 'Dibuat oleh', name: preparedBy },
    { role: 'Diperiksa oleh', name: '' },
    { role: 'Disetujui oleh (Owner)', name: '' },
  ];
  return (
    <section className="mt-10 text-center text-xs" style={{ breakInside: 'avoid' }}>
      <div className="grid grid-cols-3 gap-8">
        {cells.map((cell) => (
          <div key={cell.role}>
            <div className="font-medium">{cell.role}</div>
            <div className="h-20" />
            <div className="border-t border-black pt-1 font-medium">{cell.name || '(............................)'}</div>
            <div className="mt-1 text-[10px] text-slate-600">Tanggal: ....................</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinancialPrintSheet({ report, storeName, preparedBy }: { report: FinancialReport; storeName: string; preparedBy: string }) {
  const { incomeStatement, cashFlow, supplierPayments, showCents } = buildStatements(report);
  const [printedAt] = useState(() => new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date()));
  const period = periodLabel(report.period);

  return (
    <div className="print-only text-black" style={{ page: 'financialReport', fontSize: '11pt' }}>
      <style>{REPORT_PAGE_CSS}</style>
      <article>
        <header className="mb-5 text-center" style={{ borderBottom: '4px double #000', paddingBottom: '0.75rem' }}>
          {storeName && <div className="text-base font-bold uppercase tracking-wide">{storeName}</div>}
          <h1 className="mt-1 text-xl font-bold tracking-wide">LAPORAN KEUANGAN</h1>
          <p className="mt-1 text-sm">Periode {period}</p>
          <p className="text-xs">(Disajikan dalam Rupiah)</p>
        </header>

        <section className="mb-6">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">A. Laporan Laba Rugi</h2>
          <p className="mb-2 text-xs">Untuk periode {period}</p>
          <StatementTable rows={incomeStatement} showCents={showCents} />
        </section>

        <section className="mb-6">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">B. Laporan Arus Kas</h2>
          <p className="mb-2 text-xs">Akun kas: {report.cash.account_name} · periode {period}</p>
          <StatementTable rows={cashFlow} showCents={showCents} />
        </section>

        <section className="text-xs leading-5" style={{ breakInside: 'avoid' }}>
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">C. Catatan</h2>
          <ol className="list-decimal pl-5">
            <li>Laba bersih = laba kotor − biaya operasional − gaji karyawan − kerugian write-off retur supplier yang disetujui pada periode.</li>
            <li>Kas masuk dan kas keluar adalah total mutasi buku kas akun {report.cash.account_name} selama periode.</li>
            <li>Pembayaran PO kepada supplier selama periode: Rp {statementAmount(supplierPayments, showCents)}.</li>
            <li>Nilai dalam kurung menunjukkan pengurangan atau angka negatif.</li>
          </ol>
        </section>

        <ReportSignatures preparedBy={preparedBy} />

        <p className="mt-6 border-t border-slate-300 pt-1 text-[9pt] text-slate-600">
          Dicetak pada {printedAt} WIB{preparedBy ? ` oleh ${preparedBy}` : ''}.
        </p>
      </article>
    </div>
  );
}
