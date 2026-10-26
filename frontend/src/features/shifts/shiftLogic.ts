import type { Decimal, DepositStatus, ShiftStatus } from '@/lib/api/types';

export const SHIFT_STATUS_LABEL: Record<ShiftStatus, string> = {
  open: 'Berjalan',
  counting: 'Penghitungan kas',
  closed: 'Ditutup — menunggu tinjauan',
  reviewed: 'Ditinjau',
};

export const SHIFT_STATUS_CLS: Record<ShiftStatus, string> = {
  open: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  counting: 'bg-amber-100 text-amber-800 ring-amber-200',
  closed: 'bg-sky-100 text-sky-800 ring-sky-200',
  reviewed: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export type VarianceKind = 'zero' | 'over' | 'short' | 'unknown';

/** Selisih = kas terhitung − kas diharapkan. Positif = lebih, negatif = kurang. Dibaca dari string, tanpa float. */
export function varianceKind(v: Decimal | null | undefined): VarianceKind {
  if (v === null || v === undefined || v === '') return 'unknown';
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) return 'unknown';
  const isZero = /^0*$/.test(`${m[2] ?? ''}${m[3] ?? ''}`);
  if (isZero) return 'zero';
  return m[1] === '-' ? 'short' : 'over';
}

export const VARIANCE_LABEL: Record<VarianceKind, string> = {
  zero: 'Sesuai',
  over: 'Lebih',
  short: 'Kurang',
  unknown: '—',
};

export const VARIANCE_CLS: Record<VarianceKind, string> = {
  zero: 'text-emerald-700',
  over: 'text-amber-700',
  short: 'text-red-700',
  unknown: 'text-slate-500',
};

/** Shift yang masih bisa menerima penjualan hanya yang berstatus open. */
export const canSell = (status: ShiftStatus | undefined): boolean => status === 'open';

/** Setoran akhir Draft harus diserahkan sebelum Kasir dapat membuka shift berikutnya. */
export const canOpenNextShift = (depositStatus: DepositStatus | null | undefined): boolean =>
  depositStatus !== 'draft';
