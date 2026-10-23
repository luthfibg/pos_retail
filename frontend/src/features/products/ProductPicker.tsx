import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { productApi } from '@/lib/api/endpoints';
import { useDebounce } from '@/hooks/useDebounce';
import type { ProductOption } from '@/features/inventory/openingForm';
import { inputCls } from '@/components/ui/Field';

interface Props {
  value: ProductOption | null;
  onChange: (p: ProductOption | null) => void;
  placeholder?: string;
  /** Produk nonaktif disembunyikan kecuali dibutuhkan (mis. filter riwayat). */
  includeInactive?: boolean;
  autoFocus?: boolean;
}

/** Cari produk lewat nama/SKU/barcode. Enter memilih hasil pertama, sehingga scanner USB bisa dipakai. */
export function ProductPicker({ value, onChange, placeholder = 'Cari nama, SKU, atau barcode', includeInactive = false, autoFocus }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(text.trim(), 250);

  const results = useQuery({
    queryKey: ['products', 'picker', debounced],
    queryFn: () => productApi.list({ q: debounced, per_page: 8 }),
    enabled: open && debounced.length > 0,
  });

  const options = (results.data?.data ?? []).filter((p) => includeInactive || p.status !== 'inactive');

  function pick(p: (typeof options)[number]) {
    onChange({ id: p.id, sku: p.sku, name: p.name, unit_name: p.unit_name, track_expiry: p.track_expiry });
    setText('');
    setOpen(false);
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          <span className="font-mono text-xs text-slate-500">{value.sku}</span> {value.name}
        </span>
        <button type="button" onClick={() => onChange(null)} className="shrink-0 text-xs text-slate-500 underline">Ganti</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        className={inputCls}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault(); // jangan kirim form; pilih hasil pertama
            const first = options[0];
            if (first) pick(first);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && debounced.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.isFetching && options.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Mencari…</li>}
          {!results.isFetching && options.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Tidak ditemukan.</li>}
          {options.map((p) => (
            <li key={p.id}>
              {/* onMouseDown (bukan onClick) agar terpilih sebelum input kehilangan fokus */}
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(p); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100">
                <span className="font-mono text-xs text-slate-500">{p.sku}</span> {p.name}
                <span className="block text-xs text-slate-400">{p.barcode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
