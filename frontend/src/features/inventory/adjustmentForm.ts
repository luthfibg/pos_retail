import type { AdjustmentReason, AdjustmentType, Product } from '@/lib/api/types';
import { milliToQty, qtyToMilli } from '@/lib/money';

export interface AdjustmentValues {
  product: Product | null;
  quantity: string;
  reason: AdjustmentReason | null;
  notes: string;
  expiryDate: string;
}

export interface AdjustmentPlan {
  type: AdjustmentType | null;
  quantity: number | null;
  stockAfter: string;
  unchanged: boolean;
}

export interface AdjustmentErrors {
  product?: string;
  quantity?: string;
  reason?: string;
  notes?: string;
  expiryDate?: string;
}

const TARGET_QUANTITY_RE = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/;
const MAX_ADJUSTMENT_QUANTITY = 999_999_999n;

export function calculateAdjustmentPlan(product: Product | null, targetQuantity: string): AdjustmentPlan | null {
  const currentStock = qtyToMilli(product?.store_floor_stock_sellable);
  const targetStock = TARGET_QUANTITY_RE.test(targetQuantity) ? qtyToMilli(targetQuantity) : null;
  if (currentStock === null || targetStock === null) return null;

  const difference = targetStock - currentStock;
  const unchanged = difference === 0n;
  const absoluteDifference = unchanged ? 0n : difference > 0n ? difference : -difference;
  const wholeUnitDifference = absoluteDifference % 1000n === 0n;
  const adjustmentQuantity = absoluteDifference / 1000n;

  return {
    type: unchanged ? null : difference > 0n ? 'increase' : 'decrease',
    quantity: wholeUnitDifference && adjustmentQuantity <= MAX_ADJUSTMENT_QUANTITY
      ? Number(adjustmentQuantity)
      : null,
    stockAfter: milliToQty(targetStock),
    unchanged,
  };
}

export function validateAdjustment(values: AdjustmentValues): AdjustmentErrors {
  const errors: AdjustmentErrors = {};
  if (!values.product) errors.product = 'Pilih produk terlebih dahulu.';

  const quantityIsValid = TARGET_QUANTITY_RE.test(values.quantity);
  if (!quantityIsValid) {
    errors.quantity = 'Stok akhir tidak valid.';
  }

  const plan = calculateAdjustmentPlan(values.product, values.quantity);
  if (values.product && qtyToMilli(values.product.store_floor_stock_sellable) === null) {
    errors.product = 'Stok toko belum dapat dimuat. Pilih ulang produk sebelum menyimpan.';
  }
  if (quantityIsValid && plan?.unchanged) {
    errors.quantity = 'Stok tidak berubah.';
  } else if (quantityIsValid && plan?.quantity === null) {
    errors.quantity = 'Selisih harus bilangan bulat.';
  }

  if (!values.reason?.selectable) errors.reason = 'Pilih alasan adjustment.';
  if (values.reason?.requires_notes && !values.notes.trim()) errors.notes = 'Catatan wajib diisi untuk alasan ini.';
  if (values.notes.length > 500) errors.notes = 'Catatan maksimal 500 karakter.';
  if (values.product?.track_expiry && plan?.type === 'increase' && !values.expiryDate) {
    errors.expiryDate = 'Tanggal kedaluwarsa wajib diisi untuk produk ini.';
  }

  return errors;
}

export function previewAdjustmentStock(values: AdjustmentValues): string | null {
  return calculateAdjustmentPlan(values.product, values.quantity)?.stockAfter ?? null;
}
