import { describe, expect, it } from 'vitest';
import { LEGACY_REDIRECTS, SECTIONS, SETTINGS_PERMISSIONS, groupSections, sectionFromHash, visibleSections } from './settingsSections';

const all = () => true;
const only = (...permissions: string[]) => (permission: string) => permissions.includes(permission);

describe('settingsSections', () => {
  it('pemegang semua izin melihat semua bagian dalam urutan kategori', () => {
    expect(visibleSections(all).map((section) => section.id)).toEqual(['store-name', 'admin-model', 'warehouse', 'stock-monitoring', 'stock-authority', 'vat', 'discounts', 'float-policy', 'registers', 'users', 'approval-auth']);
  });

  it('bagian mengikuti izin masing-masing', () => {
    expect(visibleSections(only('discount.manage')).map((section) => section.id)).toEqual(['discounts']);
    expect(visibleSections(only('user.manage')).map((section) => section.id)).toEqual(['users', 'approval-auth']);
    expect(visibleSections(only('inventory.adjust.approve')).map((section) => section.id)).toEqual(['approval-auth']);
    expect(visibleSections(only('float.configure')).map((section) => section.id)).toEqual(['float-policy']);
    expect(visibleSections(only('register.manage')).map((section) => section.id)).toEqual(['registers']);
    expect(visibleSections(only('settings.manage')).map((section) => section.id)).toEqual(['store-name', 'admin-model', 'warehouse', 'stock-monitoring', 'stock-authority', 'vat', 'approval-auth']);
    expect(visibleSections(only('shift.review'))).toEqual([]);
  });

  it('pencarian memakai judul, deskripsi, dan kata kunci', () => {
    expect(visibleSections(all, 'pajak').map((section) => section.id)).toEqual(['vat']);
    expect(visibleSections(all, 'nama toko').map((section) => section.id)).toEqual(['store-name']);
    expect(visibleSections(all, 'SANDI').map((section) => section.id)).toEqual(['users']);
    expect(visibleSections(all, 'opname').map((section) => section.id)).toEqual(['stock-authority']);
    expect(visibleSections(all, 'Permintaan otomatis').map((section) => section.id)).toEqual(['stock-monitoring']);
    expect(visibleSections(all, 'endapan').map((section) => section.id)).toEqual(['float-policy']);
    expect(visibleSections(all, 'kunci').map((section) => section.id)).toEqual(['approval-auth']);
    expect(visibleSections(all, 'tidak-ada')).toEqual([]);
    expect(visibleSections(only('discount.manage'), 'pajak')).toEqual([]);
  });

  it('mengelompokkan per kategori dan membuang kategori kosong', () => {
    const groups = groupSections(visibleSections(only('settings.manage', 'user.manage')));
    expect(groups.map((group) => group.label)).toEqual(['Toko', 'Penjualan & harga', 'Akun']);
    expect(groups[0]?.sections.map((section) => section.id)).toEqual(['store-name', 'admin-model', 'warehouse', 'stock-monitoring', 'stock-authority']);
  });

  it('membaca hash hanya untuk bagian yang tersedia', () => {
    const sections = visibleSections(only('discount.manage'));
    expect(sectionFromHash('#discounts', sections)).toBe('discounts');
    expect(sectionFromHash('#users', sections)).toBe(null);
    expect(sectionFromHash('', sections)).toBe(null);
  });

  it('rute lama menunjuk bagian yang ada dan izin layar mencakup semua bagian', () => {
    const ids = SECTIONS.map((section) => section.id);
    for (const id of Object.values(LEGACY_REDIRECTS)) expect(ids).toContain(id);
    for (const section of SECTIONS) {
      const permissions = Array.isArray(section.permission) ? section.permission : [section.permission];
      for (const permission of permissions) expect(SETTINGS_PERMISSIONS).toContain(permission);
    }
  });
});
