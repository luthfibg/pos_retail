import { describe, expect, it } from 'vitest';
import {
  addProduct, buildSaleInput, isShiftProblem, mapSaleErrors, mustChangeKey, needsCreditException, salePreviewChanged,
  newIdempotencyKey, parseQty, removeLine, setQty, validateCart, validateTendered, type CartProduct,
} from './cartLogic';

const air: CartProduct = { id: 12, sku: 'P-000012', name: 'Air', unit_name: 'pcs', sell_price: '10000.00', status: 'active', stock_sellable: '24.000' };
const roti: CartProduct = { id: 15, sku: 'P-000015', name: 'Roti', unit_name: 'pcs', sell_price: '5500.00', status: 'active', stock_sellable: '10.000' };
const baru: CartProduct = { id: 20, sku: 'P-000020', name: 'Baru', unit_name: 'pcs', sell_price: null, status: 'pending_price', stock_sellable: '0.000' };

describe('keranjang', () => {
  it('produk sama digabung, qty dijumlahkan tanpa float', () => {
    let l = addProduct([], air);
    l = addProduct(l, air, '0,5');
    l = addProduct(l, air, '0.1');
    expect(l).toHaveLength(1);
    expect(l[0]?.qty).toBe('1.6');
  });
  it('qty tak valid saat menambah diabaikan', () => {
    expect(addProduct([], air, '0')).toEqual([]);
    expect(addProduct([], air, '1.2345')).toEqual([]);
    expect(addProduct([], air, 'abc')).toEqual([]);
  });
  it('maksimal 100 baris', () => {
    let l = addProduct([], air);
    for (let i = 1; i < 100; i += 1) l = addProduct(l, { ...air, id: 1000 + i });
    expect(l).toHaveLength(100);
    expect(addProduct(l, { ...air, id: 5000 })).toHaveLength(100);
    expect(addProduct(l, air)[0]?.qty).toBe('2'); // yang sudah ada tetap bisa ditambah
  });
  it('ubah dan hapus baris lewat key', () => {
    const l = addProduct(addProduct([], air), roti);
    const key = l[1]?.key ?? -1;
    expect(setQty(l, key, '3,5')[1]?.qty).toBe('3,5');
    expect(removeLine(l, key)).toHaveLength(1);
  });
});

describe('validateCart', () => {
  it('kosong -> galat umum', () => {
    expect(validateCart([]).general).toBeTruthy();
  });
  it('produk yang belum bisa dijual ditandai per baris', () => {
    const e = validateCart(addProduct(addProduct([], air), baru));
    expect(e.lines[0]).toBeUndefined();
    expect(e.lines[1]?.product).toBeTruthy();
  });
  it('qty tidak valid ditandai per baris', () => {
    const l = addProduct([], air);
    const bad = setQty(l, l[0]?.key ?? -1, '0');
    expect(validateCart(bad).lines[0]?.qty).toBeTruthy();
    expect(validateCart(setQty(l, l[0]?.key ?? -1, '2,5')).lines[0]).toBeUndefined();
  });
  it('qty maks 99.999 dan 3 desimal', () => {
    expect(parseQty('99999')).toBe(99999000n);
    expect(parseQty('99999,001')).toBeNull();
    expect(parseQty('0.001')).toBe(1n);
  });
});

describe('pratinjau dan uang diterima', () => {
  it('mendeteksi perubahan total posting dibanding pratinjau', () => {
    expect(salePreviewChanged('27500.00', '27500.00')).toBe(false);
    expect(salePreviewChanged('27500.00', '27750.00')).toBe(true);
    expect(salePreviewChanged(null, '27750.00')).toBe(false);
  });
  it('validateTendered', () => {
    expect(validateTendered('', null)).toBeTruthy();
    expect(validateTendered('abc', null)).toBeTruthy();
    expect(validateTendered('50000', null)).toBeUndefined();
    expect(validateTendered('50000,50', '27500.00')).toBeUndefined();
    expect(validateTendered('20000', '27500.00')).toBeTruthy();
    expect(validateTendered('27500', '27500.00')).toBeUndefined();
    expect(validateTendered('1000000000000', null)).toBeTruthy();
  });
});

describe('buildSaleInput', () => {
  const lines = addProduct(addProduct([], air, '2'), roti, '0,5');
  it('tunai: qty kanonik, uang diterima ternormalisasi, tanpa customer bila tidak dipilih', () => {
    expect(buildSaleInput(lines, 'k-1', { mode: 'cash', customerId: null, tendered: '50000,00' })).toEqual({
      idempotency_key: 'k-1', payment_mode: 'cash', amount_tendered: '50000.00',
      items: [{ product_id: 12, qty: '2.000' }, { product_id: 15, qty: '0.500' }],
    });
  });
  it('kredit: customer dikirim, tanpa amount_tendered, tanpa pengecualian bila tidak ada', () => {
    const p = buildSaleInput(lines, 'k-2', { mode: 'payroll_credit', customerId: 3, tendered: '999' });
    expect(p.customer_id).toBe(3);
    expect('amount_tendered' in p).toBe(false);
    expect('credit_exception' in p).toBe(false);
  });
  it('kredit dengan pengecualian Admin: kredensial dan catatan dirapikan', () => {
    const p = buildSaleInput(lines, 'k-3', {
      mode: 'payroll_credit', customerId: 3, tendered: '',
      exception: { approver_username: ' admin ', approver_password: ' rahasia ', note: ' darurat ' },
    });
    expect(p.credit_exception).toEqual({ approver_username: 'admin', approver_password: ' rahasia ', note: 'darurat' });
  });
  it('pengecualian diabaikan untuk tunai', () => {
    const p = buildSaleInput(lines, 'k-4', {
      mode: 'cash', customerId: null, tendered: '60000',
      exception: { approver_username: 'a', approver_password: 'b', note: 'c' },
    });
    expect('credit_exception' in p).toBe(false);
  });
  it('baris tak valid melempar galat', () => {
    expect(() => buildSaleInput(setQty(lines, lines[0]?.key ?? 0, '0'), 'k', { mode: 'cash', customerId: null, tendered: '1' })).toThrow();
  });
});

describe('mapSaleErrors', () => {
  it('baris, kolom, dan galat umum', () => {
    const e = mapSaleErrors({
      'items.1.qty': ['Stok tidak mencukupi'], 'items.0.product_id': ['Produk belum dapat dijual'],
      amount_tendered: ['Uang diterima kurang'], shift: ['Buka shift'], items: ['Minimal satu'],
    });
    expect(e.lines[1]).toEqual({ qty: 'Stok tidak mencukupi' });
    expect(e.lines[0]).toEqual({ product_id: 'Produk belum dapat dijual' });
    expect(e.fields.amount_tendered).toBe('Uang diterima kurang');
    expect(isShiftProblem(e)).toBe(true);
    expect(e.general).toBe('Minimal satu');
  });
  it('credit_limit memicu pengecualian; kredensial dan catatan dipetakan', () => {
    const e = mapSaleErrors({ credit_limit: ['Melebihi batas'], 'credit_exception.approver_password': ['Salah'], 'credit_exception.note': ['Wajib'] });
    expect(needsCreditException(e)).toBe(true);
    expect(e.fields.approver_password).toBe('Salah');
    expect(e.fields['credit_exception.note']).toBe('Wajib');
    expect(mustChangeKey(e)).toBe(false);
  });
  it('kunci ditolak -> wajib kunci baru; undefined aman', () => {
    expect(mustChangeKey(mapSaleErrors({ idempotency_key: ['dipakai'] }))).toBe(true);
    expect(mapSaleErrors(undefined)).toEqual({ lines: {}, fields: {} });
  });
});

describe('newIdempotencyKey', () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  it('memakai randomUUID bila ada', () => {
    expect(newIdempotencyKey({ randomUUID: () => 'dari-bawaan', getRandomValues: () => undefined })).toBe('dari-bawaan');
  });
  it('cadangan lewat getRandomValues menghasilkan UUID v4 yang valid (konteks non-HTTPS)', () => {
    let n = 7; // pencacah sederhana: tiap panggilan menghasilkan urutan berbeda
    const fake = { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i += 1) { n += 37; a[i] = n & 255; } } };
    const k = newIdempotencyKey(fake);
    expect(k).toMatch(V4);
    expect(newIdempotencyKey(fake)).not.toBe(k);
  });
  it('kunci bawaan runtime valid dan unik', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(V4);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});
