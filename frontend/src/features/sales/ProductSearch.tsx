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
  onPick: (p: CartProduct) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}

/**
 * Kolom scan/cari kasir. Enter = coba barcode persis dulu (scanner USB mengetik lalu Enter),
 * bila tidak ada pakai hasil pencarian pertama yang bisa dijual. Klik hasil juga menambah ke keranjang.
 */
export function ProductSearch({ onPick, inputRef, disabled }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const debounced = useDebounce(text.trim(), 250);

  const results = useQuery({
    queryKey: ['products', 'pos-search', debounced],
    queryFn: () => productApi.list({ q: debounced, per_page: 8 }),
    enabled: open && debounced.length > 0 && !disabled,
  });
  const options = (results.data?.data ?? []).filter((p) => p.status !== 'inactive');

  function accept(p: Product) {
    if (!isSellable(p)) {
      setMessage(`“${p.name}” belum dapat dijual (menunggu harga atau nonaktif).`);
      return;
    }
    setMessage(null);
    onPick(toCartProduct(p));
    setText('');
    setOpen(false);
  }

  async function onEnter() {
    const code = text.trim();
    if (!code || busy || disabled) return;
    setBusy(true);
    setMessage(null);
    try {
      accept(await productApi.byBarcode(code));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        try {
          const res = await productApi.list({ q: code, per_page: 8 });
          const found = res.data.find((p) => p.status !== 'inactive' && isSellable(p)) ?? res.data[0];
          if (found) accept(found);
          else setMessage(`Produk “${code}” tidak ditemukan.`);
        } catch (e2) {
          setMessage(e2 instanceof ApiError ? e2.firstError() : 'Gagal mencari produk.');
        }
      } else {
        setMessage(e instanceof ApiError ? e.firstError() : 'Gagal mencari produk.');
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
        placeholder="Scan barcode atau ketik nama / SKU, lalu Enter"
        autoComplete="off"
        onChange={(e) => { setText(e.target.value); setOpen(true); setMessage(null); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void onEnter(); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {message && <p role="alert" className="mt-1 text-sm text-red-700">{message}</p>}

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
