import { describe, expect, it } from 'vitest';
import {
  buildOpeningPayload, mapServerErrors, newRow, validateOpening, type OpeningRow, type ProductOption,
} from './openingForm';

const prod: ProductOption = { id: 12, sku: 'P-000012', name: 'Air', unit_name: 'pcs', track_expiry: true };
const row = (p: Partial<OpeningRow>): OpeningRow => ({ ...newRow(), ...p });

describe('validateOpening', () => {
  it('semua baris kosong -> galat umum', () => {
    expect(validateOpening([newRow(), newRow()], '').general).toBeTruthy();
  });
  it('baris kosong diabaikan, baris terisi divalidasi', () => {
    const rows = [newRow(), row({ product: prod, qty: '0' }), row({ qty: '5' })];
    const e = validateOpening(rows, '');
    expect(e.rows[0]).toBeUndefined();
    expect(e.rows[1]?.qty).toBeTruthy();
    expect(e.rows[2]?.product_id).toBeTruthy();
  });
  it('menerima koma desimal dan menolak tanggal palsu', () => {
    const ok = validateOpening([row({ product: prod, qty: '10,5', unitCost: '1000,25' })], '');
    expect(ok.rows[0]).toBeUndefined();
    const bad = validateOpening([row({ product: prod, qty: '1', expiry: '2027-02-31' })], '');
    expect(bad.rows[0]?.expiry_date).toBeTruthy();
  });
});

describe('buildOpeningPayload', () => {
  it('melewati baris kosong dan mencatat pemetaan indeks', () => {
    const rows = [newRow(), row({ product: prod, qty: '24', unitCost: '2000', expiry: '2027-03-01', batchCode: ' L1 ' })];
    const { payload, indexMap } = buildOpeningPayload(rows, ' awal ');
    expect(payload).toEqual({
      note: 'awal',
      items: [{ product_id: 12, qty: '24', unit_cost: '2000', expiry_date: '2027-03-01', batch_code: 'L1' }],
    });
    expect(indexMap).toEqual([1]);
  });
  it('kolom opsional kosong tidak dikirim', () => {
    const { payload } = buildOpeningPayload([row({ product: prod, qty: '3' })], '');
    expect(payload).toEqual({ items: [{ product_id: 12, qty: '3' }] });
  });
});

describe('mapServerErrors', () => {
  it('memetakan items.N.field ke baris layar lewat indexMap', () => {
    const e = mapServerErrors({ 'items.0.qty': ['salah'], 'items.0.product_id': ['sudah ada pergerakan'], note: ['terlalu panjang'] }, [3]);
    expect(e.rows[3]).toEqual({ qty: 'salah', product_id: 'sudah ada pergerakan' });
    expect(e.general).toBe('terlalu panjang');
  });
});
