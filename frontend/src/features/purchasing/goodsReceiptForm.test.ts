import { describe, expect, it } from 'vitest';
import type { PurchaseOrderItem } from '@/lib/api/types';
import { buildGoodsReceiptItems, validateGoodsReceiptLines, type GoodsReceiptLineForm } from './goodsReceiptForm';

const poItems: PurchaseOrderItem[] = [
  {
    id: 31,
    product_id: 12,
    sku: 'SKU-12',
    name: 'Susu',
    unit_name: 'pcs',
    qty_ordered: '10.000',
    qty_received: '2.000',
    qty_remaining: '8.000',
    unit_price: null,
    line_total: null,
  },
];

const line: GoodsReceiptLineForm = {
  key: '31',
  poItemId: 31,
  qtyDamaged: '1',
  qtyShort: '2',
  expiryDate: '2027-01-01',
  note: '',
};

describe('validateGoodsReceiptLines', () => {
  it('accepts valid damaged and undelivered quantities within the PO remainder', () => {
    expect(validateGoodsReceiptLines(poItems, [line], { 12: true }, '2026-10-27')).toEqual({});
  });

  it('requires expiry for tracked products and rejects expired dates', () => {
    expect(validateGoodsReceiptLines(poItems, [{ ...line, expiryDate: '' }], { 12: true }, '2026-10-27')['31']?.expiryDate).toBeTruthy();
    expect(validateGoodsReceiptLines(poItems, [{ ...line, expiryDate: '2026-10-26' }], { 12: true }, '2026-10-27')['31']?.expiryDate).toBeTruthy();
  });

  it('rejects damaged and undelivered totals over the remaining order without floating point arithmetic', () => {
    expect(validateGoodsReceiptLines(
      poItems,
      [{ ...line, qtyDamaged: '6.999', qtyShort: '1.002' }],
      { 12: true },
      '2026-10-27',
    )['31']?.qtyDamaged).toBeTruthy();
  });

  it('requires at least some goods to be received', () => {
    expect(validateGoodsReceiptLines(poItems, [{ ...line, qtyDamaged: '0', qtyShort: '8' }], { 12: true }, '2026-10-27')['31']?.qtyShort).toBeTruthy();
  });

  it('calculates good quantity from PO remainder, damaged and undelivered amounts', () => {
    expect(buildGoodsReceiptItems(poItems, [line])).toEqual([{
      po_item_id: 31,
      qty_received: '5.000',
      qty_damaged: '1',
      qty_short: '2',
      damage_disposition: 'quarantine',
      expiry_date: '2027-01-01',
      note: null,
    }]);
  });
});
