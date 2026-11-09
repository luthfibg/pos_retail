import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Field, inputCls } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/client';
import { opnameApi } from '@/lib/api/endpoints';
import type { OpnameCountLog, OpnameItem } from '@/lib/api/types';
import type { ProductOption } from './openingForm';
import { ProductPicker, type ProductPickerResult } from '@/features/products/ProductPicker';
import { formatDateTime, formatQty } from '@/lib/format';
import { useOpnameCountMutation, type OpnameCountMutationInput } from './useOpnameCountMutation';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { useOpnameWorkspace } from './OpnameWorkspaceContext';

interface Props {
  sessionId: number;
  active: boolean;
  canCount: boolean;
  revealsSystemQty: boolean;
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
}: Props) {
  const [pickerValue, setPickerValue] = useState<ProductOption | null>(null);
  const [quantity, setQuantity] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [message, setMessage] = useState('');
  const [retryInput, setRetryInput] = useState<OpnameCountMutationInput | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const quantityRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(window.crypto.randomUUID());
  const {
    selectedItem: pickedItem,
    setSelectedItem: setPickedItem,
    highlightedItemId,
    setHighlightedItemId,
    loadItem,
  } = useOpnameWorkspace();
  const mutation = useOpnameCountMutation(sessionId);
  const history = useQuery({
    queryKey: ['opname', 'counts', sessionId],
    queryFn: () => opnameApi.counts(sessionId, 10),
    enabled: active && canCount,
    refetchInterval: () => document.visibilityState === 'visible' ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!pickedItem) return;
    setPickerValue({
      id: pickedItem.product_id,
      sku: '',
      name: pickedItem.name,
      unit_name: '',
      track_expiry: false,
    });
    setQuantity('');
    setFieldError('');
    setMessage('');
    setRetryInput(null);
    requestId.current = window.crypto.randomUUID();
    focusQuantity();
  }, [pickedItem, setPickedItem]);

  const searchAdapter = async (query: string, mode: 'auto' | 'search') => opnameApi.lookup(sessionId, query, mode);

  function chooseResult(result: ProductPickerResult) {
    if (!isOpnameItem(result)) return;
    loadItem(result);
    setQuantity('');
    setFieldError('');
    setMessage('');
    setRetryInput(null);
    requestId.current = window.crypto.randomUUID();
    focusQuantity();
  }

  function focusQuantity() {
    window.setTimeout(() => {
      quantityRef.current?.focus();
      quantityRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  }

  function clearSelection() {
    setPickedItem(null);
    setPickerValue(null);
    setQuantity('');
    setFieldError('');
    setMessage('');
    setRetryInput(null);
    requestId.current = window.crypto.randomUUID();
  }

  function save(mode: 'set' | 'add') {
    if (!pickedItem || mutation.isPending || retryInput) return;
    if (!isCount(quantity)) {
      setFieldError('Isi bilangan bulat dari 0 sampai 1.000.000.');
      return;
    }
    if (mode === 'add' && Number(quantity) < 1) {
      setFieldError('Jumlah tambahan minimal 1.');
      return;
    }

    setFieldError('');
    setMessage('');
    mutation.mutate({
      action: 'count',
      item_id: pickedItem.id,
      mode,
      quantity: Number(quantity),
      client_request_id: requestId.current,
    }, {
      onSuccess: (result) => {
        setAnnouncement(`Hitungan ${itemLabel(result.item)} tersimpan.`);
        setPickedItem(null);
        setPickerValue(null);
        setQuantity('');
        setFieldError('');
        setMessage('');
        setRetryInput(null);
        requestId.current = window.crypto.randomUUID();
        setHighlightedItemId(result.item.id);
        window.setTimeout(() => setHighlightedItemId(null), 2_500);
        window.setTimeout(() => pickerRef.current?.focus(), 0);
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
        setQuantity('');
        setRetryInput(null);
        setMessage('');
        requestId.current = window.crypto.randomUUID();
        setHighlightedItemId(result.item.id);
        window.setTimeout(() => setHighlightedItemId(null), 2_500);
        window.setTimeout(() => pickerRef.current?.focus(), 0);
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
    };
    mutation.mutate(request, {
      onSuccess: (result) => {
        setPickedItem(result.item);
        setQuantity('');
        setMessage('');
        setAnnouncement(`Hitungan ${result.item.name} dihapus.`);
        setHighlightedItemId(result.item.id);
        window.setTimeout(() => setHighlightedItemId(null), 2_500);
      },
      onError: (error) => handleError(error, request),
    });
  }

  async function loadRecent(log: OpnameCountLog) {
    try {
      const results = await opnameApi.lookup(sessionId, log.item.barcode, 'auto');
      const item = results.find((candidate) => candidate.id === log.item.id);
      if (item) chooseResult(item);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Produk tidak dapat dimuat.');
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pickedItem || pickedItem.counted_qty !== null) {
      setMessage(pickedItem ? 'Pilih Ganti atau Tambah secara eksplisit untuk produk yang sudah dihitung.' : '');
      return;
    }
    save('set');
  }

  const disabled = !active || !canCount || mutation.isPending || retryInput !== null || sessionEnded;
  const counted = pickedItem?.counted_qty !== null && pickedItem !== null;
  const previewVariance = pickedItem?.system_qty !== undefined && isCount(quantity)
    ? Number(quantity) - Number(pickedItem.system_qty)
    : null;

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Input hitungan</h3>
      {!active ? (
        <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">Sesi ini dalam mode baca.</p>
      ) : !canCount ? (
        <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">Akun Anda tidak memiliki izin mencatat hitungan.</p>
      ) : (
        <>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Scan barcode atau cari produk">
              <ProductPicker
                value={pickerValue}
                onChange={(value) => {
                  setPickerValue(value);
                  if (!value) clearSelection();
                }}
                onSelectResult={chooseResult}
                searchAdapter={searchAdapter}
                searchAdapterKey={sessionId}
                autoFocus={!pickedItem}
                inputRef={pickerRef}
                placeholder="Scan barcode atau ketik nama"
                disabled={disabled}
              />
            </Field>

            {pickedItem && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-semibold">{pickedItem.name}</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-600">{pickedItem.barcode}</p>
                <p className="mt-1 text-xs text-slate-600">{pickedItem.category_path.join(' › ') || 'Lainnya'}</p>
                {counted && <p className="mt-2 font-medium">Sudah dihitung: {pickedItem.counted_qty}</p>}
                {revealsSystemQty && pickedItem.system_qty !== undefined && (
                  <div className="mt-2 border-t border-slate-200 pt-2 text-xs">
                    <p>Stok sistem: {formatQty(pickedItem.system_qty)}</p>
                    {previewVariance !== null && <p>Pratinjau selisih: {previewVariance > 0 ? '+' : ''}{previewVariance}</p>}
                  </div>
                )}
              </div>
            )}

            <Field label="Jumlah hitung" error={fieldError}>
              <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] gap-2">
                <button type="button" disabled={disabled} onClick={() => setQuantity((current) => String(Math.max(0, (Number(current) || 0) - 1)))} className="min-h-12 rounded-md border border-slate-300 text-2xl disabled:opacity-50" aria-label="Kurangi jumlah">−</button>
                <input
                  ref={quantityRef}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="1000000"
                  step="1"
                  value={quantity}
                  disabled={disabled || !pickedItem}
                  onChange={(event) => { setQuantity(event.target.value); setFieldError(''); }}
                  className={`${inputCls} min-h-12 text-center text-lg tabular-nums`}
                  aria-describedby="opname-count-hint"
                />
                <button type="button" disabled={disabled} onClick={() => setQuantity((current) => String((Number(current) || 0) + 1))} className="min-h-12 rounded-md border border-slate-300 text-2xl disabled:opacity-50" aria-label="Tambah jumlah">+</button>
              </div>
              <p id="opname-count-hint" className="mt-1 text-xs text-slate-500">Masukkan jumlah yang ditemukan. Nilai 0 juga sah.</p>
              <button type="button" disabled={disabled || !pickedItem} onClick={() => { setQuantity('0'); setFieldError(''); }} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 text-sm font-medium disabled:opacity-50">0 — tidak ada</button>
            </Field>

            {fieldError && <p role="alert" className="text-sm text-red-700">{fieldError}</p>}
            {message && <div role="alert" className="space-y-2 text-sm text-red-700"><p>{message}</p>{retryInput && <button type="button" disabled={mutation.isPending} onClick={retry} className="min-h-11 rounded-md border border-red-300 px-4 font-medium disabled:opacity-50">{mutation.isPending ? 'Menyimpan…' : 'Coba lagi'}</button>}</div>}
            {pickedItem && (
              <div className="sticky bottom-14 z-10 -mx-4 bg-white px-4 py-2 shadow-[0_-8px_16px_-12px_rgba(15,23,42,0.4)]">
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
            )}
          </form>

          <section aria-label="Terakhir diinput" className="border-t border-slate-200 pt-4">
            <h4 className="font-semibold">Terakhir diinput</h4>
            {history.error && <div className="mt-2"><ErrorNotice error={history.error} /></div>}
            {history.isLoading && <p role="status" className="mt-2 text-sm text-slate-500">Memuat hitungan…</p>}
            {history.data?.length === 0 && <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada hitungan yang disimpan.</p>}
            <div className="mt-2 space-y-2">
              {history.data?.map((log) => (
                <button key={log.log_id} type="button" onClick={() => void loadRecent(log)} className={`min-h-12 w-full rounded-md border px-3 py-2 text-left text-sm ${highlightedItemId === log.item.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <span className="block font-medium">{log.item.name}</span>
                  <span className="block text-xs text-slate-600">{log.action === 'clear' ? 'Hitungan dihapus' : `Hitungan: ${log.counted_after ?? '—'}`} · {formatDateTime(log.created_at)}</span>
                </button>
              ))}
            </div>
          </section>
          <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
        </>
      )}
    </div>
  );
}
