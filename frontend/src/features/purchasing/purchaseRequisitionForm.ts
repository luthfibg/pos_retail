import type { PurchaseRequisitionInput } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { moneyToCents, qtyToMilli } from '@/lib/money';
import type { ProductOption } from '@/features/inventory/openingForm';

export interface PurchaseRequisitionRow {
  key: number;
  product: ProductOption | null;
  qty: string;
  estPrice: string;
  note: string;
}

export type PurchaseRequisitionRowField = 'product_id' | 'qty' | 'est_price' | 'note';
export type PurchaseRequisitionRowErrors = Partial<Record<PurchaseRequisitionRowField, string>>;

export interface PurchaseRequisitionErrors {
  rows: Record<number, PurchaseRequisitionRowErrors>;
  general?: string;
}

let nextRowKey = 0;
export function newPurchaseRequisitionRow(): PurchaseRequisitionRow {
  return { key: ++nextRowKey, product: null, qty: '', estPrice: '', note: '' };
}

export function isBlankPurchaseRequisitionRow(row: PurchaseRequisitionRow): boolean {
  return !row.product && !row.qty.trim() && !row.estPrice.trim() && !row.note.trim();
}

const QTY_RE = /^\d{1,5}(\.\d{1,3})?$/;
const PRICE_RE = /^\d{1,8}(\.\d{1,2})?$/;
const MAX_QTY_MILLI = 99_999_000n;
const MAX_PRICE_CENTS = 9_999_999_999n;

export function validatePurchaseRequisition(
  rows: PurchaseRequisitionRow[],
  reason: string,
): PurchaseRequisitionErrors {
  const errors: PurchaseRequisitionErrors = { rows: {} };
  const filled = rows.filter((row) => !isBlankPurchaseRequisitionRow(row));

  if (filled.length === 0) errors.general = 'Isi minimal satu barang.';
  if (filled.length > 100) errors.general = 'Maksimal 100 barang per PR.';
  if (reason.trim().length > 500) errors.general = 'Alasan maksimal 500 karakter.';

  const productRows = new Map<number, number>();
  rows.forEach((row, index) => {
    if (isBlankPurchaseRequisitionRow(row)) return;
    const rowErrors: PurchaseRequisitionRowErrors = {};

    if (!row.product) {
      rowErrors.product_id = 'Pilih produk.';
    } else {
      const previousIndex = productRows.get(row.product.id);
      if (previousIndex !== undefined) {
        rowErrors.product_id = 'Produk sudah ada di baris lain; gabungkan jumlahnya.';
      } else {
        productRows.set(row.product.id, index);
      }
    }

    const qty = normalizeDecimal(row.qty);
    const qtyMilli = qtyToMilli(qty);
    if (!qty || !QTY_RE.test(qty) || qtyMilli === null || qtyMilli <= 0n || qtyMilli > MAX_QTY_MILLI) {
      rowErrors.qty = 'Jumlah harus lebih dari 0 (maks. 99.999, 3 desimal).';
    }

    const price = normalizeDecimal(row.estPrice);
    const priceCents = price ? moneyToCents(price) : null;
    if (price && (!PRICE_RE.test(price) || priceCents === null || priceCents > MAX_PRICE_CENTS)) {
      rowErrors.est_price = 'Estimasi harga tidak valid (maks. Rp99.999.999,99).';
    }
    if (row.note.trim().length > 255) rowErrors.note = 'Catatan maksimal 255 karakter.';

    if (Object.keys(rowErrors).length > 0) errors.rows[index] = rowErrors;
  });

  return errors;
}

export interface BuiltPurchaseRequisition {
  payload: PurchaseRequisitionInput;
  indexMap: number[];
}

export function buildPurchaseRequisitionInput(
  rows: PurchaseRequisitionRow[],
  reason: string,
): BuiltPurchaseRequisition {
  const indexMap: number[] = [];
  const items: PurchaseRequisitionInput['items'] = [];

  rows.forEach((row, index) => {
    if (isBlankPurchaseRequisitionRow(row) || !row.product) return;
    const item: PurchaseRequisitionInput['items'][number] = {
      product_id: row.product.id,
      qty: normalizeDecimal(row.qty),
    };
    const price = normalizeDecimal(row.estPrice);
    if (price) item.est_price = price;
    if (row.note.trim()) item.note = row.note.trim();
    items.push(item);
    indexMap.push(index);
  });

  const payload: PurchaseRequisitionInput = { items };
  if (reason.trim()) payload.reason = reason.trim();
  return { payload, indexMap };
}

const ROW_FIELDS: PurchaseRequisitionRowField[] = ['product_id', 'qty', 'est_price', 'note'];

export function mapPurchaseRequisitionServerErrors(
  serverErrors: Record<string, string[]> | undefined,
  indexMap: number[],
): PurchaseRequisitionErrors {
  const errors: PurchaseRequisitionErrors = { rows: {} };
  for (const [key, messages] of Object.entries(serverErrors ?? {})) {
    const message = messages[0] ?? '';
    const match = /^items\.(\d+)\.(\w+)$/.exec(key);
    if (!match) {
      errors.general ??= message;
      continue;
    }

    const rowIndex = indexMap[Number(match[1])];
    const field = match[2] as PurchaseRequisitionRowField;
    if (rowIndex === undefined || !ROW_FIELDS.includes(field)) {
      errors.general ??= message;
      continue;
    }

    errors.rows[rowIndex] ??= {};
    errors.rows[rowIndex]![field] = message;
  }
  return errors;
}
