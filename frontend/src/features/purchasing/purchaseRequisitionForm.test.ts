import { describe, expect, it } from 'vitest';
import type { ProductOption } from '@/features/inventory/openingForm';
import {
  buildPurchaseRequisitionInput,
  mapPurchaseRequisitionServerErrors,
  validatePurchaseRequisition,
  type PurchaseRequisitionRow,
} from './purchaseRequisitionForm';

const product: ProductOption = {
  id: 12,
  sku: 'SKU-12',
  name: 'Air Mineral',
  unit_name: 'pcs',
  track_expiry: false,
};

const valid: PurchaseRequisitionRow = {
  key: 1,
  product,
  qty: '10,5',
  estPrice: '2500',
  note: 'Stok menipis',
};

describe('validatePurchaseRequisition', () => {
  it('accepts a valid row with Indonesian decimal input', () => {
    expect(validatePurchaseRequisition([valid], '')).toEqual({ rows: {} });
  });

  it('requires a product and a positive quantity with at most three decimals', () => {
    expect(validatePurchaseRequisition([{ ...valid, product: null }], '').rows[0]?.product_id).toBeTruthy();
    expect(validatePurchaseRequisition([{ ...valid, qty: '0' }], '').rows[0]?.qty).toBeTruthy();
    expect(validatePurchaseRequisition([{ ...valid, qty: '1.0001' }], '').rows[0]?.qty).toBeTruthy();
    expect(validatePurchaseRequisition([{ ...valid, qty: '100000' }], '').rows[0]?.qty).toBeTruthy();
  });

  it('rejects duplicate products and an invalid estimated price', () => {
    expect(validatePurchaseRequisition([valid, { ...valid, key: 2 }], '').rows[1]?.product_id).toBeTruthy();
    expect(validatePurchaseRequisition([{ ...valid, estPrice: '10.999' }], '').rows[0]?.est_price).toBeTruthy();
  });

  it('builds a decimal-string payload and maps 422 errors to the visible row', () => {
    const built = buildPurchaseRequisitionInput([{ ...valid, note: '  Stok menipis  ' }], '  Kebutuhan toko ');
    expect(built).toEqual({
      payload: {
        reason: 'Kebutuhan toko',
        items: [{ product_id: 12, qty: '10.5', est_price: '2500', note: 'Stok menipis' }],
      },
      indexMap: [0],
    });
    expect(mapPurchaseRequisitionServerErrors({ 'items.0.qty': ['Jumlah terlalu besar.'] }, built.indexMap).rows[0]?.qty)
      .toBe('Jumlah terlalu besar.');
  });
});
