import type { Discount, DiscountInput, DiscountStatus, DiscountTarget, DiscountType, DiscountUpdate } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { toWibDate } from '@/lib/format';
import { moneyToCents } from '@/lib/money';

export const TARGET_LABEL: Record<DiscountTarget, string> = { product: 'Produk', category: 'Kategori' };
export const TYPE_LABEL: Record<DiscountType, string> = { percent: 'Persen (%)', amount: 'Nominal per unit (Rp)' };

export const STATUS_LABEL: Record<DiscountStatus, string> = {
  active: 'Berlaku',
  scheduled: 'Terjadwal',
  expired: 'Berakhir',
  inactive: 'Nonaktif',
};

export const STATUS_CLS: Record<DiscountStatus, string> = {
  active: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  scheduled: 'bg-sky-100 text-sky-800 ring-sky-200',
  expired: 'bg-slate-100 text-slate-600 ring-slate-200',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export interface DiscountFormValues {
  name: string;
  targetType: DiscountTarget;
  /** id produk atau kategori terpilih; null = belum dipilih */
  targetId: number | null;
  discountType: DiscountType;
  value: string;
  startsAt: string; // YYYY-MM-DD (WIB); kosong = mulai sekarang (hanya saat tambah)
  endsAt: string; // YYYY-MM-DD (WIB); kosong = tanpa akhir
  isActive: boolean;
}

export type DiscountErrors = Partial<Record<'name' | 'target_id' | 'discount_type' | 'value' | 'starts_at' | 'ends_at', string>>;

export const emptyDiscount = (): DiscountFormValues => ({
  name: '', targetType: 'product', targetId: null, discountType: 'percent', value: '', startsAt: '', endsAt: '', isActive: true,
});

export const valuesFromDiscount = (d: Discount): DiscountFormValues => ({
  name: d.name,
  targetType: d.target_type,
  targetId: d.target_id,
  discountType: d.discount_type,
  value: d.value,
  startsAt: toWibDate(d.starts_at),
  endsAt: toWibDate(d.ends_at),
  isActive: d.is_active,
});

const VALUE_RE = /^\d{1,12}(\.\d{1,2})?$/;

export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function validateDiscount(v: DiscountFormValues, mode: 'create' | 'edit'): DiscountErrors {
  const e: DiscountErrors = {};
  if (!v.name.trim()) e.name = 'Nama diskon wajib diisi.';
  else if (v.name.trim().length > 120) e.name = 'Maksimal 120 karakter.';

  if (mode === 'create' && v.targetId === null) {
    e.target_id = v.targetType === 'product' ? 'Pilih produk.' : 'Pilih kategori.';
  }

  const value = normalizeDecimal(v.value);
  const cents = moneyToCents(value);
  if (!value) e.value = 'Nilai wajib diisi.';
  else if (!VALUE_RE.test(value) || cents === null) e.value = 'Nilai tidak valid (angka, maks. 2 desimal).';
  else if (cents <= 0n) e.value = 'Nilai harus lebih dari 0.';
  else if (v.discountType === 'percent' && cents > 10000n) e.value = 'Diskon persen tidak boleh lebih dari 100.';

  if (v.startsAt && !isRealDate(v.startsAt)) e.starts_at = 'Tanggal tidak valid.';
  else if (mode === 'edit' && !v.startsAt) e.starts_at = 'Tanggal mulai wajib diisi.';
  if (v.endsAt && !isRealDate(v.endsAt)) e.ends_at = 'Tanggal tidak valid.';
  else if (v.startsAt && v.endsAt && !e.starts_at && v.endsAt < v.startsAt) e.ends_at = 'Tanggal berakhir tidak boleh sebelum tanggal mulai.';
  return e;
}

/** Panggil validateDiscount lebih dulu (targetId tidak boleh null). */
export function buildDiscountCreate(v: DiscountFormValues): DiscountInput {
  if (v.targetId === null) throw new Error('Target diskon belum dipilih.');
  const input: DiscountInput = {
    name: v.name.trim(),
    target_type: v.targetType,
    target_id: v.targetId,
    discount_type: v.discountType,
    value: normalizeDecimal(v.value),
  };
  if (v.startsAt) input.starts_at = v.startsAt;
  if (v.endsAt) input.ends_at = v.endsAt;
  return input;
}

const sameMoney = (a: string, b: string): boolean => {
  const x = moneyToCents(normalizeDecimal(a));
  const y = moneyToCents(normalizeDecimal(b));
  return x !== null && y !== null && x === y;
};

/**
 * Hanya kolom yang berubah. Tanggal dibandingkan sebagai tanggal WIB: mengirim ulang tanggal yang sama
 * akan menggeser jam mulai ke awal hari, jadi tidak dikirim bila tidak diubah.
 */
export function buildDiscountUpdate(v: DiscountFormValues, original: Discount): DiscountUpdate {
  const p: DiscountUpdate = {};
  if (v.name.trim() !== original.name) p.name = v.name.trim();
  if (v.discountType !== original.discount_type) p.discount_type = v.discountType;
  if (!sameMoney(v.value, original.value)) p.value = normalizeDecimal(v.value);
  if (v.startsAt !== toWibDate(original.starts_at)) p.starts_at = v.startsAt;
  if (v.endsAt !== toWibDate(original.ends_at)) p.ends_at = v.endsAt === '' ? null : v.endsAt;
  if (v.isActive !== original.is_active) p.is_active = v.isActive;
  // nilai/jenis berpasangan: server memeriksa persen <= 100 dari gabungan keduanya
  if (p.discount_type !== undefined && p.value === undefined) p.value = normalizeDecimal(v.value);
  return p;
}

/** "10%" atau "Rp 500 / unit" (tampilan; nilai dari server). */
export function describeValue(type: DiscountType, value: string, formatMoney: (v: string) => string): string {
  if (type === 'percent') {
    const n = moneyToCents(value);
    if (n === null) return value;
    const whole = n / 100n;
    const frac = n % 100n;
    return `${whole}${frac === 0n ? '' : `,${frac.toString().padStart(2, '0').replace(/0$/, '')}`}%`;
  }
  return `${formatMoney(value)} / unit`;
}
