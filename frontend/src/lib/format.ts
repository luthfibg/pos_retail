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

/** Waktu API berbentuk "2026-10-23 03:15:00.123" (UTC tanpa penanda zona). Tanpa 'Z', browser salah menganggapnya waktu lokal. */
export function parseApiTime(value: string): Date {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(hasZone ? iso : `${iso}Z`);
}

/** Waktu dari API disimpan UTC; tampilkan WIB. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = parseApiTime(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(d);
}

/** Tanggal murni "YYYY-MM-DD" (mis. kadaluarsa). Tidak digeser zona waktu. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return '—';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}

/** Tanggal kalender WIB ("YYYY-MM-DD") dari waktu API (UTC). Untuk mengisi <input type="date"> dari batas hari WIB. */
export function toWibDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseApiTime(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' }).format(d);
}
