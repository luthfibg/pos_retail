import { describe, expect, it } from 'vitest';
import type { ProductStock } from '@/lib/api/types';
import {
  adjustmentBalanceKey,
  buildAdjustmentInput,
  rowsFromStock,
  validateAdjustment,
} from './adjustmentForm';
import type { AdjustmentRow } from './adjustmentForm';

const product = { id: 12, sku: 'SKU-12', name: 'Produk', unit_name: 'pcs', track_expiry: false };

const stock: ProductStock = {
  product_id: 12,
  sku: 'SKU-12',
  name: 'Produk',
  unit_name: 'pcs',
  track_expiry: false,
  avg_cost: '1000.0000',
  totals: { qty_sellable: '5.000', qty_quarantine: '0.000', qty_damaged: '0.000' },
  batches: [{
    balance_id: 1,
    batch_id: null,
    batch_code: null,
    expiry_date: null,
    expiry_status: 'none',
    is_opening: false,
    received_at: null,
    location_id: 2,
    shelf_position_id: 4,
    qty_sellable: '5.000',
    qty_quarantine: '0.000',
    qty_damaged: '0.000',
  }],
};

function firstStockRow(): AdjustmentRow {
  const row = rowsFromStock(product, stock)[0];
  if (!row) throw new Error('Expected stock fixture to produce an adjustment row.');
  return row;
}

describe('adjustment form', () => {
  it('creates one count row for each existing stock balance', () => {
    expect(rowsFromStock(product, stock)).toEqual([{
      key: '12:2:4:0',
      product,
      batchId: null,
      batchCode: null,
      expiryDate: null,
      locationId: 2,
      shelfPositionId: 4,
      qtyBefore: '5.000',
      qtyCounted: '5.000',
    }]);
  });

  it('validates zero and exact three-decimal quantities without float math', () => {
    const row = firstStockRow();
    expect(validateAdjustment([{ ...row, qtyCounted: '0' }], '').rows).toEqual({});
    expect(validateAdjustment([{ ...row, qtyCounted: '1.2345' }], '').rows[0]).toContain('maksimal 3 desimal');
    expect(validateAdjustment([{ ...row, qtyCounted: '1000000000' }], '').rows[0]).toContain('999999999');
  });

  it('rejects duplicate stock balance keys and builds the backend payload', () => {
    const row = firstStockRow();
    expect(adjustmentBalanceKey(12, null, 2, 4)).toBe(row.key);
    expect(validateAdjustment([row, row], '').rows[1]).toContain('sudah ditambahkan');
    expect(buildAdjustmentInput('opname', [{ ...row, qtyCounted: '0' }], '  hitung rak  ')).toEqual({
      reason: 'opname',
      note: 'hitung rak',
      items: [{
        product_id: 12,
        batch_id: undefined,
        location_id: 2,
        shelf_position_id: 4,
        qty_counted: '0',
      }],
    });
  });

  it('requires at least one counted balance and limits the note', () => {
    expect(validateAdjustment([], '').general).toBe('Tambahkan minimal satu saldo stok.');
    expect(validateAdjustment(rowsFromStock(product, stock), 'x'.repeat(501)).general).toBe('Catatan maksimal 500 karakter.');
  });
});
