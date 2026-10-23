import type { StockStatus } from '@/lib/api/types';

// Status berasal dari backend (StockStatus). Teks selalu tampil, bukan hanya warna.
const STYLE: Record<StockStatus, { label: string; cls: string }> = {
  habis: { label: 'Habis', cls: 'bg-red-100 text-red-800 ring-red-200' },
  kritis: { label: 'Kritis', cls: 'bg-orange-100 text-orange-800 ring-orange-200' },
  hampir_habis: { label: 'Hampir habis', cls: 'bg-amber-100 text-amber-800 ring-amber-200' },
  aman: { label: 'Aman', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
};

export function StockBadge({ status }: { status: StockStatus }) {
  const s = STYLE[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  );
}
