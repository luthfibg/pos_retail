import { describe, expect, it } from 'vitest';
import type { ProductStock } from '@/lib/api/types';
import { availableTransferBatches, buildTransferInput, validateTransfer, type TransferRow } from './transferForm';

const product = { id: 12, sku: 'SKU-12', name: 'Produk', unit_name: 'pcs', track_expiry: false };
const stock: ProductStock = {
  product_id: 12,
  sku: 'SKU-12',
  name: 'Produk',
  unit_name: 'pcs',
  track_expiry: false,
  avg_cost: null,
  totals: { qty_sellable: '5.000', qty_quarantine: '0.000', qty_damaged: '0.000' },
  batches: [
    {
      balance_id: 1, batch_id: 7, batch_code: 'B-7', expiry_date: null, expiry_status: 'none',
      is_opening: false, received_at: null, location_id: 2, shelf_position_id: 4,
      qty_sellable: '5.000', qty_quarantine: '0.000', qty_damaged: '0.000',
    },
    {
      balance_id: 2, batch_id: null, batch_code: null, expiry_date: null, expiry_status: 'none',
      is_opening: true, received_at: null, location_id: 2, shelf_position_id: null,
      qty_sellable: '0.000', qty_quarantine: '0.000', qty_damaged: '0.000',
    },
    {
      balance_id: 3, batch_id: 8, batch_code: 'B-8', expiry_date: null, expiry_status: 'none',
      is_opening: false, received_at: null, location_id: 3, shelf_position_id: null,
      qty_sellable: '2.000', qty_quarantine: '0.000', qty_damaged: '0.000',
    },
  ],
};

const row: TransferRow = {
  key: 'row-1',
  product,
  batch: stock.batches[0]!,
  qty: '2.500',
  toPositionId: '9',
};

describe('stock transfer form', () => {
  it('only offers positive sellable balances at the selected source location', () => {
    expect(availableTransferBatches(stock, 2).map((batch) => batch.balance_id)).toEqual([1]);
  });

  it('validates qty using exact decimal units and rejects more than available', () => {
    expect(validateTransfer(2, 3, [{ ...row, qty: '5.000' }]).rows).toEqual({});
    expect(validateTransfer(2, 3, [{ ...row, qty: '5.001' }]).rows[0]).toContain('melebihi saldo');
    expect(validateTransfer(2, 3, [{ ...row, qty: '1.0001' }]).rows[0]).toContain('Qty harus');
    expect(validateTransfer(2, 3, [{ ...row, qty: '0' }]).rows[0]).toContain('lebih dari 0');
  });

  it('requires source and destination and prevents duplicate balance rows', () => {
    expect(validateTransfer(null, 3, [row]).general).toBe('Pilih lokasi asal.');
    expect(validateTransfer(2, null, [row]).general).toBe('Pilih lokasi tujuan.');
    expect(validateTransfer(2, 3, [row, row]).rows[1]).toContain('sudah ditambahkan');
  });

  it('validates destination position identifiers and builds the API payload', () => {
    expect(validateTransfer(2, 3, [{ ...row, toPositionId: 'abc' }]).rows[0]).toContain('bilangan bulat');
    expect(buildTransferInput(2, 3, [row])).toEqual({
      from_location_id: 2,
      to_location_id: 3,
      items: [{
        product_id: 12,
        batch_id: 7,
        from_position_id: 4,
        to_position_id: 9,
        qty: '2.500',
      }],
    });
  });

  it('requires a different position for a same-location putaway', () => {
    expect(validateTransfer(2, 2, [{ ...row, toPositionId: '4' }]).rows[0]).toContain('berbeda');
    expect(validateTransfer(2, 2, [{ ...row, toPositionId: '' }]).general).toContain('posisi tujuan');
  });
});
