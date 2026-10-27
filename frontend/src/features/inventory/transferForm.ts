import type { ProductStock, StockTransferInput, StockBatch } from '@/lib/api/types';
import { qtyToMilli } from '@/lib/money';
import type { ProductOption } from './openingForm';

export interface TransferRow {
  key: string;
  product: ProductOption;
  batch: StockBatch;
  qty: string;
  toPositionId: string;
}

export interface TransferErrors {
  general?: string;
  rows: Record<number, string>;
}

export function availableTransferBatches(stock: ProductStock, locationId: number): StockBatch[] {
  return stock.batches.filter((batch) => batch.location_id === locationId && (qtyToMilli(batch.qty_sellable) ?? 0n) > 0n);
}

export function validateTransfer(
  fromLocationId: number | null,
  toLocationId: number | null,
  rows: TransferRow[],
): TransferErrors {
  const errors: TransferErrors = { rows: {} };
  if (!fromLocationId) errors.general = 'Pilih lokasi asal.';
  if (!toLocationId) errors.general = 'Pilih lokasi tujuan.';
  else if (fromLocationId === toLocationId && rows.some((row) => !row.toPositionId.trim())) {
    errors.general = 'Untuk transfer dalam lokasi yang sama, isi posisi tujuan yang berbeda dari posisi asal.';
  }
  if (rows.length === 0) errors.general = 'Tambahkan minimal satu baris produk.';
  if (rows.length > 200) errors.general = 'Maksimal 200 baris per dokumen.';
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const qty = qtyToMilli(row.qty);
    if (qty === null || qty <= 0n || qty > 999_999_999_999n) {
      errors.rows[index] = 'Qty harus lebih dari 0 dan maksimal 999999999.999.';
    } else if (qty > (qtyToMilli(row.batch.qty_sellable) ?? 0n)) {
      errors.rows[index] = 'Qty melebihi saldo sellable pada batch/posisi asal.';
    }

    const positionId = row.toPositionId.trim();
    if (positionId && (!/^[1-9]\d*$/.test(positionId) || !Number.isSafeInteger(Number(positionId)))) {
      errors.rows[index] = 'ID posisi tujuan harus berupa bilangan bulat positif.';
    } else if (fromLocationId === toLocationId && positionId && Number(positionId) === row.batch.shelf_position_id) {
      errors.rows[index] = 'Posisi tujuan harus berbeda dari posisi asal.';
    }

    const key = `${row.product.id}:${row.batch.batch_id ?? 0}:${row.batch.shelf_position_id ?? 0}`;
    if (seen.has(key)) errors.rows[index] = 'Saldo batch/posisi ini sudah ditambahkan.';
    seen.add(key);
  });
  return errors;
}

export function buildTransferInput(
  fromLocationId: number,
  toLocationId: number,
  rows: TransferRow[],
): StockTransferInput {
  return {
    from_location_id: fromLocationId,
    to_location_id: toLocationId,
    items: rows.map((row) => ({
      product_id: row.product.id,
      batch_id: row.batch.batch_id ?? undefined,
      from_position_id: row.batch.shelf_position_id ?? undefined,
      to_position_id: row.toPositionId.trim() ? Number(row.toPositionId.trim()) : undefined,
      qty: row.qty.trim(),
    })),
  };
}
