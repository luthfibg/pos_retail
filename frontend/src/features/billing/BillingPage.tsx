import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { billingApi } from '@/lib/api/endpoints';
import type { BillingPeriod, Invoice, InvoiceStatus } from '@/lib/api/types';
import { formatDate, formatDateTime, formatRupiah } from '@/lib/format';
import { buildPaymentInput, validatePayment, type PaymentValues } from './billingForm';

const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Diterbitkan',
  handed_to_hr: 'Diserahkan ke HRD',
  partially_paid: 'Dibayar sebagian',
  paid: 'Lunas',
  cancelled: 'Dibatalkan',
};
const PERIOD_STATUS_LABEL = { open: 'Terbuka', closed: 'Ditutup', invoiced: 'Sudah dibuatkan invoice' } as const;
const INITIAL_PAYMENT: PaymentValues = { amount: '', receivedOn: '', reference: '', note: '' };

export function BillingPage() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const canManagePeriod = can('billing_period.manage');
  const canClosePeriod = can('billing_period.close');
  const canGenerateInvoice = can('invoice.generate');
  const canIssueInvoice = can('invoice.issue');
  const canRecordPayment = can('invoice.record_payment');
  const [periodPage, setPeriodPage] = useState(1);
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus | ''>('');
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [newPeriodLabel, setNewPeriodLabel] = useState('');
  const [newPeriodDate, setNewPeriodDate] = useState('');
  const [billTo, setBillTo] = useState('HRD');
  const [paymentValues, setPaymentValues] = useState(INITIAL_PAYMENT);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [printInvoice, setPrintInvoice] = useState<Invoice | null>(null);
  const clearPrintInvoice = useCallback(() => setPrintInvoice(null), []);

  const periods = useQuery({
    queryKey: ['billing-periods', periodPage],
    queryFn: () => billingApi.periods(periodPage),
    enabled: canManagePeriod,
  });
  const currentPeriod = useQuery({
    queryKey: ['billing-periods', 'current'],
    queryFn: billingApi.currentPeriod,
    enabled: canManagePeriod,
  });
  const periodDetail = useQuery({
    queryKey: ['billing-period', selectedPeriodId],
    queryFn: () => billingApi.period(selectedPeriodId!),
    enabled: canManagePeriod && selectedPeriodId !== null,
  });
  const invoices = useQuery({
    queryKey: ['invoices', invoiceStatus, invoicePage],
    queryFn: () => billingApi.invoices(invoiceStatus, invoicePage),
    enabled: canGenerateInvoice,
  });
  const invoiceDetail = useQuery({
    queryKey: ['invoice', selectedInvoiceId],
    queryFn: () => billingApi.invoice(selectedInvoiceId!),
    enabled: canGenerateInvoice && selectedInvoiceId !== null,
  });

  const refreshBilling = () => {
    void qc.invalidateQueries({ queryKey: ['billing-periods'] });
    void qc.invalidateQueries({ queryKey: ['billing-period'] });
    void qc.invalidateQueries({ queryKey: ['invoices'] });
    void qc.invalidateQueries({ queryKey: ['invoice'] });
  };
  const openPeriod = useMutation({
    mutationFn: () => billingApi.openPeriod({
      ...(newPeriodLabel.trim() ? { label: newPeriodLabel.trim() } : {}),
      ...(newPeriodDate ? { scheduled_close_date: newPeriodDate } : {}),
    }),
    onSuccess: (period) => {
      refreshBilling();
      setSelectedPeriodId(period.id);
      setNewPeriodLabel('');
      setNewPeriodDate('');
    },
  });
  const updatePeriod = useMutation({
    mutationFn: (input: { id: number; label: string; date: string }) =>
      billingApi.updatePeriod(input.id, {
        label: input.label.trim(),
        scheduled_close_date: input.date || null,
      }),
    onSuccess: refreshBilling,
  });
  const closePeriod = useMutation({
    mutationFn: (id: number) => billingApi.closePeriod(id),
    onSuccess: refreshBilling,
  });
  const generateInvoice = useMutation({
    mutationFn: (periodId: number) => billingApi.generateInvoice(periodId, { bill_to: billTo.trim() || 'HRD' }),
    onSuccess: (invoice) => {
      refreshBilling();
      setSelectedInvoiceId(invoice.id);
    },
  });
  const issueInvoice = useMutation({
    mutationFn: (id: number) => billingApi.issueInvoice(id),
    onSuccess: refreshBilling,
  });
  const handOverInvoice = useMutation({
    mutationFn: (id: number) => billingApi.handOverInvoice(id),
    onSuccess: refreshBilling,
  });
  const recordPayment = useMutation({
    mutationFn: (input: { id: number; values: PaymentValues }) =>
      billingApi.recordPayment(input.id, buildPaymentInput(input.values)),
    onSuccess: () => {
      setPaymentValues(INITIAL_PAYMENT);
      setPaymentError(null);
      refreshBilling();
    },
  });

  function submitOpenPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openPeriod.mutate();
  }

  function submitPayment(event: FormEvent<HTMLFormElement>, invoice: Invoice) {
    event.preventDefault();
    const error = validatePayment(paymentValues, invoice.amount_remaining);
    setPaymentError(error);
    if (error) return;
    recordPayment.mutate({ id: invoice.id, values: paymentValues });
  }

  const selectedPeriod = periodDetail.data;
  const invoice = invoiceDetail.data;

  return (
    <>
      <div className="billing-screen no-print space-y-6 p-4 sm:p-6">
        <header>
          <h1 className="text-2xl font-semibold">Tagihan HRD</h1>
          <p className="mt-1 text-sm text-slate-600">Kelola periode kredit karyawan, terbitkan invoice, dan catat pembayaran HRD.</p>
        </header>

        {(canManagePeriod || canClosePeriod) && (
          <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Periode tagihan</h2>
                <p className="text-sm text-slate-500">Penutupan mengikat struk kredit ke periode ini dan otomatis membuka periode berikutnya.</p>
              </div>
              {currentPeriod.data && <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">Periode aktif</span>}
            </div>
            <ErrorNotice error={currentPeriod.error} />
            {currentPeriod.isLoading ? (
              <p className="text-sm text-slate-500">Memuat periode aktif…</p>
            ) : currentPeriod.data ? (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-slate-50 p-4">
                <div>
                  <p className="font-medium">{currentPeriod.data.label}</p>
                  <p className="mt-1 text-sm text-slate-600">{currentPeriod.data.sales_count} struk kredit · {formatRupiah(currentPeriod.data.sales_total)}</p>
                  <p className="mt-1 text-xs text-slate-500">Tanggal gaji: {currentPeriod.data.scheduled_close_date ? formatDate(currentPeriod.data.scheduled_close_date) : 'Belum ditentukan'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setSelectedPeriodId(currentPeriod.data!.id)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-white">Rincian periode</button>
                  {canClosePeriod && (
                    <button
                      type="button"
                      disabled={closePeriod.isPending}
                      onClick={() => {
                        if (window.confirm(`Tutup "${currentPeriod.data!.label}"? Struk kredit yang terikat tidak dapat dipindah dan periode berikutnya akan otomatis dibuka.`)) {
                          closePeriod.mutate(currentPeriod.data!.id);
                        }
                      }}
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
                    >{closePeriod.isPending ? 'Menutup…' : 'Tutup periode'}</button>
                  )}
                </div>
              </div>
            ) : currentPeriod.error ? null : canManagePeriod ? (
              <form onSubmit={submitOpenPeriod} className="grid gap-3 rounded-md bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                <p className="text-sm text-slate-600 sm:col-span-2 lg:col-span-3">Belum ada periode terbuka. Buka periode untuk menampung transaksi kredit potong gaji.</p>
                <Field label="Nama periode (opsional)">
                  <input className={inputCls} maxLength={40} value={newPeriodLabel} onChange={(event) => setNewPeriodLabel(event.target.value)} placeholder="Contoh: Gaji Oktober" />
                </Field>
                <Field label="Tanggal gaji HRD (opsional)">
                  <input className={inputCls} type="date" value={newPeriodDate} onChange={(event) => setNewPeriodDate(event.target.value)} />
                </Field>
                <button type="submit" disabled={openPeriod.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {openPeriod.isPending ? 'Membuka…' : 'Buka periode'}
                </button>
              </form>
            ) : (
              <p className="text-sm text-slate-500">Tidak ada periode terbuka.</p>
            )}
            <ErrorNotice error={openPeriod.error ?? closePeriod.error} />
            <ErrorNotice error={periods.error} />
            {canManagePeriod && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Riwayat periode</h3>
                {periods.isLoading ? <p className="text-sm text-slate-500">Memuat riwayat…</p> : periods.error && !periods.data ? null : periods.data?.data.length ? (
                  <>
                    <div className="divide-y divide-slate-100">
                      {periods.data.data.map((period) => (
                        <button key={period.id} type="button" onClick={() => setSelectedPeriodId(period.id)} className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left hover:bg-slate-50">
                          <span><span className="block font-medium">{period.label}</span><span className="text-xs text-slate-500">{PERIOD_STATUS_LABEL[period.status]} · {period.sales_count} struk · {formatDateTime(period.starts_at)}</span></span>
                          <span className="text-right text-sm font-semibold">{formatRupiah(period.sales_total)}{period.invoice_id && <span className="block text-xs font-normal text-slate-500">Invoice #{period.invoice_id}</span>}</span>
                        </button>
                      ))}
                    </div>
                    <Pagination page={periods.data.current_page} lastPage={periods.data.last_page} from={periods.data.from} to={periods.data.to} total={periods.data.total} onPage={setPeriodPage} />
                  </>
                ) : <p className="text-sm text-slate-500">Belum ada riwayat periode.</p>}
              </div>
            )}
          </section>
        )}

        {selectedPeriodId !== null && canManagePeriod && (
          <PeriodDetail
            period={selectedPeriod}
            loading={periodDetail.isLoading}
            error={periodDetail.error}
            canEdit={canManagePeriod}
            canGenerateInvoice={canGenerateInvoice}
            billTo={billTo}
            onBillTo={setBillTo}
            onGenerate={(id) => generateInvoice.mutate(id)}
            generating={generateInvoice.isPending}
            generateError={generateInvoice.error}
            updatePeriod={updatePeriod.mutate}
            updating={updatePeriod.isPending}
            updateError={updatePeriod.error}
            onClose={() => setSelectedPeriodId(null)}
            onOpenInvoice={(id) => setSelectedInvoiceId(id)}
          />
        )}

        {canGenerateInvoice && (
          <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="font-semibold">Invoice HRD</h2><p className="text-sm text-slate-500">Daftar invoice dan status pelunasan.</p></div>
              <Field label="Status">
                <select className={inputCls} value={invoiceStatus} onChange={(event) => { setInvoiceStatus(event.target.value as InvoiceStatus | ''); setInvoicePage(1); }}>
                  <option value="">Semua status</option>
                  {Object.entries(INVOICE_STATUS_LABEL).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                </select>
              </Field>
            </div>
            <ErrorNotice error={invoices.error} />
            {invoices.isLoading ? <p className="text-sm text-slate-500">Memuat invoice…</p> : invoices.error && !invoices.data ? null : invoices.data?.data.length ? (
              <>
                <div className="divide-y divide-slate-100">
                  {invoices.data.data.map((item) => (
                    <button key={item.id} type="button" onClick={() => setSelectedInvoiceId(item.id)} className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left hover:bg-slate-50">
                      <span><span className="block font-mono text-sm font-semibold">{item.document_no}</span><span className="text-xs text-slate-500">{item.bill_to} · {item.period_label} · {INVOICE_STATUS_LABEL[item.status]}</span></span>
                      <span className="text-right text-sm"><span className="block font-semibold">{formatRupiah(item.total)}</span><span className="text-xs text-slate-500">Sisa {formatRupiah(item.amount_remaining)}</span></span>
                    </button>
                  ))}
                </div>
                <Pagination page={invoices.data.current_page} lastPage={invoices.data.last_page} from={invoices.data.from} to={invoices.data.to} total={invoices.data.total} onPage={setInvoicePage} />
              </>
            ) : <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada invoice untuk ditampilkan.</p>}
          </section>
        )}

        {selectedInvoiceId !== null && canGenerateInvoice && (
          <InvoiceDetail
            invoice={invoice}
            loading={invoiceDetail.isLoading}
            error={invoiceDetail.error}
            canIssue={canIssueInvoice}
            canPay={canRecordPayment}
            paymentValues={paymentValues}
            setPaymentValues={setPaymentValues}
            paymentError={paymentError}
            onPaymentSubmit={submitPayment}
            paymentPending={recordPayment.isPending}
            paymentMutationError={recordPayment.error}
            issueError={issueInvoice.error ?? handOverInvoice.error}
            issuePending={issueInvoice.isPending || handOverInvoice.isPending}
            onIssue={() => invoice && issueInvoice.mutate(invoice.id)}
            onHandOver={() => invoice && handOverInvoice.mutate(invoice.id)}
            onPrint={() => invoice && setPrintInvoice(invoice)}
            onClose={() => setSelectedInvoiceId(null)}
          />
        )}
      </div>
      {printInvoice && <InvoicePrint invoice={printInvoice} storeName={me?.store?.name ?? ''} onDone={clearPrintInvoice} />}
    </>
  );
}

function PeriodDetail({
  period, loading, error, canEdit, canGenerateInvoice, billTo, onBillTo, onGenerate, generating,
  generateError, updatePeriod, updating, updateError, onClose, onOpenInvoice,
}: {
  period: BillingPeriod | undefined;
  loading: boolean;
  error: unknown;
  canEdit: boolean;
  canGenerateInvoice: boolean;
  billTo: string;
  onBillTo: (value: string) => void;
  onGenerate: (id: number) => void;
  generating: boolean;
  generateError: unknown;
  updatePeriod: (input: { id: number; label: string; date: string }) => void;
  updating: boolean;
  updateError: unknown;
  onClose: () => void;
  onOpenInvoice: (id: number) => void;
}) {
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  useEffect(() => {
    if (!period) return;
    setLabel(period.label);
    setDate(period.scheduled_close_date ?? '');
  }, [period?.id, period?.label, period?.scheduled_close_date]);

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="font-semibold">Rincian periode</h2><p className="text-sm text-slate-500">Daftar struk kredit yang terikat ke periode ini.</p></div>
        <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Tutup rincian</button>
      </div>
      <ErrorNotice error={error} />
      {loading ? <p className="text-sm text-slate-500">Memuat rincian periode…</p> : period ? (
        <>
          <div className="flex flex-wrap justify-between gap-2 rounded-md bg-slate-50 p-3 text-sm">
            <span className="font-medium">{period.label} · {PERIOD_STATUS_LABEL[period.status]}</span>
            <span>{period.sales_count} struk · {formatRupiah(period.sales_total)}</span>
          </div>
          {period.status === 'open' && canEdit && (
            <form onSubmit={(event) => { event.preventDefault(); updatePeriod({ id: period.id, label, date }); }} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Nama periode"><input className={inputCls} maxLength={40} value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
              <Field label="Tanggal gaji HRD"><input className={inputCls} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
              <button type="submit" disabled={updating} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">{updating ? 'Menyimpan…' : 'Simpan perubahan'}</button>
              <div className="sm:col-span-3"><ErrorNotice error={updateError} /></div>
            </form>
          )}
          {period.customers?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="py-2 pr-3">Karyawan</th><th className="py-2 pr-3">Departemen</th><th className="py-2 pr-3">Transaksi</th><th className="py-2 text-right">Jumlah</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {period.customers.map((customer) => (
                    <tr key={customer.customer_id}><td className="py-2 pr-3"><span className="block font-medium">{customer.name}</span><span className="text-xs text-slate-500">{customer.customer_no}</span></td><td className="py-2 pr-3">{customer.department ?? '—'}</td><td className="py-2 pr-3">{customer.sales_count}</td><td className="py-2 text-right font-medium">{formatRupiah(customer.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada struk kredit pada periode ini.</p>}
          {period.invoice_id && canGenerateInvoice ? (
            <button type="button" onClick={() => onOpenInvoice(period.invoice_id!)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Buka invoice #{period.invoice_id}</button>
          ) : period.invoice_id ? (
            <p className="text-sm text-slate-500">Invoice #{period.invoice_id} sudah dibuat.</p>
          ) : period.status !== 'open' && canGenerateInvoice ? (
            <div className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="Ditagihkan kepada">
                <input className={inputCls} maxLength={150} value={billTo} onChange={(event) => onBillTo(event.target.value)} />
              </Field>
              <button type="button" disabled={generating || period.sales_count === 0} onClick={() => onGenerate(period.id)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{generating ? 'Membuat invoice…' : 'Buat invoice'}</button>
              <div className="sm:col-span-2"><ErrorNotice error={generateError} /></div>
              {period.sales_count === 0 && <p className="text-xs text-slate-500 sm:col-span-2">Periode tanpa struk kredit tidak dapat ditagihkan.</p>}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function InvoiceDetail({
  invoice, loading, error, canIssue, canPay, paymentValues, setPaymentValues, paymentError, onPaymentSubmit,
  paymentPending, paymentMutationError, issueError, issuePending, onIssue, onHandOver, onPrint, onClose,
}: {
  invoice: Invoice | undefined;
  loading: boolean;
  error: unknown;
  canIssue: boolean;
  canPay: boolean;
  paymentValues: PaymentValues;
  setPaymentValues: (values: PaymentValues) => void;
  paymentError: string | null;
  onPaymentSubmit: (event: FormEvent<HTMLFormElement>, invoice: Invoice) => void;
  paymentPending: boolean;
  paymentMutationError: unknown;
  issueError: unknown;
  issuePending: boolean;
  onIssue: () => void;
  onHandOver: () => void;
  onPrint: () => void;
  onClose: () => void;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold">Rincian invoice</h2><p className="text-sm text-slate-500">Rincian berdasarkan struk dan karyawan.</p></div>
        <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Tutup rincian</button>
      </div>
      <ErrorNotice error={error} />
      {loading ? <p className="text-sm text-slate-500">Memuat invoice…</p> : invoice ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-mono text-lg font-semibold">{invoice.document_no}</p><p className="text-sm text-slate-600">{invoice.bill_to} · {invoice.period_label} · {INVOICE_STATUS_LABEL[invoice.status]}</p><p className="text-xs text-slate-500">Dibuat {formatDateTime(invoice.created_at)}</p></div>
            <div className="no-print flex flex-wrap gap-2">
              <button type="button" onClick={onPrint} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Cetak invoice</button>
              {canIssue && invoice.status === 'draft' && <button type="button" disabled={issuePending} onClick={() => { if (window.confirm(`Terbitkan invoice ${invoice.document_no}?`)) onIssue(); }} className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60">{issuePending ? 'Memproses…' : 'Terbitkan'}</button>}
              {canIssue && invoice.status === 'issued' && <button type="button" disabled={issuePending} onClick={() => { if (window.confirm(`Tandai invoice ${invoice.document_no} sudah diserahkan ke HRD?`)) onHandOver(); }} className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60">{issuePending ? 'Memproses…' : 'Serahkan ke HRD'}</button>}
            </div>
          </div>
          <ErrorNotice error={issueError} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="py-2 pr-3">Karyawan / struk</th><th className="py-2 pr-3">Departemen</th><th className="py-2 pr-3">Tanggal</th><th className="py-2 text-right">Tagihan</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.customers.map((customer) => customer.sales.map((sale) => (
                  <tr key={sale.sale_id}><td className="py-2 pr-3"><span className="block font-medium">{customer.name}</span><span className="text-xs text-slate-500">{customer.customer_no} · {sale.doc_number}</span></td><td className="py-2 pr-3">{customer.department ?? '—'}</td><td className="whitespace-nowrap py-2 pr-3">{formatDateTime(sale.posted_at)}</td><td className="whitespace-nowrap py-2 text-right">{formatRupiah(sale.amount)}</td></tr>
                )))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto grid max-w-sm grid-cols-2 gap-x-6 gap-y-2 border-t border-slate-200 pt-3 text-sm">
            <Metric label="Subtotal" value={formatRupiah(invoice.subtotal)} />
            <Metric label={`PPN${invoice.tax_rate ? ` (${invoice.tax_rate}%)` : ''}`} value={formatRupiah(invoice.tax_amount)} />
            <Metric label="Total invoice" value={formatRupiah(invoice.total)} strong />
            <Metric label="Sudah dibayar" value={formatRupiah(invoice.amount_paid)} />
            <Metric label="Sisa tagihan" value={formatRupiah(invoice.amount_remaining)} strong />
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Riwayat pembayaran</h3>
            {invoice.payments.length ? (
              <ul className="divide-y divide-slate-100">
                {invoice.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                    <span>{formatDateTime(payment.received_at)} · {payment.recorded_by_name}{payment.reference ? ` · Ref: ${payment.reference}` : ''}{payment.note ? <span className="block text-xs text-slate-500">{payment.note}</span> : null}</span>
                    <strong>{formatRupiah(payment.amount)}</strong>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">Belum ada pembayaran.</p>}
          </div>
          {canPay && ['issued', 'handed_to_hr', 'partially_paid'].includes(invoice.status) && (
            <form onSubmit={(event) => onPaymentSubmit(event, invoice)} className="no-print space-y-3 rounded-md bg-slate-50 p-4">
              <div><h3 className="font-semibold">Catat pembayaran HRD</h3><p className="text-sm text-slate-600">Sisa tagihan: {formatRupiah(invoice.amount_remaining)}</p></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Jumlah pembayaran" error={paymentError ?? undefined}>
                  <input className={inputCls} inputMode="decimal" value={paymentValues.amount} onChange={(event) => setPaymentValues({ ...paymentValues, amount: event.target.value })} placeholder="0.00" />
                </Field>
                <Field label="Tanggal diterima">
                  <input className={inputCls} type="date" value={paymentValues.receivedOn} onChange={(event) => setPaymentValues({ ...paymentValues, receivedOn: event.target.value })} />
                </Field>
                <Field label="Referensi">
                  <input className={inputCls} maxLength={100} value={paymentValues.reference} onChange={(event) => setPaymentValues({ ...paymentValues, reference: event.target.value })} />
                </Field>
                <Field label="Catatan">
                  <input className={inputCls} maxLength={255} value={paymentValues.note} onChange={(event) => setPaymentValues({ ...paymentValues, note: event.target.value })} />
                </Field>
              </div>
              <ErrorNotice error={paymentMutationError} />
              <button type="submit" disabled={paymentPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{paymentPending ? 'Menyimpan…' : 'Simpan pembayaran'}</button>
            </form>
          )}
        </>
      ) : null}
    </section>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <><dt className={strong ? 'font-semibold' : 'text-slate-600'}>{label}</dt><dd className={`text-right ${strong ? 'font-semibold' : ''}`}>{value}</dd></>;
}

function InvoicePrint({ invoice, storeName, onDone }: { invoice: Invoice; storeName: string; onDone: () => void }) {
  useEffect(() => {
    window.addEventListener('afterprint', onDone, { once: true });
    const timer = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', onDone);
    };
  }, [onDone]);

  return (
    <div className="print-only print-doc">
      <article>
        <header className="mb-5 flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div><p className="font-bold">{storeName}</p><h1 className="text-2xl font-bold">INVOICE TAGIHAN KARYAWAN</h1></div>
          <dl className="text-right text-sm leading-6"><dt className="font-mono text-lg font-bold">{invoice.document_no}</dt><dd>Periode: {invoice.period_label}</dd><dd>Status: {INVOICE_STATUS_LABEL[invoice.status]}</dd><dd>Tanggal terbit: {invoice.issued_at ? formatDateTime(invoice.issued_at) : 'Draft'}</dd></dl>
        </header>
        <p className="mb-4"><strong>Ditagihkan kepada:</strong> {invoice.bill_to}</p>
        <table>
          <thead><tr><th>No.</th><th>Karyawan</th><th>Departemen</th><th>No. Struk</th><th>Tanggal</th><th className="text-right">Jumlah</th></tr></thead>
          <tbody>
            {invoice.customers.flatMap((customer) => customer.sales.map((sale) => (
              <tr key={sale.sale_id}><td>{sale.sale_id}</td><td>{customer.name} ({customer.customer_no})</td><td>{customer.department ?? '—'}</td><td>{sale.doc_number}</td><td>{formatDateTime(sale.posted_at)}</td><td className="text-right">{formatRupiah(sale.amount)}</td></tr>
            )))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 grid max-w-xs grid-cols-2 gap-2">
          <dt>Subtotal</dt><dd className="text-right">{formatRupiah(invoice.subtotal)}</dd>
          <dt>PPN{invoice.tax_rate ? ` (${invoice.tax_rate}%)` : ''}</dt><dd className="text-right">{formatRupiah(invoice.tax_amount)}</dd>
          <dt className="border-t border-black pt-2 font-bold">Total</dt><dd className="border-t border-black pt-2 text-right font-bold">{formatRupiah(invoice.total)}</dd>
          <dt>Sudah dibayar</dt><dd className="text-right">{formatRupiah(invoice.amount_paid)}</dd>
          <dt>Sisa tagihan</dt><dd className="text-right font-bold">{formatRupiah(invoice.amount_remaining)}</dd>
        </dl>
        {invoice.payments.length > 0 && (
          <section className="mt-5">
            <h2 className="mb-2 font-bold">Riwayat pembayaran</h2>
            <table>
              <thead><tr><th>Tanggal</th><th>Referensi</th><th>Pencatat</th><th className="text-right">Jumlah</th></tr></thead>
              <tbody>{invoice.payments.map((payment) => (
                <tr key={payment.id}><td>{formatDateTime(payment.received_at)}</td><td>{payment.reference ?? '—'}</td><td>{payment.recorded_by_name}</td><td className="text-right">{formatRupiah(payment.amount)}</td></tr>
              ))}</tbody>
            </table>
          </section>
        )}
        <div className="mt-16 grid grid-cols-2 gap-16 text-center text-sm">
          <div>Diserahkan oleh<hr className="mx-8 mt-20 border-black" /></div>
          <div>Diterima HRD<hr className="mx-8 mt-20 border-black" /></div>
        </div>
      </article>
    </div>
  );
}
