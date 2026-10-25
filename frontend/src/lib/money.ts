import type { Decimal } from '@/lib/api/types';

/**
 * Aritmetika uang dan qty tanpa float, HANYA untuk tampilan dan validasi di klien
 * (perkiraan keranjang, kembalian di layar). Nilai resmi (harga, diskon, PPN, total,
 * kembalian) tetap dari respons backend; jangan dipakai untuk memutuskan transaksi.
 *
 * Uang = sen (skala 2), qty = per seribu (skala 3), keduanya bigint.
 */

const MONEY_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const QTY_RE = /^(\d+)(?:\.(\d{1,3}))?$/;

/** "3500.50" -> 350050n. null bila bukan angka dengan maks. 2 desimal. */
export function moneyToCents(v: Decimal | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  const m = MONEY_RE.exec(v.trim());
  if (!m) return null;
  const cents = BigInt(m[2] ?? '0') * 100n + BigInt((m[3] ?? '').padEnd(2, '0'));
  return m[1] === '-' ? -cents : cents;
}

export function centsToMoney(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** "12.5" -> 12500n. null bila bukan angka tak-negatif dengan maks. 3 desimal. */
export function qtyToMilli(v: Decimal | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  const m = QTY_RE.exec(v.trim());
  if (!m) return null;
  return BigInt(m[1] ?? '0') * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
}

export function milliToQty(q: bigint): string {
  return `${q / 1000n}.${(q % 1000n).toString().padStart(3, '0')}`;
}

/** harga (sen) x qty (per seribu) -> sen, dibulatkan setengah ke atas; sama dengan pembulatan backend. Hanya untuk nilai tak-negatif. */
export function lineCents(qtyMilli: bigint, priceCents: bigint): bigint {
  return (qtyMilli * priceCents + 500n) / 1000n;
}

/** a - b sebagai string uang; null bila salah satu tak valid. Untuk tampilan kembalian/kekurangan. */
export function subtractMoney(a: Decimal, b: Decimal): string | null {
  const x = moneyToCents(a);
  const y = moneyToCents(b);
  return x === null || y === null ? null : centsToMoney(x - y);
}

/** Membandingkan dua string uang: -1, 0, 1; null bila tak valid. */
export function compareMoney(a: Decimal, b: Decimal): -1 | 0 | 1 | null {
  const x = moneyToCents(a);
  const y = moneyToCents(b);
  if (x === null || y === null) return null;
  return x < y ? -1 : x > y ? 1 : 0;
}
