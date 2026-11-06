import type { AdjustmentReason, AdjustmentType, Product } from '@/lib/api/types';
import { milliToQty, qtyToMilli } from '@/lib/money';

export interface AdjustmentValues {
  product: Product | null;
  type: AdjustmentType;
  quantity: string;
  reason: AdjustmentReason | null;
  notes: string;
  expiryDate: string;
}

export interface AdjustmentErrors {
  product?: string;
  quantity?: string;
  reason?: string;
  notes?: string;
  expiryDate?: string;
}

export function validateAdjustment(values: AdjustmentValues): AdjustmentErrors {
  const errors: AdjustmentErrors = {};
  if (!values.product) errors.product = 'Pilih produk terlebih dahulu.';
  if (!/^[1-9]\d*$/.test(values.quantity) || Number(values.quantity) > 999_999_999) {
    errors.quantity = 'Jumlah harus berupa bilangan bulat lebih dari 0.';
  }
  if (!values.reason?.selectable) errors.reason = 'Pilih alasan adjustment.';
  if (values.reason?.requires_notes && !values.notes.trim()) errors.notes = 'Catatan wajib diisi untuk alasan ini.';
  if (values.notes.length > 500) errors.notes = 'Catatan maksimal 500 karakter.';
  if (values.product?.track_expiry && values.type === 'increase' && !values.expiryDate) {
    errors.expiryDate = 'Tanggal kedaluwarsa wajib diisi untuk produk ini.';
  }

  const stock = qtyToMilli(values.product?.store_floor_stock_sellable);
  if (values.product && stock === null) errors.product = 'Stok toko belum dapat dimuat. Pilih ulang produk sebelum menyimpan.';
  if (values.type === 'decrease' && stock !== null && /^[1-9]\d*$/.test(values.quantity)) {
    if (BigInt(values.quantity) * 1000n > stock) {
      errors.quantity = 'Jumlah melebihi stok saat ini. Kurangi jumlah sebelum menyimpan.';
    }
  }

  return errors;
}

export function previewAdjustmentStock(values: AdjustmentValues): string | null {
  const stock = qtyToMilli(values.product?.store_floor_stock_sellable);
  if (stock === null || !/^[1-9]\d*$/.test(values.quantity)) return null;
  const quantity = BigInt(values.quantity) * 1000n;
  if (values.type === 'decrease' && quantity > stock) return null;
  return milliToQty(values.type === 'increase' ? stock + quantity : stock - quantity);
}
