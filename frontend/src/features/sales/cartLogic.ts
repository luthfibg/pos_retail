import type { CreditExceptionInput, Decimal, PaymentMode, Product, SaleInput } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { centsToMoney, lineCents, milliToQty, moneyToCents, qtyToMilli } from '@/lib/money';

/**
 * Logika murni keranjang kasir (tanpa React) agar mudah diuji.
 * Harga, diskon, PPN, dan total resmi dihitung server; di sini hanya bentuk keranjang,
 * validasi input, penyusun payload, dan pemeta error 422.
 */

export type CartProduct = Pick<Product, 'id' | 'sku' | 'name' | 'unit_name' | 'sell_price' | 'status' | 'stock_sellable'>;

export interface CartLine {
  key: number;
  product: CartProduct;
  /** Teks apa adanya dari input (boleh koma desimal); divalidasi lewat parseQty. */
  qty: string;
}

export const MAX_LINES = 100;
const MAX_QTY_MILLI = 99_999_000n; // 99.999
const MAX_MONEY_CENTS = 99_999_999_999_900n; // 999.999.999.999

let counter = 0;
const nextKey = () => (counter += 1);

/** Hanya produk aktif yang berharga yang bisa dijual (pending_price/inactive ditolak server). */
export const isSellable = (p: Pick<Product, 'status' | 'sell_price'>): boolean =>
  p.status === 'active' && p.sell_price !== null;

/** Qty ketikan -> per seribu; null bila <= 0, > 99.999, atau > 3 desimal. Menerima koma desimal. */
export function parseQty(raw: string): bigint | null {
  const q = qtyToMilli(normalizeDecimal(raw));
  if (q === null || q <= 0n || q > MAX_QTY_MILLI) return null;
  return q;
}

/** 1500n -> "1.5"; 3000n -> "3" (tanpa nol di belakang, untuk disimpan di keranjang). */
function compactQty(milli: bigint): string {
  return milliToQty(milli).replace(/\.?0+$/, '');
}

/** Tambah produk. Produk yang sudah ada digabung (qty dijumlahkan), seperti yang dilakukan server. */
export function addProduct(lines: CartLine[], product: CartProduct, qty = '1'): CartLine[] {
  const add = parseQty(qty);
  if (add === null) return lines;

  const existing = lines.find((l) => l.product.id === product.id);
  if (existing) {
    const current = qtyToMilli(normalizeDecimal(existing.qty)) ?? 0n;
    return lines.map((l) => (l.key === existing.key ? { ...l, qty: compactQty(current + add) } : l));
  }
  if (lines.length >= MAX_LINES) return lines;
  return [...lines, { key: nextKey(), product, qty: compactQty(add) }];
}

export const setQty = (lines: CartLine[], key: number, raw: string): CartLine[] =>
  lines.map((l) => (l.key === key ? { ...l, qty: raw } : l));

export const removeLine = (lines: CartLine[], key: number): CartLine[] => lines.filter((l) => l.key !== key);

export interface CartErrors {
  general?: string;
  /** kunci = indeks baris di keranjang */
  lines: Record<number, { qty?: string; product?: string }>;
}

export function validateCart(lines: CartLine[]): CartErrors {
  const out: CartErrors = { lines: {} };
  if (lines.length === 0) out.general = 'Keranjang masih kosong.';
  if (lines.length > MAX_LINES) out.general = `Maksimal ${MAX_LINES} baris per transaksi.`;

  lines.forEach((l, i) => {
    const e: { qty?: string; product?: string } = {};
    if (parseQty(l.qty) === null) e.qty = 'Qty harus > 0, maks. 99.999, maks. 3 desimal.';
    if (!isSellable(l.product)) e.product = 'Produk belum dapat dijual.';
    if (Object.keys(e).length > 0) out.lines[i] = e;
  });
  return out;
}

/** Perkiraan jumlah harga baris SEBELUM diskon dan PPN (hanya sampai pratinjau server tersedia). null bila ada baris tak valid. */
export function estimateSubtotal(lines: CartLine[]): string | null {
  if (lines.length === 0) return null;
  let sum = 0n;
  for (const l of lines) {
    const q = parseQty(l.qty);
    const p = moneyToCents(l.product.sell_price);
    if (q === null || p === null) return null;
    sum += lineCents(q, p);
  }
  return centsToMoney(sum);
}

/** Pesan galat uang diterima (tunai). `total` = total dari server bila sudah diketahui; null = biarkan server yang menolak. */
export function validateTendered(raw: string, total: Decimal | null): string | undefined {
  const v = normalizeDecimal(raw);
  if (!v) return 'Isi uang yang diterima.';
  const cents = moneyToCents(v);
  if (cents === null) return 'Nominal tidak valid (angka, maks. 2 desimal).';
  if (cents > MAX_MONEY_CENTS) return 'Nominal terlalu besar.';
  const t = total === null ? null : moneyToCents(total);
  if (t !== null && cents < t) return 'Uang diterima kurang dari total.';
  return undefined;
}

export interface PaymentChoice {
  mode: PaymentMode;
  /** Karyawan terpilih; wajib untuk kredit, boleh ada untuk tunai. */
  customerId: number | null;
  /** Hanya dipakai untuk tunai. */
  tendered: string;
  /** Hanya setelah server menolak dengan `credit_limit` dan Admin mengetik kredensialnya sendiri. */
  exception?: CreditExceptionInput;
}

/** Susun payload `POST /api/sales`. Panggil validateCart lebih dulu; baris tak valid melempar galat (kesalahan pemrograman). */
export function buildSaleInput(lines: CartLine[], idempotencyKey: string, pay: PaymentChoice): SaleInput {
  const items = lines.map((l) => {
    const q = parseQty(l.qty);
    if (q === null) throw new Error('Keranjang tidak valid: panggil validateCart sebelum buildSaleInput.');
    return { product_id: l.product.id, qty: milliToQty(q) };
  });

  const input: SaleInput = { idempotency_key: idempotencyKey, payment_mode: pay.mode, items };
  if (pay.customerId !== null) input.customer_id = pay.customerId;
  if (pay.mode === 'cash') input.amount_tendered = normalizeDecimal(pay.tendered);
  if (pay.mode === 'payroll_credit' && pay.exception) {
    input.credit_exception = {
      approver_username: pay.exception.approver_username.trim(),
      approver_password: pay.exception.approver_password,
      note: pay.exception.note.trim(),
    };
  }
  return input;
}

// ------------------------------------------------------------------ galat 422 dari server

export type SaleField =
  | 'shift' | 'amount_tendered' | 'customer_id' | 'credit_limit' | 'payment_mode' | 'idempotency_key'
  | 'approver_username' | 'approver_password' | 'credit_exception.note';

const SALE_FIELDS: readonly SaleField[] = [
  'shift', 'amount_tendered', 'customer_id', 'credit_limit', 'payment_mode', 'idempotency_key',
  'approver_username', 'approver_password', 'credit_exception.note',
];

export interface SaleErrors {
  /** kunci = indeks baris di keranjang (server memakai urutan `items` yang dikirim) */
  lines: Record<number, Partial<Record<'qty' | 'product_id', string>>>;
  fields: Partial<Record<SaleField, string>>;
  general?: string;
}

/**
 * Petakan `errors` 422 ke baris/kolom layar. Karena keranjang tidak punya baris ganda
 * dan semua baris dikirim, indeks `items.N` = indeks baris di layar.
 */
export function mapSaleErrors(errors: Record<string, string[]> | undefined): SaleErrors {
  const out: SaleErrors = { lines: {}, fields: {} };
  for (const [key, msgs] of Object.entries(errors ?? {})) {
    const msg = msgs[0] ?? '';

    const m = /^items\.(\d+)\.(\w+)$/.exec(key);
    if (m) {
      const index = Number(m[1]);
      const field = m[2];
      if (field === 'qty' || field === 'product_id') {
        const row = out.lines[index] ?? {};
        row[field] = msg;
        out.lines[index] = row;
        continue;
      }
    }

    // credit_exception.approver_* (validasi bentuk) disamakan dengan approver_* (kredensial salah)
    const name = key === 'credit_exception.note' ? key : key.replace(/^credit_exception\./, '');
    const known = SALE_FIELDS.find((f) => f === name);
    if (known) {
      out.fields[known] = out.fields[known] ?? msg;
    } else {
      out.general = out.general ?? msg;
    }
  }
  return out;
}

/** Melebihi batas kredit: tawarkan tunai atau dialog pengecualian Admin. */
export const needsCreditException = (e: SaleErrors): boolean => e.fields.credit_limit !== undefined;

/** Kunci ditolak (dipakai kasir lain): wajib membuat kunci baru. Galat lain tidak mengganti kunci. */
export const mustChangeKey = (e: SaleErrors): boolean => e.fields.idempotency_key !== undefined;

/** Belum buka shift atau shift sedang dihitung. */
export const isShiftProblem = (e: SaleErrors): boolean => e.fields.shift !== undefined;

// ------------------------------------------------------------------ kunci idempotensi

export interface CryptoLike {
  randomUUID?: () => string;
  /** Mengisi array di tempat (nilai kembalian tidak dipakai). */
  getRandomValues: (a: Uint8Array<ArrayBuffer>) => unknown;
}

/**
 * UUID v4 untuk `idempotency_key`. `crypto.randomUUID` hanya ada di konteks aman (HTTPS/localhost);
 * aplikasi bisa dibuka lewat http://<IP-server> di jaringan pabrik, jadi ada cadangan lewat getRandomValues.
 */
export function newIdempotencyKey(c: CryptoLike = globalThis.crypto): string {
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
