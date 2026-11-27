import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { saleApi } from '@/lib/api/endpoints';
import type { PaymentMode, Sale } from '@/lib/api/types';
import { ReceiptView } from './ReceiptView';
import { loadReceiptPaperSize, RECEIPT_PAPER_LABELS, type ThermalPaperSize } from './receiptPrintSettings';
import { BILLING_STATUS_LABEL } from './saleHistoryLogic';

interface FilterValues {
  q: string;
  paymentMode: PaymentMode | '';
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: FilterValues = { q: '', paymentMode: '', dateFrom: '', dateTo: '' };
const PAYMENT_LABEL: Record<PaymentMode, string> = { cash: 'Tunai', payroll_credit: 'Kredit potong gaji' };

export function SalesHistoryPage() {
  const { can } = useAuth();
  const [values, setValues] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [printSale, setPrintSale] = useState<Sale | null>(null);
  const [thermalPaperSize] = useState<ThermalPaperSize>(() => loadReceiptPaperSize());

  const query = useQuery({
    queryKey: ['sales', 'history', filters, page],
    queryFn: () => saleApi.list({
      q: filters.q || undefined,
      payment_mode: filters.paymentMode || undefined,
      date_from: filters.dateFrom || undefined,
      date_to: filters.dateTo || undefined,
      page,
      per_page: 25,
    }),
  });

  useEffect(() => {
    if (!printSale) return;
    const clearPrint = () => setPrintSale(null);
    window.addEventListener('afterprint', clearPrint, { once: true });
    window.print();
    return () => window.removeEventListener('afterprint', clearPrint);
  }, [printSale]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...values, q: values.q.trim() });
    setPage(1);
  }

  function clearFilters() {
    setValues(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  return (
    <>
    <div className="sales-history-screen space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Data Struk Penjualan</h1>
        </div>
        <p className="text-sm text-slate-600">Ukuran struk perangkat ini: {RECEIPT_PAPER_LABELS[thermalPaperSize]}</p>
      </div>

      <form onSubmit={applyFilters} className="no-print grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Nomor struk">
          <input className={inputCls} value={values.q} onChange={(event) => setValues((v) => ({ ...v, q: event.target.value }))} placeholder="Cari nomor struk" />
        </Field>
        <Field label="Status Pembayaran">
          <select className={inputCls} value={values.paymentMode} onChange={(event) => setValues((v) => ({ ...v, paymentMode: event.target.value as PaymentMode | '' }))}>
            <option value="">Semua</option>
            <option value="cash">Tunai</option>
            <option value="payroll_credit">Kredit potong gaji</option>
          </select>
        </Field>
        <Field label="Transaksi (Dari)">
          <input className={inputCls} type="date" value={values.dateFrom} onChange={(event) => setValues((v) => ({ ...v, dateFrom: event.target.value }))} />
        </Field>
        <Field label="Transaksi (Sampai dengan)">
          <input className={inputCls} type="date" value={values.dateTo} onChange={(event) => setValues((v) => ({ ...v, dateTo: event.target.value }))} />
        </Field>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Terapkan filter</button>
          <button type="button" onClick={clearFilters} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">Bersihkan</button>
        </div>
      </form>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <ErrorNotice error={query.error} />
        {query.isLoading ? (
          <p className="text-sm text-slate-500">Memuat riwayat penjualan…</p>
        ) : query.error && !query.data ? null : query.data?.data.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Tidak ada transaksi yang cocok dengan filter.</p>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {query.data?.data.map((sale) => (
                <button
                  type="button"
                  key={sale.id}
                  onClick={() => setSelectedId(sale.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 py-4 text-left hover:bg-slate-50"
                >
                  <span>
                    <span className="block font-mono text-sm font-semibold">{sale.doc_number}</span>
                    <span className="mt-1 block text-xs text-slate-600">
                      {PAYMENT_LABEL[sale.payment_mode]} · {sale.cashier_name ?? 'Kasir tidak diketahui'}
                      {sale.customer_name ? ` · ${sale.customer_name}` : ''}
                    </span>
                    {sale.cashier_number && <span className="mt-1 block text-xs text-slate-500">{sale.cashier_number}</span>}
                    <span className="mt-1 block text-xs text-slate-500">
                      {formatDateTime(sale.posted_at)} · {BILLING_STATUS_LABEL[sale.billing_status]}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatRupiah(sale.total)}</span>
                </button>
              ))}
            </div>
            {query.data && (
              <Pagination page={query.data.current_page} lastPage={query.data.last_page} from={query.data.from} to={query.data.to} total={query.data.total} onPage={setPage} />
            )}
          </>
        )}
      </section>

      {selectedId !== null && (
        <SaleDetailDialog
          saleId={selectedId}
          canReprint={can('receipt.reprint')}
          onClose={() => setSelectedId(null)}
          onPrint={setPrintSale}
        />
      )}
    </div>
    {printSale && <div className="print-only"><ReceiptView sale={printSale} paperSize={thermalPaperSize} /></div>}
    </>
  );
}

function SaleDetailDialog({
  saleId,
  canReprint,
  onClose,
  onPrint,
}: {
  saleId: number;
  canReprint: boolean;
  onClose: () => void;
  onPrint: (sale: Sale) => void;
}) {
  const detail = useQuery({ queryKey: ['sale', saleId], queryFn: () => saleApi.get(saleId) });
  const reprint = useMutation({
    mutationFn: () => saleApi.reprint(saleId),
    onSuccess: (sale) => onPrint(sale),
  });

  const sale = detail.data;

  return (
    <Modal title="Detail penjualan" onClose={onClose}>
      {detail.isLoading ? (
        <p className="p-5 text-sm text-slate-500">Memuat struk…</p>
      ) : detail.error ? (
        <div className="p-5"><ErrorNotice error={detail.error} /></div>
      ) : sale ? (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <p className="font-mono font-semibold">{sale.doc_number}</p>
              <p className="text-xs text-slate-500">{BILLING_STATUS_LABEL[sale.billing_status]}</p>
            </div>
            <div className="no-print flex gap-2">
              {canReprint && (
                <button type="button" disabled={reprint.isPending} onClick={() => reprint.mutate()} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">
                  {reprint.isPending ? 'Menyiapkan…' : 'Cetak SALINAN'}
                </button>
              )}
            </div>
          </div>
          <ErrorNotice error={reprint.error} />
          <ReceiptView sale={sale} />
        </div>
      ) : null}
    </Modal>
  );
}
