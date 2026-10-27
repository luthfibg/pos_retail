import type { GoodsReceiptItemInput, PurchaseOrderItem } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { qtyToMilli } from '@/lib/money';

export interface GoodsReceiptLineForm {
  key: string;
  poItemId: number;
  qtyReceived: string;
  qtyDamaged: string;
  expiryDate: string;
  batchCode: string;
  note: string;
}

export interface GoodsReceiptLineErrors {
  qtyReceived?: string;
  qtyDamaged?: string;
  expiryDate?: string;
}

export type GoodsReceiptLineErrorMap = Record<string, GoodsReceiptLineErrors>;

export function validateGoodsReceiptLines(
  poItems: PurchaseOrderItem[],
  lines: GoodsReceiptLineForm[],
  tracksExpiry: Record<number, boolean>,
  today: string,
): GoodsReceiptLineErrorMap {
  const errors: GoodsReceiptLineErrorMap = {};
  const usedByPoItem = new Map<number, bigint>();
  let hasReceivedQuantity = false;

  for (const line of lines) {
    const item = poItems.find((candidate) => candidate.id === line.poItemId);
    if (!item) continue;

    const received = normalizeDecimal(line.qtyReceived);
    const damaged = normalizeDecimal(line.qtyDamaged);
    const receivedMilli = received ? qtyToMilli(received) : 0n;
    const damagedMilli = damaged ? qtyToMilli(damaged) : 0n;
    const lineErrors: GoodsReceiptLineErrors = {};

    if (received && (receivedMilli === null || receivedMilli > 99_999_000n)) {
      lineErrors.qtyReceived = 'Jumlah diterima tidak valid (maks. 99.999, 3 desimal).';
    }
    if (damaged && (damagedMilli === null || damagedMilli > 99_999_000n)) {
      lineErrors.qtyDamaged = 'Jumlah rusak tidak valid (maks. 99.999, 3 desimal).';
    }
    if (receivedMilli === null || damagedMilli === null) {
      errors[line.key] = lineErrors;
      continue;
    }

    const total = receivedMilli + damagedMilli;
    if (total > 0n) {
      hasReceivedQuantity = true;
      usedByPoItem.set(line.poItemId, (usedByPoItem.get(line.poItemId) ?? 0n) + total);
    }

    const remaining = qtyToMilli(item.qty_remaining);
    if (remaining === null || (usedByPoItem.get(line.poItemId) ?? 0n) > remaining) {
      lineErrors.qtyReceived = 'Jumlah diterima dan rusak melebihi sisa pesanan.';
    }

    if ((receivedMilli ?? 0n) > 0n && tracksExpiry[item.product_id]) {
      if (!line.expiryDate) lineErrors.expiryDate = 'Tanggal kedaluwarsa wajib diisi.';
      else if (line.expiryDate < today) lineErrors.expiryDate = 'Tanggal kedaluwarsa tidak boleh sudah lewat.';
    } else if (line.expiryDate && !tracksExpiry[item.product_id]) {
      lineErrors.expiryDate = 'Produk ini tidak melacak tanggal kedaluwarsa.';
    }

    if (Object.keys(lineErrors).length > 0) errors[line.key] = lineErrors;
  }

  if (!hasReceivedQuantity && Object.keys(errors).length === 0 && lines.length > 0) {
    errors[lines[0]!.key] = { qtyReceived: 'Isi jumlah untuk sedikitnya satu barang.' };
  }

  return errors;
}

export function buildGoodsReceiptItems(lines: GoodsReceiptLineForm[]): GoodsReceiptItemInput[] {
  return lines
    .filter((line) => (qtyToMilli(normalizeDecimal(line.qtyReceived)) ?? 0n) > 0n
      || (qtyToMilli(normalizeDecimal(line.qtyDamaged)) ?? 0n) > 0n)
    .map((line) => ({
      po_item_id: line.poItemId,
      qty_received: normalizeDecimal(line.qtyReceived) || '0',
      qty_damaged: normalizeDecimal(line.qtyDamaged) || '0',
      expiry_date: line.expiryDate || null,
      batch_code: line.batchCode.trim() || null,
      note: line.note.trim() || null,
    }));
}
