import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { shiftApi, saleApi } from '@/lib/api/endpoints';
import type { PaymentMode, Sale, SaleStatus, ShiftStatus } from '@/lib/api/types';
import { ReceiptView } from './ReceiptView';
import { BILLING_STATUS_LABEL, canVoidSale, SALE_STATUS_LABEL, voidUnavailableReason } from './saleHistoryLogic';

interface FilterValues {
  q: string;
  status: SaleStatus | '';
  paymentMode: PaymentMode | '';
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: FilterValues = { q: '', status: '', paymentMode: '', dateFrom: '', dateTo: '' };
const PAYMENT_LABEL: Record<PaymentMode, string> = { cash: 'Tunai', payroll_credit: 'Kredit potong gaji' };

export function SalesHistoryPage() {
  const { can } = useAuth();
  const [values, setValues] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [printSale, setPrintSale] = useState<Sale | null>(null);

  const query = useQuery({
    queryKey: ['sales', 'history', filters, page],
    queryFn: () => saleApi.list({
      q: filters.q || undefined,
      status: filters.status || undefined,
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
      <div>
        <h1 className="text-xl font-semibold">Riwayat Penjualan</h1>
        <p className="mt-1 text-sm text-slate-600">Cari transaksi, lihat detail struk, cetak salinan, atau batalkan transaksi sesuai aturan shift dan tagihan.</p>
      </div>

      <form onSubmit={applyFilters} className="no-print grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Nomor struk">
          <input className={inputCls} value={values.q} onChange={(event) => setValues((v) => ({ ...v, q: event.target.value }))} placeholder="Cari nomor struk" />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={values.status} onChange={(event) => setValues((v) => ({ ...v, status: event.target.value as SaleStatus | '' }))}>
            <option value="">Semua</option>
            <option value="posted">Terposting</option>
            <option value="voided">Dibatalkan</option>
          </select>
        </Field>
        <Field label="Pembayaran">
          <select className={inputCls} value={values.paymentMode} onChange={(event) => setValues((v) => ({ ...v, paymentMode: event.target.value as PaymentMode | '' }))}>
            <option value="">Semua</option>
            <option value="cash">Tunai</option>
            <option value="payroll_credit">Kredit potong gaji</option>
          </select>
        </Field>
        <Field label="Dari (WIB)">
          <input className={inputCls} type="date" value={values.dateFrom} onChange={(event) => setValues((v) => ({ ...v, dateFrom: event.target.value }))} />
        </Field>
        <Field label="Sampai (WIB)">
          <input className={inputCls} type="date" value={values.dateTo} onChange={(event) => setValues((v) => ({ ...v, dateTo: event.target.value }))} />
        </Field>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
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
                    <span className="mt-1 block text-xs text-slate-500">
                      {formatDateTime(sale.posted_at)} · {SALE_STATUS_LABEL[sale.status]} · {BILLING_STATUS_LABEL[sale.billing_status]}
                    </span>
                  </span>
                  <span className={`font-semibold tabular-nums ${sale.status === 'voided' ? 'text-red-700 line-through' : ''}`}>{formatRupiah(sale.total)}</span>
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
          canVoid={can('sales.void')}
          onClose={() => setSelectedId(null)}
          onPrint={setPrintSale}
        />
      )}
    </div>
    {printSale && <div className="print-only"><ReceiptView sale={printSale} /></div>}
    </>
  );
}

function SaleDetailDialog({
  saleId,
  canReprint,
  canVoid,
  onClose,
  onPrint,
}: {
  saleId: number;
  canReprint: boolean;
  canVoid: boolean;
  onClose: () => void;
  onPrint: (sale: Sale) => void;
}) {
  const qc = useQueryClient();
  const [voidReason, setVoidReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [voidStep, setVoidStep] = useState<'reason' | 'confirm' | null>(null);
  const detail = useQuery({ queryKey: ['sale', saleId], queryFn: () => saleApi.get(saleId) });
  const shift = useQuery({
    queryKey: ['shifts', 'sale', detail.data?.shift_id],
    queryFn: () => shiftApi.get(detail.data!.shift_id),
    enabled: Boolean(detail.data && detail.data.payment_mode === 'cash' && canVoid),
  });
  const reprint = useMutation({
    mutationFn: () => saleApi.reprint(saleId),
    onSuccess: (sale) => onPrint(sale),
  });
  const voidSale = useMutation({
    mutationFn: () => saleApi.void(saleId, voidReason.trim()),
    onSuccess: (sale) => {
      qc.setQueryData(['sale', saleId], sale);
      void qc.invalidateQueries({ queryKey: ['sales', 'history'] });
      void qc.invalidateQueries({ queryKey: ['shifts'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
      setVoidStep(null);
    },
  });

  const sale = detail.data;
  const shiftStatus: ShiftStatus | undefined = shift.data?.status;
  const voidReasonUnavailable = sale ? voidUnavailableReason(sale, sale.payment_mode === 'cash' && canVoid ? shiftStatus : undefined) : null;
  const canVoidNow = Boolean(sale && canVoid && (sale.payment_mode === 'payroll_credit' ? canVoidSale(sale, undefined) : canVoidSale(sale, shiftStatus)));

  function reviewVoid(event: FormEvent) {
    event.preventDefault();
    if (!voidReason.trim()) {
      setReasonError('Alasan pembatalan wajib diisi.');
      return;
    }
    if (voidReason.trim().length > 500) {
      setReasonError('Alasan maksimal 500 karakter.');
      return;
    }
    setReasonError(undefined);
    voidSale.reset();
    setVoidStep('confirm');
  }

  return (
    <Modal title="Detail penjualan" onClose={() => !voidSale.isPending && onClose()}>
      {detail.isLoading ? (
        <p className="p-5 text-sm text-slate-500">Memuat struk…</p>
      ) : detail.error ? (
        <div className="p-5"><ErrorNotice error={detail.error} /></div>
      ) : sale ? (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <p className="font-mono font-semibold">{sale.doc_number}</p>
              <p className="text-xs text-slate-500">{SALE_STATUS_LABEL[sale.status]} · {BILLING_STATUS_LABEL[sale.billing_status]}</p>
            </div>
            <div className="no-print flex gap-2">
              {canReprint && (
                <button type="button" disabled={reprint.isPending} onClick={() => reprint.mutate()} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">
                  {reprint.isPending ? 'Menyiapkan…' : 'Cetak SALINAN'}
                </button>
              )}
              {canVoid && sale.status === 'posted' && (
                <button type="button" disabled={!canVoidNow || shift.isLoading || voidSale.isPending} onClick={() => { setVoidReason(''); setReasonError(undefined); voidSale.reset(); setVoidStep('reason'); }} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-800 hover:bg-red-50 disabled:opacity-50">
                  Batalkan penjualan
                </button>
              )}
            </div>
          </div>
          <ErrorNotice error={reprint.error} />
          {canVoid && sale.status === 'posted' && (
            <div className="no-print">
              {shift.error && sale.payment_mode === 'cash' && <ErrorNotice error={shift.error} />}
              {!canVoidNow && !shift.isLoading && !shift.error && voidReasonUnavailable && (
                <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{voidReasonUnavailable}</p>
              )}
              {shift.isLoading && sale.payment_mode === 'cash' && <p className="text-xs text-slate-500">Memeriksa status shift untuk aturan pembatalan…</p>}
            </div>
          )}
          <ReceiptView sale={sale} />
          {voidStep === 'reason' && (
            <form onSubmit={reviewVoid} noValidate className="no-print space-y-3 rounded-md border border-red-200 bg-red-50 p-4">
              <h3 className="font-semibold text-red-900">Pembatalan penjualan</h3>
              <p className="text-sm text-red-900">Stok akan dikembalikan ke batch asal dan transaksi kas/kredit dikoreksi secara atomik.</p>
              <ErrorNotice error={voidSale.error} />
              <Field label="Alasan pembatalan (wajib)" error={reasonError ?? (voidSale.error instanceof ApiError ? voidSale.error.errors?.reason?.[0] : undefined)}>
                <textarea className={inputCls} rows={2} maxLength={500} value={voidReason} onChange={(event) => { setVoidReason(event.target.value); setReasonError(undefined); voidSale.reset(); }} />
              </Field>
              <div className="flex justify-end gap-2">
                <button type="button" disabled={voidSale.isPending} onClick={() => setVoidStep(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Kembali</button>
                <button type="submit" disabled={voidSale.isPending} className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">Periksa alasan</button>
              </div>
            </form>
          )}
          {voidStep === 'confirm' && (
            <div className="no-print space-y-3 rounded-md border border-red-300 bg-red-50 p-4">
              <h3 className="font-semibold text-red-900">Konfirmasi pembatalan</h3>
              <p className="text-sm">Batalkan transaksi <strong>{sale.doc_number}</strong> senilai <strong>{formatRupiah(sale.total)}</strong>?</p>
              <p className="text-sm">Alasan: {voidReason.trim()}</p>
              <p className="text-xs text-red-800">Tindakan ini tidak dapat dibatalkan. Stok dan ledger keuangan akan direversal oleh backend.</p>
              <ErrorNotice error={voidSale.error} />
              <div className="flex justify-end gap-2">
                <button type="button" disabled={voidSale.isPending} onClick={() => setVoidStep('reason')} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Kembali</button>
                <button type="button" disabled={voidSale.isPending} onClick={() => voidSale.mutate()} className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{voidSale.isPending ? 'Membatalkan…' : 'Konfirmasi pembatalan'}</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
