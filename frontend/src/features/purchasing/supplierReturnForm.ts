import type {
  ProductStock,
  SupplierReturnBucket,
  SupplierReturnInput,
  StockBatch,
} from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { qtyToMilli } from '@/lib/money';
import type { ProductOption } from '@/features/inventory/openingForm';

export interface SupplierReturnLine {
  key: number;
  product: ProductOption;
  balance: StockBatch;
  sourceBucket: SupplierReturnBucket;
  qty: string;
}

export interface SupplierReturnFormErrors {
  general?: string;
  rows: Record<number, string>;
}

export function availableReturnBalances(
  stock: ProductStock,
  sourceBucket: SupplierReturnBucket,
): StockBatch[] {
  const field = sourceBucket === 'sellable' ? 'qty_sellable' : 'qty_damaged';
  return stock.batches.filter((balance) =>
    (qtyToMilli(balance[field]) ?? 0n) > 0n && (!stock.track_expiry || balance.batch_id !== null),
  );
}

export function validateSupplierReturn(
  supplierId: number | null,
  rows: SupplierReturnLine[],
  note: string,
): SupplierReturnFormErrors {
  const errors: SupplierReturnFormErrors = { rows: {} };
  if (!supplierId) errors.general = 'Pilih supplier.';
  if (rows.length === 0) errors.general = 'Tambahkan minimal satu barang.';
  if (rows.length > 200) errors.general = 'Maksimal 200 baris per dokumen.';
  if (note.trim().length > 500) errors.general = 'Catatan maksimal 500 karakter.';

  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const balance = row.balance;
    const available = qtyToMilli(row.sourceBucket === 'sellable' ? balance.qty_sellable : balance.qty_damaged);
    const qty = qtyToMilli(row.qty);
    if (qty === null || qty <= 0n || qty > 999_999_999_000n) {
      errors.rows[index] = 'Qty harus lebih dari 0 dan maksimal 999999999.999.';
    } else if (available === null || qty > available) {
      errors.rows[index] = 'Qty melebihi saldo bucket pada batch/lokasi/posisi yang dipilih.';
    }

    const key = [
      row.product.id,
      balance.batch_id ?? '',
      balance.location_id,
      balance.shelf_position_id ?? '',
      row.sourceBucket,
    ].join(':');
    if (seen.has(key)) errors.rows[index] = 'Kombinasi produk, batch, lokasi, posisi, dan bucket tidak boleh duplikat.';
    seen.add(key);
  });

  return errors;
}

export function buildSupplierReturnInput(
  supplierId: number,
  rows: SupplierReturnLine[],
  note: string,
): SupplierReturnInput {
  const input: SupplierReturnInput = {
    supplier_id: supplierId,
    items: rows.map((row) => ({
      product_id: row.product.id,
      ...(row.balance.batch_id === null ? {} : { batch_id: row.balance.batch_id }),
      location_id: row.balance.location_id,
      ...(row.balance.shelf_position_id === null ? {} : { shelf_position_id: row.balance.shelf_position_id }),
      source_bucket: row.sourceBucket,
      qty: normalizeDecimal(row.qty),
    })),
  };
  if (note.trim()) input.note = note.trim();
  return input;
}
