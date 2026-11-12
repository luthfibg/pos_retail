import { useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Field, inputCls } from '@/components/ui/Field';
import { useDebounce } from '@/hooks/useDebounce';
import { productApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { OpnameItem, Product } from '@/lib/api/types';
import { formatQty } from '@/lib/format';
import type { ProductOption } from '@/features/inventory/openingForm';

export type ProductPickerResult = Product | OpnameItem;
export type ProductSearchAdapter = (query: string, mode: 'auto' | 'search') => Promise<ProductPickerResult[]>;

interface Props {
  value: ProductOption | null;
  onChange: (product: ProductOption | null) => void;
  onSelect?: (product: Product) => void;
  onSelectResult?: (product: ProductPickerResult) => void;
  searchAdapter?: ProductSearchAdapter;
  searchAdapterKey?: string | number;
  inputRef?: RefObject<HTMLInputElement | null>;
  placeholder?: string;
  exactBarcodeOnly?: boolean;
  includeInactive?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  showStock?: boolean;
}

/** Reusable product search. Stock is hidden unless a consumer explicitly requests it. */
export function ProductPicker({
  value,
  onChange,
  onSelect,
  onSelectResult,
  searchAdapter,
  searchAdapterKey,
  inputRef,
  placeholder = 'Cari nama, SKU, atau barcode',
  exactBarcodeOnly = false,
  includeInactive = false,
  autoFocus,
  disabled = false,
  showStock = false,
}: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeError, setBarcodeError] = useState('');
  const debounced = useDebounce(text.trim(), 250);
  const results = useQuery({
    queryKey: ['products', 'picker', debounced, includeInactive, Boolean(searchAdapter), searchAdapterKey],
    queryFn: async () => searchAdapter
      ? searchAdapter(debounced, 'search')
      : (await productApi.list({ q: debounced, status: includeInactive ? undefined : 'active', per_page: 8 })).data,
    enabled: open && debounced.length >= 2,
  });
  const options = (results.data ?? []).filter((product) => (
    searchAdapter || includeInactive || !('status' in product) || product.status === 'active'
  ));

  function pick(product: ProductPickerResult) {
    onChange({
      id: product.id,
      sku: 'sku' in product ? product.sku : '',
      name: product.name,
      unit_name: 'unit_name' in product ? product.unit_name : '',
      track_expiry: 'track_expiry' in product ? product.track_expiry : false,
    });
    if ('sell_price' in product) onSelect?.(product);
    onSelectResult?.(product);
    setText('');
    setOpen(false);
    setBarcodeError('');
  }

  async function submitSearch() {
    const barcode = text.trim();
    if (!barcode) return;
    const exact = options.find((product) => product.barcode === barcode);
    if (exact) {
      pick(exact);
      return;
    }

    setBarcodeLoading(true);
    setBarcodeError('');
    try {
      if (searchAdapter) {
        const found = await searchAdapter(barcode, 'auto');
        if (found[0]) {
          pick(found[0]);
          return;
        }
        setBarcodeError('Barcode tidak dikenal.');
        return;
      }
      const product = await productApi.byBarcode(barcode);
      if (product.status !== 'active' && !includeInactive) {
        setBarcodeError('Produk dengan barcode ini tidak aktif.');
        return;
      }
      pick(product);
    } catch (error) {
      if (searchAdapter) {
        setBarcodeError(error instanceof ApiError ? error.message : 'Produk tidak dapat dicari. Coba lagi.');
        return;
      }
      if (error instanceof ApiError && error.status === 404 && options[0] && !exactBarcodeOnly) {
        pick(options[0]);
      } else {
        setBarcodeError(error instanceof ApiError && error.status !== 404
          ? error.firstError()
          : error instanceof ApiError && exactBarcodeOnly
            ? 'Barcode tidak cocok dengan produk. Cari nama atau SKU, lalu pilih produk dari daftar.'
            : error instanceof ApiError ? error.message : 'Barcode tidak ditemukan. Periksa kode atau cari berdasarkan nama.');
      }
    } finally {
      setBarcodeLoading(false);
    }
  }

  if (value) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          <span className="font-mono text-xs text-slate-500">{value.sku}</span> {value.name}
        </span>
        <button type="button" disabled={disabled} onClick={() => onChange(null)} className="min-h-11 shrink-0 px-2 text-xs text-slate-600 underline disabled:opacity-50">Ganti</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open && debounced.length >= 2}
        aria-controls="product-picker-results"
        aria-autocomplete="list"
        className={`${inputCls} min-h-11`}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
          setBarcodeError('');
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(index + 1, options.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (activeIndex >= 0 && options[activeIndex]) pick(options[activeIndex]);
            else void submitSearch();
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {barcodeError && <p role="alert" className="mt-1 text-xs text-red-700">{barcodeError}</p>}
      {open && debounced.length >= 2 && (
        <ul id="product-picker-results" role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {(results.isFetching || barcodeLoading) && options.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Mencari produk…</li>}
          {results.error && <li className="px-3 py-3 text-sm text-red-700"><Field label="Pencarian gagal"><span>{results.error.message}</span></Field></li>}
          {!results.isFetching && !results.error && options.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Produk tidak ditemukan.</li>}
          {options.map((product, index) => (
            <li key={product.id} role="option" aria-selected={activeIndex === index}>
              <button
                type="button"
                onMouseDown={(event) => { event.preventDefault(); pick(product); }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`min-h-14 w-full px-3 py-2 text-left text-sm ${activeIndex === index ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                <span className="block font-medium">{product.name}</span>
                <span className="block font-mono text-xs text-slate-500">{product.barcode ?? ('sku' in product ? product.sku : '')} · {('category_name' in product ? product.category_name : product.category_path?.join(' › ')) ?? 'Tanpa kategori'}</span>
                {showStock && 'store_floor_stock_sellable' in product && <span className="block text-xs text-slate-500">Stok toko {formatQty(product.store_floor_stock_sellable ?? '0')} {product.unit_name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
