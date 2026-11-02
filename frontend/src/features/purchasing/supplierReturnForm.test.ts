import { describe, expect, it } from 'vitest';
import type { ProductStock } from '@/lib/api/types';
import {
  availableReturnBalances,
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
  avg_cost: '1000.0000',
  totals: { qty_sellable: '5.000', qty_quarantine: '0.000', qty_damaged: '2.000' },
  batches: [
    {
      balance_id: 1, batch_id: 8, batch_code: 'B-8', expiry_date: '2027-01-01', expiry_status: 'ok',
      is_opening: false, received_at: null, location_id: 2, shelf_position_id: 3,
      qty_sellable: '5.000', qty_quarantine: '0.000', qty_damaged: '2.000',
    },
    {
      balance_id: 2, batch_id: 9, batch_code: 'B-9', expiry_date: null, expiry_status: 'none',
      is_opening: true, received_at: null, location_id: 2, shelf_position_id: null,
      qty_sellable: '0.000', qty_quarantine: '0.000', qty_damaged: '0.000',
    },
  ],
};
const product = { id: 12, sku: 'SKU-12', name: 'Produk', unit_name: 'pcs', track_expiry: true };
const line: SupplierReturnLine = {
  key: 1,
  product,
  balance: stock.batches[0]!,
  sourceBucket: 'damaged',
  qty: '1.500',
};

describe('supplierReturnForm', () => {
  it('filters balances with positive quantity in the selected source bucket', () => {
    expect(availableReturnBalances(stock, 'sellable').map((item) => item.balance_id)).toEqual([1]);
    expect(availableReturnBalances(stock, 'damaged').map((item) => item.balance_id)).toEqual([1]);
    expect(availableReturnBalances({ ...stock, batches: stock.batches.map((item) => ({ ...item, batch_id: null })) }, 'sellable')).toEqual([]);
  });

  it('validates required data, positive quantities, balance limits, and duplicate source balances', () => {
    expect(validateSupplierReturn(4, [line], '').rows).toEqual({});
    expect(validateSupplierReturn(null, [line], '').general).toBe('Pilih supplier.');
    expect(validateSupplierReturn(4, [{ ...line, qty: '2.001' }], '').rows[0]).toContain('melebihi saldo');
    expect(validateSupplierReturn(4, [{ ...line, qty: '0' }], '').rows[0]).toContain('lebih dari 0');
    expect(validateSupplierReturn(4, [line, { ...line, key: 2 }], '').rows[1]).toContain('duplikat');
  });

  it('builds the draft request from the selected batch and bucket', () => {
    expect(buildSupplierReturnInput(4, [line], ' Rusak ')).toEqual({
      supplier_id: 4,
      note: 'Rusak',
      items: [{
        product_id: 12,
        batch_id: 8,
        location_id: 2,
        shelf_position_id: 3,
        source_bucket: 'damaged',
        qty: '1.500',
      }],
    });
  });
});
