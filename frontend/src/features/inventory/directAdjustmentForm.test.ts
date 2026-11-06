import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/api/types';
import { previewDirectAdjustmentStock, validateDirectAdjustment } from './directAdjustmentForm';

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
  it('requires an integer quantity and prevents reducing more than available stock', () => {
    const errors = validateDirectAdjustment({
      product,
      type: 'decrease',
      quantity: '6',
      reason,
      notes: '',
      expiryDate: '',
    });

    expect(errors.quantity).toContain('melebihi stok');
  });

  it('requires notes for the other reason and expiry for tracked products', () => {
    const errors = validateDirectAdjustment({
      product: { ...product, track_expiry: true },
      type: 'increase',
      quantity: '1',
      reason: { code: 'other', label: 'Lainnya', requires_notes: true, selectable: true },
      notes: '',
      expiryDate: '',
    });

    expect(errors.notes).toContain('wajib diisi');
    expect(errors.expiryDate).toContain('wajib diisi');
  });

  it('previews stock using exact thousandths without floating-point arithmetic', () => {
    expect(previewDirectAdjustmentStock({
      product,
      type: 'increase',
      quantity: '2',
      reason,
      notes: '',
      expiryDate: '',
    })).toBe('7.500');
  });
});
