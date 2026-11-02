import { describe, expect, it } from 'vitest';
import { getVisibleNavGroups } from './nav';

describe('sidebar navigation', () => {
  it('hides cashier-only pages from admin navigation', () => {
    const groups = getVisibleNavGroups(() => true, true);
    const paths = groups.flatMap((group) => group.items.map((item) => item.to));

    expect(paths).not.toContain('/pos');
    expect(paths).not.toContain('/shift');
    expect(paths).toContain('/sales');
    expect(paths).toContain('/shifts');
  });

  it('keeps cashier pages visible to a cashier', () => {
    const permissions = new Set(['sales.create', 'shift.open']);
    const groups = getVisibleNavGroups((permission) => permissions.has(permission), false);
    const paths = groups.flatMap((group) => group.items.map((item) => item.to));

    expect(paths).toContain('/pos');
    expect(paths).toContain('/shift');
    expect(paths).toContain('/sales');
    expect(paths).not.toContain('/billing');
  });

  it('shows billing only to users with period or invoice access', () => {
    const groups = getVisibleNavGroups((permission) => permission === 'invoice.generate', true);
    expect(groups.flatMap((group) => group.items.map((item) => item.to))).toContain('/billing');
  });

  it('shows user management only to users with user.manage', () => {
    const groups = getVisibleNavGroups((permission) => permission === 'user.manage', true);
    expect(groups.flatMap((group) => group.items.map((item) => item.to))).toEqual(['/settings']);
  });

  it('keeps only groups with at least one permitted menu', () => {
    const groups = getVisibleNavGroups((permission) => permission === 'settings.manage', true);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Pengaturan');
    expect(groups[0]?.items.map((item) => item.to)).toEqual(['/settings']);
  });

  it('grup dengan satu menu ditandai standalone, grup berisi banyak menu tetap dropdown', () => {
    const permissions = new Set(['reports.view', 'shift.review', 'cash_deposit.receive']);
    const groups = getVisibleNavGroups((permission) => permissions.has(permission), true);

    expect(groups.map((group) => [group.label, group.standalone])).toEqual([
      ['Dashboard', true],
      ['Keuangan', false],
    ]);
    expect(groups[1]?.items.map((item) => item.to)).toEqual(['/shifts', '/cash-deposits']);
  });

  it('urutan grup mengikuti alur kerja', () => {
    const groups = getVisibleNavGroups(() => true, true);
    expect(groups.map((group) => group.label)).toEqual([
      'Dashboard', 'Penjualan', 'Keuangan', 'Pembelian', 'Inventory', 'Data Master', 'Pengaturan',
    ]);
  });

  it('shift dibuka sebelum kasir dipakai, dan penerimaan barang mengikuti permintaan pembelian', () => {
    const paths = getVisibleNavGroups(() => true, false).flatMap((group) => group.items.map((item) => item.to));
    expect(paths.indexOf('/shift')).toBeLessThan(paths.indexOf('/pos'));
    expect(paths.indexOf('/pos')).toBeLessThan(paths.indexOf('/sales'));
    expect(paths.indexOf('/purchase-requisitions')).toBeLessThan(paths.indexOf('/goods-receipts'));
    expect(paths.indexOf('/inventory/opening')).toBeLessThan(paths.indexOf('/inventory/movements'));
  });
});
