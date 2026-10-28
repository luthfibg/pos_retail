import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { saleApi, shiftApi } from '@/lib/api/endpoints';
import type { CreditExceptionInput, Customer, PaymentMode, Sale, SaleInput, SalePreviewInput } from '@/lib/api/types';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/features/auth/AuthProvider';
import { canSell } from '@/features/shifts/shiftLogic';
import { CREDIT_HINT, canUseCredit } from '@/features/customers/creditState';
import { Modal } from '@/components/ui/Modal';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { formatQty, formatRupiah } from '@/lib/format';
import { milliToQty, moneyToCents, qtyToMilli, subtractMoney } from '@/lib/money';
import {
  addProduct, buildSaleInput, estimateSubtotal, mapSaleErrors, mustChangeKey, needsCreditException, newIdempotencyKey,
  parseQty, removeLine, setQty, validateCart, validateTendered,
  type CartLine, type CartProduct, type SaleErrors,
} from './cartLogic';
import { CreditExceptionDialog } from './CreditExceptionDialog';
import { CustomerPicker } from './CustomerPicker';
import { ProductSearch } from './ProductSearch';
import { ReceiptView, type ThermalPaperSize } from './ReceiptView';

const NO_ERRORS: SaleErrors = { lines: {}, fields: {} };
const MODE_LABEL: Record<PaymentMode, string> = { cash: 'Tunai', payroll_credit: 'Kredit potong gaji' };

/** Layar kasir. Harga, diskon, PPN, dan total resmi selalu dari server (pratinjau dan struk). */
export function PosPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const searchRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tendered, setTendered] = useState('');
  const [tenderedError, setTenderedError] = useState<string | undefined>();
  /** Kunci idempotensi: satu per keranjang. Diganti hanya setelah sukses atau bila server menolak kuncinya. */
  const [cartKey, setCartKey] = useState(() => newIdempotencyKey());
  const [errors, setErrors] = useState<SaleErrors>(NO_ERRORS);
  const [topError, setTopError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  /** Permintaan yang hasilnya tidak diketahui (jaringan putus/5xx). Keranjang dikunci; kirim ulang memakai kunci yang sama. */
  const [pending, setPending] = useState<SaleInput | null>(null);
  const [done, setDone] = useState<{ sale: Sale; replayed: boolean } | null>(null);
  const [thermalPaperSize, setThermalPaperSize] = useState<ThermalPaperSize>('80');
  const [previewMissing, setPreviewMissing] = useState(false);

  const shiftQuery = useQuery({ queryKey: ['shifts', 'current'], queryFn: shiftApi.current });
  const shift = shiftQuery.data ?? null;
  const sellingAllowed = canSell(shift?.status);

  // ---------------------------------------------------------------- pratinjau server (FR-01)
  const cartErrors = useMemo(() => validateCart(lines), [lines]);
  const cartValid = lines.length > 0 && Object.keys(cartErrors.lines).length === 0;

  const currentKey = useMemo(() => {
    if (!cartValid || (mode === 'payroll_credit' && !customer)) return '';
    const input: SalePreviewInput = {
      payment_mode: mode,
      items: lines.map((l) => ({ product_id: l.product.id, qty: milliToQty(parseQty(l.qty) ?? 0n) })),
    };
    if (mode === 'payroll_credit' && customer) input.customer_id = customer.id;
    return JSON.stringify(input);
  }, [cartValid, lines, mode, customer]);
  const previewKey = useDebounce(currentKey, 300);

  const preview = useQuery({
    queryKey: ['sales', 'preview', previewKey],
    queryFn: ({ signal }) => saleApi.preview(JSON.parse(previewKey) as SalePreviewInput, signal),
    enabled: previewKey !== '' && !previewMissing,
    retry: false,
    staleTime: 0,
  });

  const previewGone = preview.error instanceof ApiError && (preview.error.status === 404 || preview.error.status === 405);
  useEffect(() => { if (previewGone) setPreviewMissing(true); }, [previewGone]);

  const previewFresh = preview.data !== undefined && !preview.isFetching && previewKey === currentKey && currentKey !== '';
  const quote = previewFresh ? preview.data : undefined;
  const previewErrors = preview.error instanceof ApiError && preview.error.status === 422 ? mapSaleErrors(preview.error.errors) : NO_ERRORS;
  const total = quote?.total ?? null;

  // ---------------------------------------------------------------- posting
  const mutation = useMutation({
    mutationFn: (input: SaleInput) => saleApi.post(input),
    onSuccess: (res) => {
      setDone({ sale: res.data, replayed: res.replayed });
      setLines([]);
      setCustomer(null);
      setTendered('');
      setTenderedError(undefined);
      setMode('cash');
      setErrors(NO_ERRORS);
      setTopError(null);
      setPending(null);
      setConfirming(false);
      setExceptionOpen(false);
      setCartKey(newIdempotencyKey());
      void qc.invalidateQueries({ queryKey: ['shifts'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err, input) => {
      setConfirming(false);
      if (err instanceof ApiError && err.status === 422) {
        const e = mapSaleErrors(err.errors);
        setErrors(e);
        setPending(null);
        setTopError(null);
        if (mustChangeKey(e)) setCartKey(newIdempotencyKey());
        if (needsCreditException(e)) setExceptionOpen(true);
        else if (input.credit_exception === undefined) setExceptionOpen(false);
        return;
      }
      if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) {
        // hasil tidak diketahui: struk mungkin sudah tersimpan. Kunci tetap dan keranjang dikunci.
        setPending(input);
        setExceptionOpen(false);
        setTopError(err);
        return;
      }
      setTopError(err);
    },
  });

  const locked = mutation.isPending || pending !== null;

  const creditNeedsException =
    mode === 'payroll_credit' && customer !== null &&
    (quote?.credit?.exceeds_limit === true || customer.credit_state === 'exhausted');

  const canPayCredit = customer !== null && (canUseCredit(customer.credit_state) || customer.credit_state === 'exhausted');

  function buildInput(exception?: CreditExceptionInput): SaleInput {
    return buildSaleInput(lines, cartKey, { mode, customerId: customer?.id ?? null, tendered, exception });
  }

  function startPay() {
    if (locked || !sellingAllowed) return;
    setTopError(null);
    const cartFound = validateCart(lines);
    if (cartFound.general || Object.keys(cartFound.lines).length > 0) {
      setErrors({ lines: {}, fields: {}, general: cartFound.general });
      return;
    }
    if (mode === 'payroll_credit') {
      if (!customer || !canPayCredit) {
        setErrors({ lines: {}, fields: { customer_id: customer ? CREDIT_HINT[customer.credit_state] : 'Pilih karyawan untuk kredit.' } });
        return;
      }
      setErrors(NO_ERRORS);
      if (creditNeedsException) { setExceptionOpen(true); return; }
    } else {
      const msg = validateTendered(tendered, total);
      setTenderedError(msg);
      if (msg) return;
      setErrors(NO_ERRORS);
    }
    setConfirming(true);
  }

  function reset() {
    setDone(null);
    setErrors(NO_ERRORS);
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  useEffect(() => { if (sellingAllowed && !done) searchRef.current?.focus(); }, [sellingAllowed, done]);

  function pick(p: CartProduct) {
    setLines((ls) => addProduct(ls, p));
    setErrors(NO_ERRORS);
    setTopError(null);
    searchRef.current?.focus();
  }

  function changeMode(m: PaymentMode) {
    if (locked) return;
    setMode(m);
    setErrors(NO_ERRORS);
    setTenderedError(undefined);
    if (m === 'cash') setCustomer(null);
  }

  // ---------------------------------------------------------------- tampilan
  if (shiftQuery.isLoading) return <div className="p-6 text-slate-500">Memuat shift…</div>;

  if (done) {
    return (
      <div className="space-y-4 p-6">
        <div className="no-print max-w-md space-y-2">
          <h1 className="text-xl font-semibold">Transaksi tersimpan</h1>
          {done.replayed && (
            <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Struk ini sudah tercatat sebelumnya; permintaan ulang tidak membuat transaksi ganda.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Ukuran kertas">
              <select className={inputCls} value={thermalPaperSize} onChange={(event) => setThermalPaperSize(event.target.value as ThermalPaperSize)}>
                <option value="58">Thermal 58 mm</option>
                <option value="80">Thermal 80 mm</option>
              </select>
            </Field>
            <button type="button" onClick={() => window.print()} className="h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Cetak struk</button>
            <button type="button" onClick={reset} className="h-10 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Transaksi baru</button>
          </div>
        </div>
        <ReceiptView sale={done.sale} paperSize={thermalPaperSize} />
      </div>
    );
  }

  const unknownOutcome = pending !== null;
  const estimate = quote ? null : estimateSubtotal(lines);
  const change = mode === 'cash' && total !== null && !validateTendered(tendered, total) ? subtractMoney(tendered.trim().replace(',', '.'), total) : null;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_24rem]">
      <section className="min-w-0 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Kasir</h1>
          {shift && <span className="font-mono text-xs text-slate-500">{shift.doc_number}</span>}
        </div>

        <ErrorNotice error={shiftQuery.error} />
        {!shiftQuery.error && !sellingAllowed && (
          <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {shift?.status === 'counting'
              ? 'Shift sedang dihitung; penjualan baru diblokir sampai shift ditutup.'
              : 'Belum ada shift berjalan. Buka shift terlebih dahulu sebelum berjualan.'}{' '}
            <Link to="/shift" className="font-medium underline">Ke Shift Saya</Link>
          </div>
        )}

        {unknownOutcome && (
          <div role="alert" className="space-y-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-medium">Hasil transaksi belum diketahui.</p>
            <p>Koneksi terputus saat mengirim. Struk mungkin sudah tersimpan. Kirim ulang aman: transaksi tidak akan ganda. Keranjang dikunci sampai terkirim.</p>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => { if (pending && !mutation.isPending) { setTopError(null); mutation.mutate(pending); } }}
              className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {mutation.isPending ? 'Mengirim…' : 'Kirim ulang'}
            </button>
          </div>
        )}

        <ProductSearch onPick={pick} inputRef={searchRef} disabled={!sellingAllowed || locked} />

        {errors.general && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errors.general}</div>}

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Produk</th>
                <th className="w-28 px-3 py-2">Qty</th>
                <th className="px-3 py-2 text-right">Harga</th>
                <th className="px-3 py-2 text-right">Jumlah</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {lines.map((l, i) => {
                const ql = quote?.lines.find((x) => x.index === i);
                const e = { ...cartErrors.lines[i], ...errors.lines[i] };
                const qtyMilli = parseQty(l.qty);
                const stockMilli = qtyToMilli(l.product.stock_sellable);
                const overStock = qtyMilli !== null && stockMilli !== null && qtyMilli > stockMilli;
                const hasDiscount = ql !== undefined && (moneyToCents(ql.discount_amount) ?? 0n) !== 0n;
                return (
                  <tr key={l.key}>
                    <td className="px-3 py-2">
                      <div>{l.product.name}</div>
                      <div className="font-mono text-xs text-slate-400">{l.product.sku}</div>
                      {e.product && <p role="alert" className="text-xs text-red-700">{e.product}</p>}
                      {e.product_id && <p role="alert" className="text-xs text-red-700">{e.product_id}</p>}
                      {ql && !ql.stock_sufficient && (
                        <p role="alert" className="text-xs text-red-700">Stok tidak cukup (tersedia {formatQty(ql.stock_available)} {l.product.unit_name}).</p>
                      )}
                      {!ql && overStock && (
                        <p className="text-xs text-amber-700">Melebihi stok tercatat ({formatQty(l.product.stock_sellable)} {l.product.unit_name}).</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={`${inputCls} tabular-nums ${e.qty ? 'border-red-400' : ''}`}
                        inputMode="decimal"
                        aria-label={`Qty ${l.product.name}`}
                        value={l.qty}
                        disabled={locked}
                        onChange={(ev) => { setLines((ls) => setQty(ls, l.key, ev.target.value)); setErrors(NO_ERRORS); }}
                      />
                      <span className="text-xs text-slate-400">{l.product.unit_name}</span>
                      {e.qty && <p role="alert" className="text-xs text-red-700">{e.qty}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(ql?.unit_price ?? l.product.sell_price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {ql ? formatRupiah(ql.line_total) : '—'}
                      {hasDiscount && ql && (
                        <div className="text-xs text-emerald-700">Diskon {formatRupiah(ql.discount_amount)}{ql.discount_name ? ` (${ql.discount_name})` : ''}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => { setLines((ls) => removeLine(ls, l.key)); setErrors(NO_ERRORS); }}
                        aria-label={`Hapus ${l.product.name}`}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-500">Keranjang kosong. Scan barcode atau cari produk untuk mulai.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="space-y-3">
        <div role="tablist" className="grid grid-cols-2 gap-1">
          {(Object.keys(MODE_LABEL) as PaymentMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              disabled={locked}
              onClick={() => changeMode(m)}
              className={`rounded-md px-3 py-2 text-sm ${mode === m ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white hover:bg-slate-50'}`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        {mode === 'payroll_credit' && (
          <div className="space-y-2">
            {can('customer.select') ? (
              <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setErrors(NO_ERRORS); }} disabled={locked} />
            ) : (
              <p className="text-sm text-slate-500">Akun ini tidak berhak memilih karyawan.</p>
            )}
            {errors.fields.customer_id && <p role="alert" className="text-sm text-red-700">{errors.fields.customer_id}</p>}
            {previewErrors.fields.customer_id && !errors.fields.customer_id && <p role="alert" className="text-sm text-red-700">{previewErrors.fields.customer_id}</p>}
            {quote?.credit && (
              <p className={`rounded-md p-2 text-sm ${quote.credit.exceeds_limit ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`}>
                {quote.credit.exceeds_limit
                  ? `Melebihi sisa batas (sisa ${formatRupiah(quote.credit.remaining_before)}). Tawarkan tunai atau minta pengecualian Admin.`
                  : `Sisa batas setelah transaksi ${formatRupiah(quote.credit.remaining_after)}.`}
              </p>
            )}
          </div>
        )}

        <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          {quote ? (
            <>
              <Row label="Subtotal" value={formatRupiah(quote.subtotal)} />
              {(moneyToCents(quote.discount_total) ?? 0n) !== 0n && <Row label="Diskon" value={`-${formatRupiah(quote.discount_total)}`} />}
              {(moneyToCents(quote.tax_amount) ?? 0n) !== 0n && <Row label={`PPN${quote.tax_rate ? ` ${formatQty(quote.tax_rate)}%` : ''}`} value={formatRupiah(quote.tax_amount)} />}
              <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
                <span className="font-medium">Total</span>
                <span className="text-2xl font-semibold tabular-nums">{formatRupiah(quote.total)}</span>
              </div>
            </>
          ) : lines.length === 0 ? (
            <p className="text-slate-500">Total muncul setelah ada barang.</p>
          ) : preview.isFetching || previewKey !== currentKey ? (
            <p className="text-slate-500">Menghitung total…</p>
          ) : (
            <>
              {estimate && <Row label="Perkiraan subtotal" value={formatRupiah(estimate)} />}
              <p className="text-xs text-slate-500">
                {previewMissing
                  ? 'Total resmi (diskon, PPN) dihitung server saat transaksi diproses dan tampil di struk.'
                  : 'Total dari server belum tersedia.'}
              </p>
              {previewErrors.general && <p role="alert" className="text-xs text-red-700">{previewErrors.general}</p>}
            </>
          )}
        </div>

        {mode === 'cash' && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
            <Field label="Uang diterima (Rp)" error={tenderedError ?? errors.fields.amount_tendered}>
              <input
                className={`${inputCls} text-lg tabular-nums`}
                inputMode="decimal"
                value={tendered}
                disabled={locked}
                onChange={(e) => { setTendered(e.target.value); setTenderedError(undefined); setErrors(NO_ERRORS); }}
              />
            </Field>
            {change !== null && (
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-slate-600">Kembalian</span>
                <span className="text-lg font-semibold tabular-nums">{formatRupiah(change)}</span>
              </div>
            )}
          </div>
        )}

        {errors.fields.shift && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errors.fields.shift}</div>}
        {errors.fields.payment_mode && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errors.fields.payment_mode}</div>}
        {!unknownOutcome && topError !== null && <ErrorNotice error={topError} />}

        <button
          type="button"
          disabled={locked || !sellingAllowed || lines.length === 0}
          onClick={startPay}
          className="w-full rounded-md bg-emerald-700 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          {mutation.isPending ? 'Memproses…' : creditNeedsException ? 'Minta pengecualian Admin' : 'Bayar'}
        </button>
        {lines.length > 0 && !locked && (
          <button
            type="button"
            onClick={() => { setLines([]); setErrors(NO_ERRORS); setTenderedError(undefined); setCartKey(newIdempotencyKey()); }}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          >
            Kosongkan keranjang
          </button>
        )}
      </aside>

      {confirming && (
        <Modal title="Proses transaksi?" onClose={() => { if (!mutation.isPending) setConfirming(false); }}>
          <div className="space-y-2 p-5 text-sm">
            <p>{lines.length} jenis barang · {MODE_LABEL[mode]}</p>
            {total !== null
              ? <p className="text-2xl font-semibold tabular-nums">{formatRupiah(total)}</p>
              : <p className="text-slate-600">Total resmi dihitung server saat diproses{estimate ? ` (perkiraan subtotal ${formatRupiah(estimate)})` : ''}.</p>}
            {mode === 'payroll_credit' && customer && <p>Atas nama <span className="font-medium">{customer.name}</span> ({customer.customer_no}); ditagihkan lewat potong gaji.</p>}
            {mode === 'cash' && <p>Uang diterima {formatRupiah(tendered.trim().replace(',', '.'))}{change !== null ? `, kembalian ${formatRupiah(change)}` : ''}.</p>}
            <p className="text-slate-500">Setelah diproses, transaksi tidak dapat diubah (pembatalan hanya oleh Admin).</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={mutation.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Periksa lagi</button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => { if (!mutation.isPending) mutation.mutate(buildInput()); }}
              className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {mutation.isPending ? 'Memproses…' : 'Proses'}
            </button>
          </div>
        </Modal>
      )}

      {exceptionOpen && (
        <CreditExceptionDialog
          reason={errors.fields.credit_limit ?? (quote?.credit?.exceeds_limit ? `Melebihi sisa batas kredit (sisa ${formatRupiah(quote.credit.remaining_before)}).` : customer?.credit_state === 'exhausted' ? 'Sisa batas kredit karyawan sudah habis.' : undefined)}
          errors={errors.fields}
          busy={mutation.isPending}
          onSubmit={(ex) => { if (!mutation.isPending) mutation.mutate(buildInput(ex)); }}
          onCancel={() => { setExceptionOpen(false); setErrors(NO_ERRORS); changeMode('cash'); }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between tabular-nums">
      <span className="text-slate-600">{label}</span>
      <span>{value}</span>
    </div>
  );
}
