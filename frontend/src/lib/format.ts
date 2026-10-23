import type { Decimal } from './api/types';

// Hanya untuk TAMPILAN. Perhitungan uang (total keranjang, kembalian) jangan memakai Number;
// gunakan pustaka desimal atau hitung di backend saat fitur POS dibangun.

const idr0 = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const idr2 = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatRupiah(value: Decimal | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? idr0.format(n) : idr2.format(n);
}

/** "12.500" -> "12,5" ; "3.000" -> "3" (tanpa nol di belakang koma, format id-ID). */
export function formatQty(value: Decimal | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(n);
}

/** Waktu dari API disimpan UTC; tampilkan WIB. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta',
  }).format(new Date(iso));
}
