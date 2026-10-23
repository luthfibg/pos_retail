import type { ExpiryStatus } from '@/lib/api/types';

const STYLE: Record<ExpiryStatus, { label: string; cls: string }> = {
  ok: { label: 'Baik', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  near_expiry: { label: 'Hampir kadaluarsa', cls: 'bg-amber-100 text-amber-800 ring-amber-200' },
  expired: { label: 'Kadaluarsa', cls: 'bg-red-100 text-red-800 ring-red-200' },
  none: { label: 'Tanpa tanggal', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

export function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  const s = STYLE[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  );
}
