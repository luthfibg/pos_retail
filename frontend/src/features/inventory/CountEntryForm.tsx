import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Field, inputCls } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/client';
import { opnameApi } from '@/lib/api/endpoints';
import type { OpnameItem } from '@/lib/api/types';
import type { ProductOption } from './openingForm';
import { ProductPicker, type ProductPickerResult } from '@/features/products/ProductPicker';
import { formatQty } from '@/lib/format';
import { useOpnameCountMutation, type OpnameCountMutationInput } from './useOpnameCountMutation';
import { useOpnameWorkspace } from './OpnameWorkspaceContext';
import { useScannerCapture } from './useScannerCapture';
import { findOfflineItems, getPendingOfflineItems } from './useOpnameOffline';

interface Props {
  sessionId: number;
  active: boolean;
  canCount: boolean;
  revealsSystemQty: boolean;
  onScanSuccess: () => void;
  onScanError: () => void;
}

function isOpnameItem(product: ProductPickerResult): product is OpnameItem {
  return 'counted_qty' in product;
}

function isCount(value: string): boolean {
  return /^\d{1,7}$/.test(value) && Number(value) <= 1_000_000;
}

function itemLabel(item: Pick<OpnameItem, 'name' | 'barcode'>): string {
  return `${item.name}${item.barcode ? ` · ${item.barcode}` : ''}`;
}

export function CountEntryForm({
  sessionId,
  active,
  canCount,
  revealsSystemQty,
  onScanSuccess,
  onScanError,
}: Props) {
  const [pickerValue, setPickerValue] = useState<ProductOption | null>(null);
  const [quantity, setQuantity] = useState('');
  const quantityValue = useRef('');
  const [fieldError, setFieldError] = useState('');
  const [message, setMessage] = useState('');
  const [retryInput, setRetryInput] = useState<OpnameCountMutationInput | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [manualSearch, setManualSearch] = useState(false);
  const [scanConflict, setScanConflict] = useState('');
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [touchInput, setTouchInput] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(window.crypto.randomUUID());
  const {
    selectedItem: pickedItem,
    setSelectedItem: setPickedItem,
    setHighlightedItemId,
    loadItem,
    isOnline,
    markOffline,
    offlineIndex,
    offlineIndexReady,
    pendingOperations,
  } = useOpnameWorkspace();
  const mutation = useOpnameCountMutation(sessionId);
  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => setTouchInput(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!pickedItem) return;
    setPickerValue({
      id: pickedItem.product_id,
      sku: '',
      name: pickedItem.name,
      unit_name: '',
      track_expiry: false,
    });
    quantityValue.current = '';
    setQuantity('');
    setFieldError('');
    setMessage('');
    setRetryInput(null);
    requestId.current = window.crypto.randomUUID();
  }, [pickedItem, setPickedItem]);

  const searchAdapter = async (query: string, mode: 'auto' | 'search') => {
    if (!isOnline) {
      if (!offlineIndexReady) throw new Error('Indeks offline belum tersedia. Sambungkan jaringan untuk mencari produk.');
      return findOfflineItems(offlineIndex, query, mode, pendingOperations);
    }
    try {
      return await opnameApi.lookup(sessionId, query, mode);
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        markOffline();
        if (offlineIndexReady) return findOfflineItems(offlineIndex, query, mode, pendingOperations);
      }
      throw error;
    }
  };

  function chooseResult(result: ProductPickerResult) {
    if (!isOpnameItem(result)) return;
    loadItem(getPendingOfflineItems(offlineIndex, pendingOperations).find((item) => item.id === result.id) ?? result);
    quantityValue.current = '';
    setQuantity('');
    setFieldError('');
    setMessage('');
    setRetryInput(null);
    setManualSearch(false);
    setScanConflict('');
    requestId.current = window.crypto.randomUUID();
  }

  function changeQuantity(next: string) {
    quantityValue.current = next;
    setQuantity(next);
    setFieldError('');
  }

  function appendDigits(digits: string) {
    let next = quantityValue.current;
    let exceededLimit = false;
    for (const digit of digits) {
      if (next.length >= 7 || Number(`${next}${digit}`) > 1_000_000) {
        exceededLimit = true;
        continue;
      }
      next += digit;
    }
    changeQuantity(next);
    if (exceededLimit) setFieldError('Jumlah hitung maksimal 1.000.000.');
  }

  function handleScan(code: string) {
    if (pickedItem && (quantityValue.current !== '' || retryInput !== null)) {
      setScanConflict(pickedItem.name);
      onScanError();
      return;
    }
    setScanConflict('');
    void searchAdapter(code, 'auto').then((items) => {
      if (!items[0]) {
        setMessage(!isOnline
          ? 'Barcode tidak ada di indeks sesi offline.'
          : 'Barcode tidak dikenal.');
        onScanError();
        return;
      }
      chooseResult(items[0]);
      onScanSuccess();
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'not_in_session') {
        setMessage(error.message);
      } else if (error instanceof ApiError && error.code === 'unknown_barcode') {
        setMessage('Barcode tidak dikenal.');
      } else {
        setMessage(error instanceof Error ? error.message : 'Produk tidak dapat dicari.');
      }
      onScanError();
    });
  }

  function submitWithKeyboard() {
    if (!pickedItem) return;
    if (pickedItem.counted_qty !== null) {
      setMessage('Pilih Ganti atau Tambah secara eksplisit untuk produk yang sudah dihitung.');
      return;
    }
    if (!isCount(quantityValue.current)) {
      setFieldError('Isi bilangan bulat dari 0 sampai 1.000.000.');
      return;
    }
    save('set');
  }

  useScannerCapture({
    active: active && canCount && !sessionEnded,
    onScan: handleScan,
    onDigit: appendDigits,
    onBackspace: () => changeQuantity(quantityValue.current.slice(0, -1)),
    onEnter: submitWithKeyboard,
  });

  function clearSelection() {
    setPickedItem(null);
    setPickerValue(null);
    changeQuantity('');
    setFieldError('');
    setMessage('');
    setRetryInput(null);
    setScanConflict('');
    setManualSearch(false);
    requestId.current = window.crypto.randomUUID();
  }

  function save(mode: 'set' | 'add') {
    if (!pickedItem || mutation.isPending || retryInput) return;
    const inputQuantity = quantityValue.current;
    if (!isCount(inputQuantity)) {
      setFieldError('Isi bilangan bulat dari 0 sampai 1.000.000.');
      return;
    }
    if (mode === 'add' && Number(inputQuantity) < 1) {
      setFieldError('Jumlah tambahan minimal 1.');
      return;
    }

    setFieldError('');
    setMessage('');
    mutation.mutate({
      action: 'count',
      item_id: pickedItem.id,
      mode,
      quantity: Number(inputQuantity),
      client_request_id: requestId.current,
      item: pickedItem,
    }, {
      onSuccess: (result) => {
        setAnnouncement(`Hitungan ${itemLabel(result.item)} tersimpan.`);
        setPickedItem(null);
        setPickerValue(null);
        changeQuantity('');
        setFieldError('');
        setMessage('');
        setRetryInput(null);
        setManualSearch(false);
        setScanConflict('');
        requestId.current = window.crypto.randomUUID();
        setHighlightedItemId(result.item.id);
        window.setTimeout(() => setHighlightedItemId(null), 2_500);
      },
      onError: handleError,
    });
  }

  function handleError(error: Error, variables: OpnameCountMutationInput) {
    if (error instanceof ApiError && error.status === 422) {
      setFieldError(error.firstError('quantity'));
      return;
    }
    if (error instanceof ApiError && error.status === 409 && error.code === 'opname_session_not_countable') {
      setSessionEnded(true);
      setMessage(error.message);
      return;
    }
    if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
      setRetryInput(variables);
      setMessage('Koneksi terputus atau hasil simpan belum diketahui. Coba lagi dengan data yang sama.');
      return;
    }
    setMessage(error.message);
  }

  function retry() {
    if (!retryInput || mutation.isPending) return;
    mutation.mutate(retryInput, {
      onSuccess: (result) => {
        setAnnouncement(`Hitungan ${itemLabel(result.item)} tersimpan.`);
        setPickedItem(null);
        setPickerValue(null);
        changeQuantity('');
        setRetryInput(null);
        setMessage('');
        setManualSearch(false);
        setScanConflict('');
        requestId.current = window.crypto.randomUUID();
        setHighlightedItemId(result.item.id);
        window.setTimeout(() => setHighlightedItemId(null), 2_500);
      },
      onError: handleError,
    });
  }

  function clearCount() {
    if (!pickedItem || pickedItem.counted_qty === null || mutation.isPending || retryInput) return;
    if (!window.confirm(`Hapus hitungan untuk ${pickedItem.name}?`)) return;
    const request: OpnameCountMutationInput = {
      action: 'clear',
      item_id: pickedItem.id,
      client_request_id: window.crypto.randomUUID(),
      item: pickedItem,
    };
    mutation.mutate(request, {
      onSuccess: (result) => {
        setPickedItem(result.item);
        changeQuantity('');
        setMessage('');
        setAnnouncement(`Hitungan ${result.item.name} dihapus.`);
        setHighlightedItemId(result.item.id);
        window.setTimeout(() => setHighlightedItemId(null), 2_500);
      },
      onError: (error) => handleError(error, request),
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitWithKeyboard();
  }

  const disabled = !active || !canCount || mutation.isPending || retryInput !== null || sessionEnded;
  const counted = pickedItem?.counted_qty !== null && pickedItem !== null;
  const previewVariance = pickedItem?.system_qty !== undefined && isCount(quantity)
    ? Number(quantity) - Number(pickedItem.system_qty)
    : null;

  return (
    <div className="space-y-3">
      <input
        data-opname-scanner-capture
        aria-hidden="true"
        tabIndex={-1}
        inputMode="none"
        autoComplete="off"
        className="fixed -left-[10000px] top-0 h-px w-px opacity-0"
      />
      {!active ? (
        <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">Sesi ini dalam mode baca.</p>
      ) : !canCount ? (
        <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">Akun Anda tidak memiliki izin mencatat hitungan.</p>
      ) : (
        <>
          {!pickedItem && !manualSearch && (
            <div className="rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-lg font-semibold">Scan barcode</p>
              <p className="mt-1 text-xs text-slate-600">Arahkan scanner ke barcode.</p>
              {/* Scanner harus mengirim Enter atau Tab setelah kode. */}
              <button type="button" onClick={() => setManualSearch(true)} className="mt-2 min-h-11 px-3 text-sm underline">Cari manual</button>
            </div>
          )}

          {manualSearch && !pickedItem && (
            <Field label="Cari produk dalam sesi">
              <ProductPicker
                value={pickerValue}
                onChange={(value) => {
                  setPickerValue(value);
                  if (!value) clearSelection();
                }}
                onSelectResult={chooseResult}
                searchAdapter={searchAdapter}
                searchAdapterKey={sessionId}
                inputRef={pickerRef}
                placeholder="Ketik nama atau barcode"
                disabled={disabled}
              />
            </Field>
          )}

          {pickedItem && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{pickedItem.name}</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-600">{pickedItem.barcode || 'Tanpa barcode'}</p>
                  <p className="mt-1 text-xs text-slate-600">{pickedItem.category_path.join(' › ') || 'Lainnya'}</p>
                </div>
                <button type="button" disabled={disabled} onClick={clearSelection} className="min-h-11 shrink-0 px-2 text-xs underline">Batal</button>
              </div>
              {counted && <p className="mt-2 font-medium">Sudah dihitung: {pickedItem.counted_qty}</p>}
              {pendingOperations.some((operation) => operation.item.item_id === pickedItem.id) && (
                <span className="mt-1 inline-flex min-h-7 items-center rounded-full bg-amber-100 px-2 text-xs font-medium text-amber-900">belum tersinkron</span>
              )}
              {isOnline && revealsSystemQty && pickedItem.system_qty !== undefined && (
                <div className="mt-2 border-t border-slate-200 pt-2 text-xs">
                  <p>Stok sistem: {formatQty(pickedItem.system_qty)}</p>
                  {previewVariance !== null && <p>Pratinjau selisih: {previewVariance > 0 ? '+' : ''}{previewVariance}</p>}
                </div>
              )}
            </div>
          )}

          {scanConflict && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <span>Simpan atau batalkan {scanConflict} dulu.</span>
              <button type="button" onClick={clearSelection} className="min-h-11 shrink-0 px-2 font-medium underline">Batal</button>
            </div>
          )}
          {message && <div role="alert" className="space-y-2 text-sm text-red-700"><p>{message}</p>{retryInput && <button type="button" disabled={mutation.isPending} onClick={retry} className="min-h-11 rounded-md border border-red-300 px-4 font-medium disabled:opacity-50">{mutation.isPending ? 'Menyimpan…' : 'Coba lagi'}</button>}</div>}

          {pickedItem && (
            <form onSubmit={submit} className="space-y-3">
              <Field label="Jumlah hitung" error={fieldError}>
                <div className="grid grid-cols-[3rem_minmax(0,1fr)_3rem] gap-2">
                  <button type="button" disabled={disabled} onClick={() => changeQuantity(String(Math.max(0, (Number(quantity) || 0) - 1)))} className="min-h-12 rounded-md border border-slate-300 text-2xl disabled:opacity-50" aria-label="Kurangi jumlah">−</button>
                  <input
                    type="text"
                    inputMode="none"
                    readOnly
                    value={quantity}
                    aria-label="Jumlah hitung"
                    aria-describedby="opname-count-hint"
                    tabIndex={-1}
                    onFocus={(event) => event.currentTarget.blur()}
                    className={`${inputCls} min-h-12 text-center text-xl tabular-nums`}
                  />
                  <button type="button" disabled={disabled} onClick={() => changeQuantity(String(Math.min(1_000_000, (Number(quantity) || 0) + 1)))} className="min-h-12 rounded-md border border-slate-300 text-2xl disabled:opacity-50" aria-label="Tambah jumlah">+</button>
                </div>
                <p id="opname-count-hint" className="mt-1 text-xs text-slate-500">Isi jumlah yang ditemukan. Nilai 0 juga sah.</p>
                <button type="button" disabled={disabled} onClick={() => { changeQuantity('0'); setFieldError(''); }} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 text-sm font-medium disabled:opacity-50">0 — tidak ada</button>
              </Field>

              {!touchInput && (
                <button type="button" onClick={() => setKeypadOpen((value) => !value)} className="min-h-11 w-full rounded-md border border-slate-300 text-sm">
                  {keypadOpen ? 'Sembunyikan keypad' : 'Tampilkan keypad'}
                </button>
              )}
              {(touchInput || keypadOpen) && (
                <QuantityKeypad
                  disabled={disabled}
                  onDigit={appendDigits}
                  onBackspace={() => changeQuantity(quantityValue.current.slice(0, -1))}
                  onClear={() => changeQuantity('')}
                />
              )}

              {fieldError && <p role="alert" className="text-sm text-red-700">{fieldError}</p>}
              <div className="sticky bottom-14 z-10 -mx-3 bg-white px-3 py-2 shadow-[0_-8px_16px_-12px_rgba(15,23,42,0.4)] md:bottom-0">
                {!counted ? (
                  <button type="submit" disabled={disabled || !quantity} className="min-h-14 w-full rounded-md bg-slate-900 px-4 text-base font-semibold text-white disabled:opacity-50">
                    {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
                  </button>
                ) : (
                  <div className="grid gap-2">
                    <button type="button" disabled={disabled || !quantity} onClick={() => save('set')} className="min-h-14 rounded-md bg-slate-900 px-4 text-base font-semibold text-white disabled:opacity-50">
                      {mutation.isPending ? 'Menyimpan…' : `Ganti jadi ${quantity || '…'}`}
                    </button>
                    <button type="button" disabled={disabled || !quantity || Number(quantity) < 1} onClick={() => save('add')} className="min-h-14 rounded-md border border-slate-300 px-4 text-base font-semibold disabled:opacity-50">
                      {mutation.isPending ? 'Menyimpan…' : `Tambah ${quantity || '…'} (jadi ${(Number(pickedItem.counted_qty) || 0) + (Number(quantity) || 0)})`}
                    </button>
                    <button type="button" disabled={disabled} onClick={clearCount} className="min-h-11 rounded-md text-sm text-red-700 underline disabled:opacity-50">Hapus hitungan</button>
                  </div>
                )}
              </div>
            </form>
          )}
          <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
        </>
      )}
    </div>
  );
}

function QuantityKeypad({
  disabled,
  onDigit,
  onBackspace,
  onClear,
}: {
  disabled: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  return (
    <div aria-label="Keypad jumlah" className="opname-keypad grid grid-cols-3 gap-2">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          aria-label={key === 'C' ? 'Hapus jumlah' : key === '⌫' ? 'Hapus satu digit' : `Angka ${key}`}
          onClick={key === 'C' ? onClear : key === '⌫' ? onBackspace : () => onDigit(key)}
          className="min-h-14 rounded-md border border-slate-300 text-xl font-semibold disabled:opacity-50"
        >
          {key}
        </button>
      ))}
    </div>
  );
}
