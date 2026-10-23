import { describe, expect, it } from 'vitest';
import type { Customer } from '@/lib/api/types';
import {
  buildCustomerCreate, buildCustomerUpdate, buildVerifyPayload, emptyCustomer, validateCustomer,
  validateMoney, valuesFromCustomer,
} from './customerForm';

const active: Customer = {
  id: 3, customer_no: 'NIK-100', name: 'Budi', department: 'Produksi', status: 'active',
  credit_state: 'available', credit_remaining: '900000.00', verified_at: '2026-10-23 03:20:00.000',
};
const pending: Customer = { ...active, status: 'pending_verification', credit_state: 'not_verified', verified_at: null };

describe('validateCustomer', () => {
  it('NIK dan nama wajib', () => {
    const e = validateCustomer(emptyCustomer());
    expect(e.customer_no).toBeTruthy();
    expect(e.name).toBeTruthy();
  });
  it('NIK menolak spasi dan simbol asing, menerima . _ - /', () => {
    expect(validateCustomer({ ...emptyCustomer(), name: 'A', customerNo: 'A B' }).customer_no).toBeTruthy();
    expect(validateCustomer({ ...emptyCustomer(), name: 'A', customerNo: 'NIK-1/2_3.4' }).customer_no).toBeUndefined();
  });
});

describe('payload', () => {
  it('tambah: departemen kosong dilewati', () => {
    expect(buildCustomerCreate({ ...emptyCustomer(), customerNo: ' N1 ', name: ' Ani ' })).toEqual({ customer_no: 'N1', name: 'Ani' });
  });
  it('ubah tanpa perubahan = kosong', () => {
    expect(buildCustomerUpdate(valuesFromCustomer(active), active)).toEqual({});
  });
  it('mengosongkan departemen dikirim null; status berubah + alasan', () => {
    const v = { ...valuesFromCustomer(active), department: '', status: 'inactive' as const, reason: 'resign' };
    expect(buildCustomerUpdate(v, active)).toEqual({ department: null, status: 'inactive', reason: 'resign' });
  });
  it('karyawan menunggu verifikasi: status tidak pernah dikirim', () => {
    const v = { ...valuesFromCustomer(pending), name: 'Budi S', status: 'active' as const };
    expect(buildCustomerUpdate(v, pending)).toEqual({ name: 'Budi S' });
  });
});

describe('uang', () => {
  it('validateMoney', () => {
    expect(validateMoney('', true)).toBeTruthy();
    expect(validateMoney('', false)).toBeUndefined();
    expect(validateMoney('1500000', true)).toBeUndefined();
    expect(validateMoney('1500000,50', true)).toBeUndefined();
    expect(validateMoney('1.5', false)).toBeUndefined();
    expect(validateMoney('abc', true)).toBeTruthy();
    expect(validateMoney('-5', true)).toBeTruthy();
  });
  it('payload verifikasi: batas hanya dikirim bila berwenang', () => {
    expect(buildVerifyPayload('1500000', 'ok', true)).toEqual({ credit_limit: '1500000', note: 'ok' });
    expect(buildVerifyPayload('1500000', '', false)).toEqual({});
  });
});
