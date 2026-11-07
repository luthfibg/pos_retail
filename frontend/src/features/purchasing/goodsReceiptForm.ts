import type { GoodsReceiptItemInput, PurchaseOrderItem } from '@/lib/api/types';
import { normalizeDecimal } from '@/features/products/productForm';
import { qtyToMilli } from '@/lib/money';

export interface GoodsReceiptLineForm {
  key: string;
  poItemId: number;
  qtyDamaged: string;
  qtyShort: string;
  expiryDate: string;
  note: string;
}

export interface GoodsReceiptLineErrors {
  qtyDamaged?: string;
  qtyShort?: string;
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
  let hasReceivedQuantity = false;

  for (const line of lines) {
    const item = poItems.find((candidate) => candidate.id === line.poItemId);
    if (!item) continue;

    const damaged = normalizeDecimal(line.qtyDamaged);
    const short = normalizeDecimal(line.qtyShort);
    const damagedMilli = damaged ? qtyToMilli(damaged) : 0n;
    const shortMilli = short ? qtyToMilli(short) : 0n;
    const lineErrors: GoodsReceiptLineErrors = {};

    if (damaged && (damagedMilli === null || damagedMilli > 99_999_000n)) {
      lineErrors.qtyDamaged = 'Jumlah rusak tidak valid (maks. 99.999, 3 desimal).';
    }
    if (short && (shortMilli === null || shortMilli > 99_999_000n)) {
      lineErrors.qtyShort = 'Jumlah tidak dikirim tidak valid (maks. 99.999, 3 desimal).';
    }
    if (damagedMilli === null || shortMilli === null) {
      errors[line.key] = lineErrors;
      continue;
    }

    const remaining = qtyToMilli(item.qty_remaining);
    if (remaining === null || damagedMilli + shortMilli > remaining) {
      lineErrors.qtyDamaged = 'Jumlah rusak dan tidak dikirim melebihi sisa pesanan.';
    }

    const receivedMilli = remaining === null ? null : remaining - damagedMilli - shortMilli;
    if (receivedMilli !== null && receivedMilli + damagedMilli > 0n) hasReceivedQuantity = true;

    const stockableQuantity = (receivedMilli !== null && receivedMilli > 0n) || damagedMilli > 0n;
    if (stockableQuantity && tracksExpiry[item.product_id]) {
      if (!line.expiryDate) lineErrors.expiryDate = 'Tanggal kedaluwarsa wajib diisi.';
      else if (line.expiryDate < today) lineErrors.expiryDate = 'Tanggal kedaluwarsa tidak boleh sudah lewat.';
    } else if (line.expiryDate && !tracksExpiry[item.product_id]) {
      lineErrors.expiryDate = 'Produk ini tidak melacak tanggal kedaluwarsa.';
    }

    if (Object.keys(lineErrors).length > 0) errors[line.key] = lineErrors;
  }

  if (!hasReceivedQuantity && Object.keys(errors).length === 0 && lines.length > 0) {
    errors[lines[0]!.key] = { qtyShort: 'Tidak ada barang yang diterima; batalkan PO jika seluruh barang tidak dikirim.' };
  }

  return errors;
}

export function buildGoodsReceiptItems(poItems: PurchaseOrderItem[], lines: GoodsReceiptLineForm[]): GoodsReceiptItemInput[] {
  return lines.map((line) => {
    const item = poItems.find((candidate) => candidate.id === line.poItemId);
    if (!item) throw new Error('Barang penerimaan tidak ditemukan pada PO.');
    const remaining = qtyToMilli(item.qty_remaining);
    const damaged = qtyToMilli(normalizeDecimal(line.qtyDamaged)) ?? 0n;
    const short = qtyToMilli(normalizeDecimal(line.qtyShort)) ?? 0n;
    if (remaining === null || damaged + short > remaining) throw new Error('Jumlah barang rusak dan tidak dikirim tidak valid.');
    const received = remaining - damaged - short;
    const receivedQuantity = `${received / 1000n}.${String(received % 1000n).padStart(3, '0')}`;
    return {
      po_item_id: line.poItemId,
      qty_received: receivedQuantity,
      qty_damaged: normalizeDecimal(line.qtyDamaged) || '0',
      qty_short: normalizeDecimal(line.qtyShort) || '0',
      damage_disposition: damaged > 0n ? 'quarantine' : null,
      expiry_date: line.expiryDate || null,
      note: line.note.trim() || null,
    };
  });
}
