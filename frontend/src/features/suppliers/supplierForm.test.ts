import { describe, expect, it } from 'vitest';
import type { Supplier } from '@/lib/api/types';
import {
  buildSupplierCreate, buildSupplierUpdate, emptySupplier, validateSupplier, valuesFromSupplier,
} from './supplierForm';

const supplier: Supplier = {
  id: 1, code: 'SUP-01', name: 'PT Maju', contact_name: 'Budi', phone: '0812', address: null,
  default_payment_terms: 'credit', is_active: true,
};

describe('validateSupplier', () => {
  it('kode dan nama wajib saat tambah', () => {
    const e = validateSupplier(emptySupplier(), 'create');
    expect(e.code).toBeTruthy();
    expect(e.name).toBeTruthy();
  });
  it('kode tidak divalidasi saat ubah', () => {
    expect(validateSupplier({ ...valuesFromSupplier(supplier), code: '' }, 'edit').code).toBeUndefined();
  });
  it('menolak kode dengan spasi', () => {
    expect(validateSupplier({ ...emptySupplier(), code: 'A B', name: 'X' }, 'create').code).toBeTruthy();
  });
});

describe('payload', () => {
  it('tambah: kolom opsional kosong dilewati', () => {
    const p = buildSupplierCreate({ ...emptySupplier(), code: ' S1 ', name: ' Toko ', phone: '08' });
    expect(p).toEqual({ code: 'S1', name: 'Toko', default_payment_terms: 'prepaid', phone: '08' });
  });
  it('ubah tanpa perubahan = kosong', () => {
    expect(buildSupplierUpdate(valuesFromSupplier(supplier), supplier)).toEqual({});
  });
  it('mengosongkan kolom opsional dikirim null; alamat null->kosong tidak berubah', () => {
    const v = { ...valuesFromSupplier(supplier), contactName: '', address: '' };
    expect(buildSupplierUpdate(v, supplier)).toEqual({ contact_name: null });
  });
  it('mengubah termin dan status', () => {
    const v = { ...valuesFromSupplier(supplier), terms: 'cod' as const, isActive: false };
    expect(buildSupplierUpdate(v, supplier)).toEqual({ default_payment_terms: 'cod', is_active: false });
  });
});
