import { describe, expect, it } from 'vitest';
import type { ProductStock } from '@/lib/api/types';
import {
  availableReturnQty,
  buildSupplierReturnInput,
  validateSupplierReturn,
  type SupplierReturnLine,
} from './supplierReturnForm';

const stock: ProductStock = {
  product_id: 12,
  sku: 'SKU-12',
  name: 'Produk',
  unit_name: 'pcs',
  track_expiry: true,
  unit_cost: '1000.0000',
  totals: { qty_sellable: '5.000', qty_quarantine: '0.000', qty_damaged: '2.000' },
  batches: [
    {
      balance_id: 1, batch_id: 8, batch_code: 'B-8', expiry_date: '2027-01-01', expiry_status: 'ok',
      is_opening: false, received_at: null, location_id: 2, shelf_position_id: 3,
      qty_sellable: '5.000', qty_quarantine: '0.000', qty_damaged: '2.000',
    },
    {
      balance_id: 2, batch_id: null, batch_code: null, expiry_date: null, expiry_status: 'none',
      is_opening: true, received_at: null, location_id: 2, shelf_position_id: null,
      qty_sellable: '4.000', qty_quarantine: '0.000', qty_damaged: '0.000',
    },
  ],
};
const product = { id: 12, sku: 'SKU-12', name: 'Produk', unit_name: 'pcs', track_expiry: true };
const line: SupplierReturnLine = {
  key: 1,
  product,
  sourceBucket: 'damaged',
  qty: '1.500',
  available: '2.000',
};

describe('supplierReturnForm', () => {
  it('aggregates available stock while excluding unbatched balances for expiry-tracked products', () => {
    expect(availableReturnQty(stock, 'sellable')).toBe('5.000');
    expect(availableReturnQty(stock, 'damaged')).toBe('2.000');
  });

  it('validates required data, positive quantities, balance limits, and duplicate product buckets', () => {
    expect(validateSupplierReturn(4, [line], '').rows).toEqual({});
    expect(validateSupplierReturn(null, [line], '').general).toBe('Pilih supplier.');
    expect(validateSupplierReturn(4, [{ ...line, qty: '2.001' }], '').rows[0]).toContain('melebihi saldo');
    expect(validateSupplierReturn(4, [{ ...line, qty: '0' }], '').rows[0]).toContain('lebih dari 0');
    expect(validateSupplierReturn(4, [line, { ...line, key: 2 }], '').rows[1]).toContain('dua kali');
  });

  it('builds a quantity-only outgoing return request', () => {
    expect(buildSupplierReturnInput(4, [line], ' Rusak ')).toEqual({
      return_type: 'outgoing',
      supplier_id: 4,
      note: 'Rusak',
      items: [{
        product_id: 12,
        source_bucket: 'damaged',
        qty: '1.500',
      }],
    });
  });
});
