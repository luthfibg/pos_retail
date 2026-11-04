import { describe, expect, it } from 'vitest';
import type { StockAuthorityRule } from '@/lib/api/types';
import {
  buildPayload,
  effectiveRoles,
  emptyRuleKeys,
  groupRules,
  pendingChanges,
  resetToDefault,
  rowTitle,
  sameRoles,
  toggleRole,
  validationMessages,
} from './stockAuthorityLogic';

const ASSIGNABLE = ['Kasir', 'Finance', 'Purchasing', 'Accounting', 'Owner'];

function rule(key: string, over: Partial<StockAuthorityRule> = {}): StockAuthorityRule {
  const [action = key, scope = null] = key.split('.');
  return {
    key, action, scope: scope as StockAuthorityRule['scope'], permission: 'x', label: `Aturan ${key}`, description: 'd',
    roles: ['Kasir'], default_roles: ['Kasir'], customized: false, active_users: 1, applies: true, warnings: [], ...over,
  };
}

describe('stockAuthorityLogic', () => {
  it('membandingkan role tanpa memperhatikan urutan', () => {
    expect(sameRoles(['A', 'B'], ['B', 'A'])).toBe(true);
    expect(sameRoles(['A'], ['A', 'B'])).toBe(false);
  });

  it('mencentang menambah role sesuai urutan kolom, mencabut kembali menghapus perubahan', () => {
    const r = rule('receipt.store_floor');
    const added = toggleRole(r, {}, 'Purchasing', ASSIGNABLE);
    expect(added['receipt.store_floor']).toEqual(['Kasir', 'Purchasing']);
    const back = toggleRole(r, added, 'Purchasing', ASSIGNABLE);
    expect(back).toEqual({});
  });

  it('mengosongkan semua role ditandai agar simpan ditahan', () => {
    const r = rule('opening_balance');
    const draft = toggleRole(r, {}, 'Kasir', ASSIGNABLE);
    expect(effectiveRoles(r, draft)).toEqual([]);
    expect(emptyRuleKeys([r, rule('transfer.warehouse')], draft)).toEqual(['opening_balance']);
  });

  it('payload hanya memuat aturan yang berubah dan memakai null bila kembali ke default', () => {
    const custom = rule('transfer.warehouse', { roles: ['Purchasing'], default_roles: ['Kasir'], customized: true });
    const plain = rule('receipt.warehouse');
    const unchanged = rule('adjustment_approve', { roles: ['Owner'], default_roles: ['Owner'] });

    const toDefault = resetToDefault(custom, {});
    const withOther = toggleRole(plain, toDefault, 'Finance', ASSIGNABLE);
    const changes = pendingChanges([custom, plain, unchanged], withOther);

    expect(buildPayload(changes)).toEqual([
      { key: 'transfer.warehouse', roles: null },
      { key: 'receipt.warehouse', roles: ['Kasir', 'Finance'] },
    ]);
  });

  it('reset pada aturan yang sudah default tidak membuat perubahan', () => {
    const r = rule('receipt.store_floor');
    expect(resetToDefault(r, {})).toEqual({});
  });

  it('mengelompokkan per operasi dengan judul dan membedakan Toko/Gudang', () => {
    const groups = groupRules([
      rule('opening_balance'),
      rule('receipt.store_floor'),
      rule('receipt.warehouse'),
      rule('supplier_return.store_floor'),
      rule('supplier_return.warehouse'),
      rule('adjustment_approve'),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['Stok eksisting toko', 'Penerimaan barang', 'Retur supplier', 'Persetujuan adjustment / opname']);
    expect(groups[1]?.rules.map(rowTitle)).toEqual(['Lokasi Toko', 'Lokasi Gudang']);
    expect(groups[2]?.rules.map(rowTitle)).toEqual(['Lokasi Toko', 'Lokasi Gudang']);
    expect(rowTitle(rule('opening_balance'))).toBe('Aturan opening_balance');
  });

  it('menggabungkan pesan 422 tanpa duplikat', () => {
    expect(validationMessages({ 'rules.0.roles': ['Role Owner tidak tersedia.'], 'rules.1.roles': ['Role Owner tidak tersedia.', 'Kosong.'] }))
      .toEqual(['Role Owner tidak tersedia.', 'Kosong.']);
    expect(validationMessages(undefined)).toEqual([]);
  });
});
