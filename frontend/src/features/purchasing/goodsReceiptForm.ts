import type { GoodsReceiptItemInput, PurchaseOrderItem } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { qtyToMilli } from '@/lib/money';

export interface GoodsReceiptLineForm {
  key: string;
  poItemId: number;
  qtyReceived: string;
  qtyDamaged: string;
  expiryDate: string;
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
  let hasAnyReceivedQuantity = false;

  for (const line of lines) {
    const item = poItems.find((candidate) => candidate.id === line.poItemId);
    if (!item) continue;

    const received = normalizeDecimal(line.qtyReceived);
    const damaged = normalizeDecimal(line.qtyDamaged);
    const receivedMilli = received ? qtyToMilli(received) : 0n;
    const damagedMilli = damaged ? qtyToMilli(damaged) : 0n;
    const lineErrors: GoodsReceiptLineErrors = {};

    if (received && (receivedMilli === null || receivedMilli > 99_999_000n)) {
      lineErrors.qtyReceived = 'Jumlah barang bagus tidak valid (maks. 99.999, 3 desimal).';
    }
    if (damaged && (damagedMilli === null || damagedMilli > 99_999_000n)) {
      lineErrors.qtyDamaged = 'Jumlah rusak tidak valid (maks. 99.999, 3 desimal).';
    }
    if (receivedMilli === null || damagedMilli === null) {
      errors[line.key] = lineErrors;
      continue;
    }

    const remaining = qtyToMilli(item.qty_remaining);
    if (remaining === null || receivedMilli + damagedMilli > remaining) {
      lineErrors.qtyReceived = 'Jumlah barang bagus dan rusak melebihi sisa pesanan PO.';
    }

    if (receivedMilli + damagedMilli > 0n) hasAnyReceivedQuantity = true;

    const stockableQuantity = receivedMilli > 0n || damagedMilli > 0n;
    if (stockableQuantity && tracksExpiry[item.product_id]) {
      if (!line.expiryDate) lineErrors.expiryDate = 'Tanggal kedaluwarsa wajib diisi.';
      else if (line.expiryDate < today) lineErrors.expiryDate = 'Tanggal kedaluwarsa tidak boleh sudah lewat.';
    } else if (line.expiryDate && !tracksExpiry[item.product_id]) {
      lineErrors.expiryDate = 'Produk ini tidak melacak tanggal kedaluwarsa.';
    }

    if (Object.keys(lineErrors).length > 0) errors[line.key] = lineErrors;
  }

  if (!hasAnyReceivedQuantity && Object.keys(errors).length === 0 && lines.length > 0) {
    errors[lines[0]!.key] = { qtyReceived: 'Isi jumlah barang bagus atau rusak yang benar-benar diterima.' };
  }

  return errors;
}

export function buildGoodsReceiptItems(poItems: PurchaseOrderItem[], lines: GoodsReceiptLineForm[]): GoodsReceiptItemInput[] {
  return lines.map((line) => {
    const item = poItems.find((candidate) => candidate.id === line.poItemId);
    if (!item) throw new Error('Barang penerimaan tidak ditemukan pada PO.');
    const remaining = qtyToMilli(item.qty_remaining);
    const received = qtyToMilli(normalizeDecimal(line.qtyReceived)) ?? 0n;
    const damaged = qtyToMilli(normalizeDecimal(line.qtyDamaged)) ?? 0n;
    if (remaining === null || received + damaged > remaining) throw new Error('Jumlah barang bagus dan rusak melebihi sisa pesanan PO.');
    return {
      po_item_id: line.poItemId,
      qty_received: normalizeDecimal(line.qtyReceived) || '0',
      qty_damaged: normalizeDecimal(line.qtyDamaged) || '0',
      damage_disposition: damaged > 0n ? 'quarantine' : null,
      expiry_date: line.expiryDate || null,
      note: line.note.trim() || null,
    };
  });
}
