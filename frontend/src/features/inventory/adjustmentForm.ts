import type {
  ProductStock,
  StockAdjustmentInput,
  StockAdjustmentReason,
  StockBatch,
} from '@/lib/api/types';
import { qtyToMilli } from '@/lib/money';
import type { ProductOption } from './openingForm';

export interface AdjustmentRow {
  key: string;
  product: ProductOption;
  batchId: number | null;
  batchCode: string | null;
  expiryDate: string | null;
  locationId: number;
  shelfPositionId: number | null;
  qtyBefore: string;
  qtyCounted: string;
}

export interface AdjustmentErrors {
  general?: string;
  rows: Record<number, string>;
}

export function adjustmentBalanceKey(
  productId: number,
  batchId: number | null,
  locationId: number,
  shelfPositionId: number | null,
): string {
  return `${productId}:${locationId}:${shelfPositionId ?? 0}:${batchId ?? 0}`;
}

export function rowsFromStock(product: ProductOption, stock: ProductStock): AdjustmentRow[] {
  return stock.batches.map((batch: StockBatch) => ({
    key: adjustmentBalanceKey(product.id, batch.batch_id, batch.location_id, batch.shelf_position_id),
    product,
    batchId: batch.batch_id,
    batchCode: batch.batch_code,
    expiryDate: batch.expiry_date,
    locationId: batch.location_id,
    shelfPositionId: batch.shelf_position_id,
    qtyBefore: batch.qty_sellable,
    qtyCounted: batch.qty_sellable,
  }));
}

export function validateAdjustment(
  rows: AdjustmentRow[],
  note: string,
): AdjustmentErrors {
  const errors: AdjustmentErrors = { rows: {} };
  if (rows.length === 0) errors.general = 'Tambahkan minimal satu saldo stok.';
  if (rows.length > 200) errors.general = 'Maksimal 200 saldo per dokumen.';
  if (note.trim().length > 500) errors.general = 'Catatan maksimal 500 karakter.';

  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const qty = qtyToMilli(row.qtyCounted);
    if (qty === null || qty > 999_999_999_000n) {
      errors.rows[index] = 'Jumlah hitung harus 0–999999999 dengan maksimal 3 desimal.';
    }
    if (seen.has(row.key)) {
      errors.rows[index] = 'Kombinasi saldo ini sudah ditambahkan.';
    }
    seen.add(row.key);
  });
  return errors;
}

export function buildAdjustmentInput(
  reason: StockAdjustmentReason,
  rows: AdjustmentRow[],
  note: string,
): StockAdjustmentInput {
  const input: StockAdjustmentInput = {
    reason,
    items: rows.map((row) => ({
      product_id: row.product.id,
      batch_id: row.batchId ?? undefined,
      location_id: row.locationId,
      shelf_position_id: row.shelfPositionId ?? undefined,
      qty_counted: row.qtyCounted.trim(),
    })),
  };
  if (note.trim()) input.note = note.trim();
  return input;
}
