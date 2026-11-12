import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/api/types';
import { calculateAdjustmentPlan, previewAdjustmentStock, validateAdjustment } from './adjustmentForm';

const product: Product = {
  id: 1,
  sku: 'SKU-1',
  barcode: '123',
  name: 'Produk',
  category_id: null,
  category_name: null,
  unit_name: 'pcs',
  track_expiry: false,
  sell_price: '1000.00',
  unit_cost: '500.00',
  suppliers: [],
  min_stock: '0',
  critical_stock: '0',
  restock_quantity: '0',
  status: 'active',
  stock_sellable: '5.500',
  store_floor_stock_sellable: '5.500',
  stock_status: 'aman',
};

const reason = { code: 'damaged', label: 'Barang rusak', requires_notes: false, selectable: true } as const;

describe('direct adjustment form validation', () => {
  it('automatically derives decrease and sends the difference from the target stock', () => {
    expect(calculateAdjustmentPlan(product, '2.5')).toEqual({
      type: 'decrease',
      quantity: 3,
      stockAfter: '2.500',
      unchanged: false,
    });

    const errors = validateAdjustment({
      product,
      quantity: '2.5',
      reason,
      notes: '',
      expiryDate: '',
    });

    expect(errors.quantity).toBeUndefined();
  });

  it('automatically derives increase, accepts zero stock, and rejects a no-op', () => {
    expect(calculateAdjustmentPlan(product, '8.5')?.type).toBe('increase');
    expect(calculateAdjustmentPlan(product, '0')?.type).toBe('decrease');
    expect(validateAdjustment({
      product,
      quantity: '5.5',
      reason,
      notes: '',
      expiryDate: '',
    }).quantity).toContain('tidak berubah');
  });

  it('requires notes for the other reason and expiry for tracked products', () => {
    const errors = validateAdjustment({
      product: { ...product, track_expiry: true },
      quantity: '6.5',
      reason: { code: 'other', label: 'Lainnya', requires_notes: true, selectable: true },
      notes: '',
      expiryDate: '',
    });

    expect(errors.notes).toContain('wajib diisi');
    expect(errors.expiryDate).toContain('wajib diisi');
  });

  it('uses exact thousandths and only allows whole-unit adjustment differences', () => {
    expect(previewAdjustmentStock({
      product,
      quantity: '7.5',
      reason,
      notes: '',
      expiryDate: '',
    })).toBe('7.500');
    expect(validateAdjustment({
      product,
      quantity: '5',
      reason,
      notes: '',
      expiryDate: '',
    }).quantity).toContain('bilangan bulat');
  });
});
