import type { FifoType } from '@/lib/api/types';

const STYLE: Record<FifoType, { label: string; cls: string }> = {
  fast_moving: { label: 'Fast Moving', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  normal: { label: 'Normal', cls: 'bg-sky-100 text-sky-800 ring-sky-200' },
  slow_moving: { label: 'Slow Moving', cls: 'bg-amber-100 text-amber-800 ring-amber-200' },
  no_stock: { label: 'Tidak ada stok', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  unclassified: { label: 'Belum ada data', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

export function StockVelocityBadge({ type }: { type: FifoType }) {
  const style = STYLE[type];

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.cls}`}>
      {style.label}
    </span>
  );
}
