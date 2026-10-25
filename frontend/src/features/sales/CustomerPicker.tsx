import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customerApi } from '@/lib/api/endpoints';
import type { Customer } from '@/lib/api/types';
import { useDebounce } from '@/hooks/useDebounce';
import { inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { formatRupiah } from '@/lib/format';
import { CreditStateBadge } from '@/features/customers/CustomerBadges';
import { CREDIT_HINT } from '@/features/customers/creditState';

interface Props {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  disabled?: boolean;
}

/** Pilih karyawan untuk kredit potong gaji. Kasir tidak pernah menerima nilai batas, hanya `credit_state` dan sisa. */
export function CustomerPicker({ value, onChange, disabled }: Props) {
  const [text, setText] = useState('');
  const debounced = useDebounce(text.trim(), 250);

  const results = useQuery({
    queryKey: ['customers', 'pos-picker', debounced],
    queryFn: () => customerApi.list({ q: debounced, per_page: 8 }),
    enabled: debounced.length > 0 && value === null,
  });

  if (value) {
    return (
      <div className="space-y-2 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium">{value.name}</div>
            <div className="font-mono text-xs text-slate-500">{value.customer_no}{value.department ? ` · ${value.department}` : ''}</div>
          </div>
          {!disabled && (
            <button type="button" onClick={() => onChange(null)} className="shrink-0 text-xs text-slate-600 underline">Ganti</button>
          )}
        </div>
        <CreditStateBadge state={value.credit_state} />
        {value.credit_remaining !== null && (
          <div className="text-xs tabular-nums text-slate-600">Sisa batas bulan ini {formatRupiah(value.credit_remaining)}</div>
        )}
        <p className="text-xs text-slate-600">{CREDIT_HINT[value.credit_state]}</p>
      </div>
    );
  }

  const rows = results.data?.data ?? [];
  return (
    <div className="space-y-2">
      <input
        className={inputCls}
        value={text}
        disabled={disabled}
        placeholder="Cari nama atau NIK karyawan"
        onChange={(e) => setText(e.target.value)}
      />
      <ErrorNotice error={results.error} />
      {debounced.length > 0 && (
        <ul className="max-h-60 divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200 bg-white">
          {results.isFetching && rows.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Mencari…</li>}
          {!results.isFetching && rows.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Tidak ditemukan.</li>}
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onChange(c); setText(''); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate">{c.name}</span>
                  <span className="block font-mono text-xs text-slate-400">{c.customer_no}</span>
                </span>
                <CreditStateBadge state={c.credit_state} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
