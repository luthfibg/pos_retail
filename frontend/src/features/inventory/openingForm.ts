import type { OpeningBalanceInput } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';

export interface ProductOption {
  id: number;
  sku: string;
  name: string;
  unit_name: string;
  track_expiry: boolean;
}

export interface OpeningRow {
  key: number;
  product: ProductOption | null;
  qty: string;
  unitCost: string;
  expiry: string; // YYYY-MM-DD dari <input type="date">
  batchCode: string;
}

export type RowField = 'product_id' | 'qty' | 'unit_cost' | 'expiry_date' | 'batch_code';
export type RowErrors = Record<number, Partial<Record<RowField, string>>>;

export interface OpeningErrors {
  rows: RowErrors; // kunci = indeks baris di layar
  general?: string;
}

let counter = 0;
export function newRow(): OpeningRow {
  counter += 1;
  return { key: counter, product: null, qty: '', unitCost: '', expiry: '', batchCode: '' };
}

/** Baris yang sama sekali kosong diabaikan (tidak dikirim, tidak divalidasi). */
export function isBlank(r: OpeningRow): boolean {
  return !r.product && !r.qty.trim() && !r.unitCost.trim() && !r.expiry && !r.batchCode.trim();
}

const QTY_RE = /^\d{1,9}(\.\d{1,3})?$/;
const COST_RE = /^\d{1,12}(\.\d{1,4})?$/;

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function validateOpening(rows: OpeningRow[], note: string): OpeningErrors {
  const out: OpeningErrors = { rows: {} };
  const filled = rows.filter((r) => !isBlank(r));

  if (filled.length === 0) out.general = 'Isi minimal satu baris stok.';
  if (filled.length > 200) out.general = 'Maksimal 200 baris per dokumen.';
  if (note.trim().length > 500) out.general = 'Catatan maksimal 500 karakter.';

  rows.forEach((r, i) => {
    if (isBlank(r)) return;
    const e: Partial<Record<RowField, string>> = {};

    if (!r.product) e.product_id = 'Pilih produk.';

    const qty = normalizeDecimal(r.qty);
    if (!qty || !QTY_RE.test(qty) || Number(qty) <= 0) e.qty = 'Qty harus > 0 (maks. 3 desimal).';

    const cost = normalizeDecimal(r.unitCost);
    if (cost && !COST_RE.test(cost)) e.unit_cost = 'Harga tidak valid (maks. 4 desimal).';

    if (r.expiry && !isRealDate(r.expiry)) e.expiry_date = 'Tanggal tidak valid.';
    if (r.batchCode.trim().length > 60) e.batch_code = 'Maksimal 60 karakter.';

    if (Object.keys(e).length > 0) out.rows[i] = e;
  });

  return out;
}

export interface BuiltOpening {
  payload: OpeningBalanceInput;
  /** indexMap[indeksDiServer] = indeks baris di layar (karena baris kosong tidak dikirim). */
  indexMap: number[];
}

export function buildOpeningPayload(rows: OpeningRow[], note: string): BuiltOpening {
  const indexMap: number[] = [];
  const items: OpeningBalanceInput['items'] = [];

  rows.forEach((r, i) => {
    if (isBlank(r) || !r.product) return;
    const item: OpeningBalanceInput['items'][number] = {
      product_id: r.product.id,
      qty: normalizeDecimal(r.qty),
    };
    const cost = normalizeDecimal(r.unitCost);
    if (cost) item.unit_cost = cost;
    if (r.expiry) item.expiry_date = r.expiry;
    if (r.batchCode.trim()) item.batch_code = r.batchCode.trim();
    items.push(item);
    indexMap.push(i);
  });

  const payload: OpeningBalanceInput = { items };
  if (note.trim()) payload.note = note.trim();
  return { payload, indexMap };
}

const ROW_FIELDS: RowField[] = ['product_id', 'qty', 'unit_cost', 'expiry_date', 'batch_code'];

/** Petakan kesalahan 422 ("items.1.qty") ke baris di layar. */
export function mapServerErrors(errors: Record<string, string[]> | undefined, indexMap: number[]): OpeningErrors {
  const out: OpeningErrors = { rows: {} };
  for (const [key, msgs] of Object.entries(errors ?? {})) {
    const msg = msgs[0] ?? '';
    const m = /^items\.(\d+)\.(\w+)$/.exec(key);
    if (!m) {
      out.general = out.general ?? msg;
      continue;
    }
    const uiIndex = indexMap[Number(m[1])];
    const field = m[2] as RowField;
    if (uiIndex === undefined || !ROW_FIELDS.includes(field)) {
      out.general = out.general ?? msg;
      continue;
    }
    const row = out.rows[uiIndex] ?? {};
    row[field] = msg;
    out.rows[uiIndex] = row;
  }
  return out;
}
