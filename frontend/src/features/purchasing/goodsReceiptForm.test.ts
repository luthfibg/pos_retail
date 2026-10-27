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
  qtyReceived: '5',
  qtyDamaged: '1',
  expiryDate: '2027-01-01',
  batchCode: 'B-1',
  note: '',
};

describe('validateGoodsReceiptLines', () => {
  it('accepts valid received and damaged quantities within the PO remainder', () => {
    expect(validateGoodsReceiptLines(poItems, [line], { 12: true }, '2026-10-27')).toEqual({});
  });

  it('requires expiry for tracked products and rejects expired dates', () => {
    expect(validateGoodsReceiptLines(poItems, [{ ...line, expiryDate: '' }], { 12: true }, '2026-10-27')['31']?.expiryDate).toBeTruthy();
    expect(validateGoodsReceiptLines(poItems, [{ ...line, expiryDate: '2026-10-26' }], { 12: true }, '2026-10-27')['31']?.expiryDate).toBeTruthy();
  });

  it('rejects totals over the remaining ordered quantity without floating point arithmetic', () => {
    expect(validateGoodsReceiptLines(
      poItems,
      [{ ...line, qtyReceived: '7.999', qtyDamaged: '0.002' }],
      { 12: true },
      '2026-10-27',
    )['31']?.qtyReceived).toBeTruthy();
  });

  it('aggregates split batch rows against the same remaining PO quantity', () => {
    const splitLines = [
      { ...line, qtyReceived: '4.500', qtyDamaged: '0' },
      { ...line, key: '31-1', qtyReceived: '3.501', qtyDamaged: '0' },
    ];
    expect(validateGoodsReceiptLines(poItems, splitLines, { 12: true }, '2026-10-27')['31-1']?.qtyReceived).toBeTruthy();
  });

  it('builds API rows from non-empty quantities and preserves decimal strings', () => {
    expect(buildGoodsReceiptItems([line])).toEqual([{
      po_item_id: 31,
      qty_received: '5',
      qty_damaged: '1',
      expiry_date: '2027-01-01',
      batch_code: 'B-1',
      note: null,
    }]);
  });
});
