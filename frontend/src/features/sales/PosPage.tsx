import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { opnameLockApi, saleApi, shiftApi } from '@/lib/api/endpoints';
import type { CreditExceptionInput, Customer, PaymentMode, Sale, SaleInput, SalePreviewInput } from '@/lib/api/types';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/features/auth/AuthProvider';
import { canSell } from '@/features/shifts/shiftLogic';
import { CREDIT_HINT, canUseCredit } from '@/features/customers/creditState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { LocalDecimalInput } from '@/components/ui/LocalDecimalInput';
import { Modal } from '@/components/ui/Modal';
import { formatQty, formatRupiah } from '@/lib/format';
import { milliToQty, moneyToCents, qtyToMilli, subtractMoney } from '@/lib/money';
import {
  addProduct, buildSaleInput, mapSaleErrors, mustChangeKey, needsCreditException, newIdempotencyKey,
  parseQty, removeLine, salePreviewChanged, setQty, validateCart, validateTendered,
  type CartLine, type CartProduct, type SaleErrors,
} from './cartLogic';
import { CreditExceptionDialog } from './CreditExceptionDialog';
import { CustomerPicker } from './CustomerPicker';
import { ProductSearch } from './ProductSearch';
import { ReceiptView } from './ReceiptView';
import { loadReceiptPaperSize, RECEIPT_PAPER_LABELS, type ThermalPaperSize } from './receiptPrintSettings';

const NO_ERRORS: SaleErrors = { lines: {}, fields: {} };
const MODE_LABEL: Record<PaymentMode, string> = { cash: 'Tunai', payroll_credit: 'Kredit potong gaji' };

/** Layar kasir. Harga, diskon, PPN, dan total resmi selalu dari server (pratinjau dan struk). */
export function PosPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const searchRef = useRef<HTMLInputElement>(null);
  const tenderedRef = useRef<HTMLInputElement>(null);
  const qtyInputRefs = useRef(new Map<number, HTMLInputElement>());
  const printedSaleIdRef = useRef<number | null>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [lastAddedLineKey, setLastAddedLineKey] = useState<number | null>(null);
  const [scanQuantityProductId, setScanQuantityProductId] = useState<number | null>(null);
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tendered, setTendered] = useState('');
  const [tenderedError, setTenderedError] = useState<string | undefined>();
  /** Kunci idempotensi: satu per keranjang. Diganti hanya setelah sukses atau bila server menolak kuncinya. */
  const [cartKey, setCartKey] = useState(() => newIdempotencyKey());
  const [errors, setErrors] = useState<SaleErrors>(NO_ERRORS);
  const [topError, setTopError] = useState<unknown>(null);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [confirmPayment, setConfirmPayment] = useState(false);
  /** Permintaan yang hasilnya tidak diketahui (jaringan putus/5xx). Keranjang dikunci; kirim ulang memakai kunci yang sama. */
  const [pending, setPending] = useState<SaleInput | null>(null);
  const [done, setDone] = useState<{ sale: Sale; replayed: boolean; previewTotal: string | null } | null>(null);
  const [showPrintPrompt, setShowPrintPrompt] = useState(false);
  const [printRequestSaleId, setPrintRequestSaleId] = useState<number | null>(null);
  const [thermalPaperSize] = useState<ThermalPaperSize>(() => loadReceiptPaperSize());
  const [printError, setPrintError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  const shiftQuery = useQuery({ queryKey: ['shifts', 'current'], queryFn: shiftApi.current });
  const opnameLock = useQuery({
    queryKey: ['stock-opname', 'lock-status'],
    queryFn: opnameLockApi.status,
    refetchInterval: () => document.visibilityState === 'visible' ? 30_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
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
    enabled: previewKey !== '',
    retry: false,
    staleTime: 0,
  });

  const previewFresh = preview.data !== undefined && !preview.isFetching && previewKey === currentKey && currentKey !== '';
  const quote = previewFresh ? preview.data : undefined;
  const previewErrors = preview.error instanceof ApiError && preview.error.status === 422 ? mapSaleErrors(preview.error.errors) : NO_ERRORS;
  const total = quote?.total ?? null;

  // ---------------------------------------------------------------- posting
  const mutation = useMutation({
    mutationFn: (input: SaleInput) => saleApi.post(input),
    onSuccess: (res) => {
      setDone({ sale: res.data, replayed: res.replayed, previewTotal: quote?.total ?? null });
      setShowPrintPrompt(!res.replayed);
      setLines([]);
      setLastAddedLineKey(null);
      setCustomer(null);
      setTendered('');
      setTenderedError(undefined);
      setMode('cash');
      setErrors(NO_ERRORS);
      setTopError(null);
      setPending(null);
      setExceptionOpen(false);
      setCartKey(newIdempotencyKey());
      void qc.invalidateQueries({ queryKey: ['shifts'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err, input) => {
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

  const requestLocked = mutation.isPending || pending !== null;
  const locked = requestLocked || confirmPayment;

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
        setErrors({ lines: {}, fields: { customer_id: customer ? CREDIT_HINT[customer.credit_state] : 'Pilih debitur untuk kredit.' } });
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
    setConfirmPayment(true);
  }

  function confirmPay() {
    if (!confirmPayment || requestLocked) return;
    setConfirmPayment(false);
    mutation.mutate(buildInput());
  }

  function clearCart() {
    if (locked || lines.length === 0) return;
    setLines([]);
    setLastAddedLineKey(null);
    setErrors(NO_ERRORS);
    setTenderedError(undefined);
    setCartKey(newIdempotencyKey());
  }

  function removeCartLine(lineKey: number) {
    if (locked) return;
    const activeElement = document.activeElement;
    const focusWasInRemovedLine = activeElement instanceof HTMLElement
      && activeElement.closest('[data-pos-line-key]')?.getAttribute('data-pos-line-key') === String(lineKey);
    const remaining = removeLine(lines, lineKey);
    if (remaining.length === lines.length) return;
    setLines(remaining);
    setLastAddedLineKey((current) => (
      current === lineKey ? remaining[remaining.length - 1]?.key ?? null : current
    ));
    setErrors(NO_ERRORS);
    if (focusWasInRemovedLine) setTimeout(() => searchRef.current?.focus(), 0);
  }

  function removeLastAddedLine() {
    const lastAdded = lines.find((line) => line.key === lastAddedLineKey) ?? lines[lines.length - 1];
    if (lastAdded) removeCartLine(lastAdded.key);
  }

  function reset() {
    setDone(null);
    setErrors(NO_ERRORS);
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  async function toggleFullscreen() {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement === document.documentElement) {
        await document.exitFullscreen();
      } else {
        const root = document.documentElement;
        if (typeof root.requestFullscreen !== 'function') {
          setFullscreenError('Browser ini tidak mendukung mode layar penuh.');
          return;
        }
        await root.requestFullscreen();
      }
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      setFullscreenError(`Tidak dapat mengubah mode layar penuh.${detail}`);
    }
  }

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === document.documentElement);
    document.addEventListener('fullscreenchange', syncFullscreen);
    syncFullscreen();
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    if (!done || printRequestSaleId !== done.sale.id || printedSaleIdRef.current === done.sale.id) return;
    printedSaleIdRef.current = done.sale.id;
    const clearPrintRequest = () => setPrintRequestSaleId(null);
    window.addEventListener('afterprint', clearPrintRequest, { once: true });
    const timer = window.setTimeout(() => {
      try {
        window.print();
      } catch (error) {
        window.removeEventListener('afterprint', clearPrintRequest);
        setPrintRequestSaleId(null);
        setPrintError(error instanceof Error ? `Gagal membuka cetak struk: ${error.message}` : 'Gagal membuka cetak struk.');
      }
    }, 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', clearPrintRequest);
    };
  }, [done, printRequestSaleId]);

  function skipReceiptPrint() {
    setShowPrintPrompt(false);
  }

  function printReceipt() {
    if (!done) return;
    setShowPrintPrompt(false);
    setPrintRequestSaleId(done.sale.id);
  }

  const fullscreenControl = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={isFullscreen}
        onClick={() => void toggleFullscreen()}
        title={isFullscreen ? 'Keluar dari layar penuh' : 'Sembunyikan sidebar dan tab browser'}
        className="h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
      >
        {isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
      </button>
      {fullscreenError && <p role="alert" className="text-sm text-red-700">{fullscreenError}</p>}
    </div>
  );

  useEffect(() => { if (sellingAllowed && !done) searchRef.current?.focus(); }, [sellingAllowed, done]);

  useEffect(() => {
    if (scanQuantityProductId === null) return;
    const input = qtyInputRefs.current.get(scanQuantityProductId);
    if (!input) return;
    input.focus();
    input.select();
    setScanQuantityProductId(null);
  }, [lines, scanQuantityProductId]);

  function pick(p: CartProduct, source: 'scan' | 'search' = 'search') {
    const existing = lines.some((line) => line.product.id === p.id);
    const nextLines = addProduct(lines, p);
    if (nextLines === lines) return 'limit';
    setLines(nextLines);
    setLastAddedLineKey(nextLines.find((line) => line.product.id === p.id)?.key ?? null);
    if (source === 'search') setScanQuantityProductId(p.id);
    setErrors(NO_ERRORS);
    setTopError(null);
    searchRef.current?.focus();
    return existing ? 'incremented' : 'added';
  }

  function changeMode(m: PaymentMode) {
    if (locked) return;
    setMode(m);
    setErrors(NO_ERRORS);
    setTenderedError(undefined);
    if (m === 'cash') setCustomer(null);
  }

  // ---------------------------------------------------------------- tampilan
  if (shiftQuery.isLoading) return <div className="p-6 text-slate-500">Memuat kasir jaga…</div>;

  if (done) {
    return (
      <div className="space-y-4 p-6">
        <div className="no-print max-w-md space-y-2">
          <h1 className="text-xl font-semibold">Transaksi tersimpan</h1>
          {done.replayed && (
            <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Struk ini sudah tercatat sebelumnya; permintaan ulang tidak membuat transaksi ganda. Cetak ulang hanya jika diperlukan.
            </p>
          )}
          {!done.replayed && (
            <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
              Transaksi berhasil disimpan.
            </p>
          )}
          {salePreviewChanged(done.previewTotal, done.sale.total) && (
            <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Total berubah sejak pratinjau. Struk memakai total final server dari saat transaksi diproses.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            {fullscreenControl}
            <button type="button" onClick={() => window.print()} className="h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Cetak ulang</button>
            <button
              type="button"
              autoFocus
              onClick={reset}
              aria-keyshortcuts="Enter"
              className="h-10 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              Transaksi baru
            </button>
          </div>
        </div>
        {printError && <p role="alert" className="no-print rounded-md bg-red-50 p-3 text-sm text-red-800">{printError}</p>}
        <ReceiptView sale={done.sale} paperSize={thermalPaperSize} />
        {showPrintPrompt && (
          <Modal title="Cetak struk?" onClose={skipReceiptPrint} closeOnEscape={false} showCloseButton={false}>
            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-700">Transaksi sudah tersimpan. Apakah struk ingin dicetak sekarang?</p>
              <p className="text-xs text-slate-500">Ukuran aktif: {RECEIPT_PAPER_LABELS[thermalPaperSize]}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button type="button" onClick={skipReceiptPrint} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
                Lewati
              </button>
              <button type="button" autoFocus onClick={printReceipt} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                Cetak
              </button>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  const unknownOutcome = pending !== null;
  const change = mode === 'cash' && total !== null && !validateTendered(tendered, total) ? subtractMoney(tendered.trim().replace(',', '.'), total) : null;

  return (
    <div
      className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_30rem]"
      onKeyDown={(event) => {
        if (confirmPayment) {
          if (event.key === 'Enter' && !event.ctrlKey) {
            event.preventDefault();
            confirmPay();
          }
          return;
        }
        if (exceptionOpen) return;
        if (
          event.key === 'Enter' &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          !event.shiftKey &&
          event.target === searchRef.current &&
          searchRef.current.value.trim() === ''
        ) {
          const lastAdded = lines.find((line) => line.key === lastAddedLineKey) ?? lines[lines.length - 1];
          if (lastAdded) {
            event.preventDefault();
            qtyInputRefs.current.get(lastAdded.product.id)?.focus();
          }
          return;
        }
        if (event.key === 'F2' && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault();
          if (event.shiftKey) {
            if (!event.repeat) removeLastAddedLine();
          } else {
            clearCart();
          }
          return;
        }
        if (event.ctrlKey && event.key === 'Enter' && !exceptionOpen) {
          event.preventDefault();
          startPay();
        }
      }}
    >
      <section className="min-w-0 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Kasir</h1>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {shift && <span className="font-mono text-xs text-slate-500">{shift.doc_number}</span>}
            {fullscreenControl}
          </div>
        </div>

        <ErrorNotice error={shiftQuery.error} />
        <ErrorNotice error={opnameLock.error} />
        {opnameLock.data?.locked && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
            {opnameLock.data.store_wide ? 'Penjualan ditutup: opname' : 'Sebagian produk ditutup: opname'}
          </div>
        )}
        {!shiftQuery.error && !sellingAllowed && (
          <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {shift?.status === 'counting'
              ? 'Kasir jaga sedang dihitung; penjualan baru diblokir sampai kasir jaga ditutup.'
              : 'Belum ada kasir jaga berjalan. Buka kasir jaga terlebih dahulu sebelum berjualan.'}{' '}
            <Link to="/shift" className="font-medium underline">Ke Kasir Jaga Saya</Link>
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
                  <tr key={l.key} data-pos-line-key={l.key}>
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
                      <LocalDecimalInput
                        elementRef={(element) => {
                          if (element) qtyInputRefs.current.set(l.product.id, element);
                          else qtyInputRefs.current.delete(l.product.id);
                        }}
                        className={`${inputCls} tabular-nums ${e.qty ? 'border-red-400' : ''}`}
                        kind="quantity"
                        aria-label={`Qty ${l.product.name}`}
                        value={l.qty}
                        disabled={locked}
                        onChange={(value) => { setLines((ls) => setQty(ls, l.key, value)); setErrors(NO_ERRORS); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.ctrlKey) {
                            event.preventDefault();
                            (mode === 'cash' ? tenderedRef.current : searchRef.current)?.focus();
                          }
                        }}
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
                        onClick={() => removeCartLine(l.key)}
                        aria-label={`Hapus ${l.product.name}`}
                        aria-keyshortcuts={lastAddedLineKey === l.key ? 'Shift+F2' : undefined}
                        title={lastAddedLineKey === l.key ? 'Shortcut: Shift+F2' : undefined}
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
              <p className="text-sm text-slate-500">Akun ini tidak berhak memilih debitur.</p>
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

        <div className="space-y-2 rounded-xl border-2 border-slate-300 bg-white p-5 text-base shadow-sm sm:p-6">
          {quote ? (
            <>
              <Row label="Subtotal" value={formatRupiah(quote.subtotal)} />
              {(moneyToCents(quote.discount_total) ?? 0n) !== 0n && <Row label="Diskon" value={`-${formatRupiah(quote.discount_total)}`} />}
              {(moneyToCents(quote.tax_amount) ?? 0n) !== 0n && <Row label={`PPN${quote.tax_rate ? ` ${formatQty(quote.tax_rate)}%` : ''}`} value={formatRupiah(quote.tax_amount)} />}
              <div className="space-y-1 border-t border-slate-300 pt-3">
                <span className="block text-lg font-semibold">Total</span>
                <span className="block text-4xl font-extrabold leading-tight tabular-nums tracking-tight sm:text-5xl xl:text-6xl">{formatRupiah(quote.total)}</span>
              </div>
            </>
          ) : lines.length === 0 ? (
            <p className="text-slate-500">Total muncul setelah ada barang.</p>
          ) : preview.isFetching || previewKey !== currentKey ? (
            <p className="text-slate-500">Menghitung total…</p>
          ) : (
            <>
              <p className="text-xs text-slate-500">Total resmi dari server belum tersedia.</p>
              {previewErrors.general && <p role="alert" className="text-xs text-red-700">{previewErrors.general}</p>}
              {preview.error instanceof ApiError && preview.error.status !== 422 && (
                <ErrorNotice error={preview.error} />
              )}
            </>
          )}
        </div>

        {mode === 'cash' && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
            <Field label="Uang diterima (Rp)" error={tenderedError ?? errors.fields.amount_tendered}>
              <input
                ref={tenderedRef}
                className={`${inputCls} text-lg tabular-nums`}
                inputMode="decimal"
                value={tendered}
                disabled={locked}
                onChange={(e) => { setTendered(e.target.value); setTenderedError(undefined); setErrors(NO_ERRORS); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.ctrlKey) {
                    event.preventDefault();
                    searchRef.current?.focus();
                  }
                }}
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
          aria-keyshortcuts="Control+Enter"
          title="Shortcut: Ctrl+Enter"
          className="w-full rounded-md bg-emerald-700 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          {mutation.isPending ? 'Memproses…' : `${creditNeedsException ? 'Minta pengecualian Admin' : 'Bayar'} (Ctrl + ENTER)`}
        </button>
        {lines.length > 0 && !locked && (
          <button
            type="button"
            onClick={clearCart}
            aria-keyshortcuts="F2"
            title="Shortcut: F2"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          >
            Kosongkan keranjang (F2)
          </button>
        )}
      </aside>

      {exceptionOpen && (
        <CreditExceptionDialog
          reason={errors.fields.credit_limit ?? (quote?.credit?.exceeds_limit ? `Melebihi sisa batas kredit (sisa ${formatRupiah(quote.credit.remaining_before)}).` : customer?.credit_state === 'exhausted' ? 'Sisa batas kredit debitur sudah habis.' : undefined)}
          errors={errors.fields}
          busy={mutation.isPending}
          closeOnEscape={false}
          onSubmit={(ex) => { if (!mutation.isPending) mutation.mutate(buildInput(ex)); }}
          onCancel={() => { setExceptionOpen(false); setErrors(NO_ERRORS); changeMode('cash'); }}
        />
      )}
      {confirmPayment && (
        <Modal title="Selesaikan transaksi" onClose={() => setConfirmPayment(false)} closeOnEscape={false}>
          <div className="space-y-4 p-5">
            <p className="text-sm text-slate-700">Pastikan pembayaran dan daftar barang sudah benar.</p>
            <p className="rounded-md bg-amber-50 p-3 text-sm font-medium text-amber-900">
              Tekan ENTER untuk menyimpan transaksi. Setelah berhasil, Anda dapat memilih untuk mencetak struk atau melewatinya.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              onClick={() => setConfirmPayment(false)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="button"
              autoFocus
              onClick={confirmPay}
              className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white"
            >
              Selesaikan transaksi
            </button>
          </div>
        </Modal>
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
