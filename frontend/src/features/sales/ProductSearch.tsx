import { useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { productApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { Product } from '@/lib/api/types';
import { useDebounce } from '@/hooks/useDebounce';
import { inputCls } from '@/components/ui/Field';
import { formatQty, formatRupiah } from '@/lib/format';
import { isSellable, type CartProduct } from './cartLogic';

const toCartProduct = (p: Product): CartProduct => ({
  id: p.id, sku: p.sku, name: p.name, unit_name: p.unit_name,
  sell_price: p.sell_price, status: p.status, stock_sellable: p.stock_sellable,
});

interface Props {
  onPick: (p: CartProduct, source: 'scan' | 'search') => 'added' | 'incremented' | 'limit';
  inputRef: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}

/**
 * Kolom scan/cari kasir. Enter hanya menambahkan hasil barcode persis; hasil pencarian nama/SKU dipilih manual.
 */
export function ProductSearch({ onPick, inputRef, disabled }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const debounced = useDebounce(text.trim(), 250);

  const results = useQuery({
    queryKey: ['products', 'pos-search', debounced],
    queryFn: () => productApi.list({ q: debounced, per_page: 8 }),
    enabled: open && debounced.length > 0 && !disabled,
  });
  const options = (results.data?.data ?? []).filter((p) => p.status !== 'inactive');

  function accept(p: Product, source: 'scan' | 'search' = 'search') {
    if (!isSellable(p)) {
      const reason = p.status === 'inactive' ? 'produk nonaktif' : 'produk masih menunggu harga';
      setMessage({ type: 'error', text: `“${p.name}” tidak dapat dijual karena ${reason}. Keranjang tidak berubah.` });
      return;
    }
    const result = onPick(toCartProduct(p), source);
    if (result === 'limit') {
      setMessage({
        type: 'error',
        text: source === 'scan'
          ? 'Scan tidak ditambahkan: batas Qty atau jumlah baris keranjang tercapai.'
          : 'Produk tidak ditambahkan: batas Qty atau jumlah baris keranjang tercapai.',
      });
      return;
    }
    setText('');
    setOpen(false);
    const action = result === 'incremented' ? 'Qty ditambah 1' : 'ditambahkan ke keranjang';
    setMessage({ type: 'success', text: `“${p.name}” ${action}.${source === 'scan' && result === 'added' ? ' Masukkan jumlah di kolom Qty, lalu tekan Enter untuk scan berikutnya.' : ' Siap untuk scan berikutnya.'}` });
    inputRef.current?.focus();
  }

  async function onEnter() {
    const code = text.trim();
    if (!code || busy || disabled) return;
    setBusy(true);
    setMessage(null);
    try {
      accept(await productApi.byBarcode(code), 'scan');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setOpen(true);
        setMessage({ type: 'error', text: `Tidak ada produk dengan barcode/kode persis “${code}”. Jika mencari nama atau SKU, pilih produk dari daftar.` });
      } else {
        setMessage({ type: 'error', text: e instanceof ApiError ? e.firstError() : 'Gagal mencari produk.' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={`${inputCls} py-3 text-base`}
        value={text}
        disabled={disabled}
        placeholder="Scan barcode atau ketik nama / SKU"
        aria-label="Scan barcode atau cari produk"
        aria-busy={busy}
        autoComplete="off"
        onChange={(e) => { setText(e.target.value); setOpen(true); setMessage(null); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void onEnter(); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div className="mt-1 flex min-h-5 items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Klik kolom ini lalu scan. Scanner harus berfungsi sebagai keyboard dan mengirim Enter.
        </p>
        {busy && (
          <p role="status" aria-live="polite" className="shrink-0 text-xs font-medium text-slate-600">
            Mencari barcode…
          </p>
        )}
      </div>
      {message && (
        <p
          role={message.type === 'success' ? 'status' : 'alert'}
          aria-live={message.type === 'success' ? 'polite' : undefined}
          className={`mt-1 text-sm ${message.type === 'success' ? 'text-emerald-800' : 'text-red-700'}`}
        >
          {message.text}
        </p>
      )}

      {open && debounced.length > 0 && !disabled && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.isFetching && options.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Mencari…</li>}
          {!results.isFetching && options.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Tidak ditemukan.</li>}
          {options.map((p) => {
            const ok = isSellable(p);
            return (
              <li key={p.id}>
                {/* onMouseDown agar terpilih sebelum input kehilangan fokus */}
                <button
                  type="button"
                  disabled={!ok}
                  onMouseDown={(e) => { e.preventDefault(); accept(p); }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{p.name}</span>
                    <span className="block font-mono text-xs text-slate-400">{p.sku} · {p.barcode}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular-nums">{ok ? formatRupiah(p.sell_price) : 'Menunggu harga'}</span>
                    <span className="block text-xs text-slate-500">Stok {formatQty(p.stock_sellable)} {p.unit_name}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
