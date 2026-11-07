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
    const groups = getVisibleNavGroups((permission) => permissions.has(permission), false, undefined, ['Kasir']);
    const paths = groups.flatMap((group) => group.items.map((item) => item.to));

    expect(paths).toContain('/pos');
    expect(paths).toContain('/shift');
    expect(paths).toContain('/sales');
    expect(paths).not.toContain('/billing');
  });

  it('restricts goods receipt menu to cashiers, even when another role has the permission', () => {
    const can = (permission: string) => permission === 'goods_receipt.create';
    const cashierPaths = getVisibleNavGroups(can, false, undefined, ['Kasir'])
      .flatMap((group) => group.items.map((item) => item.to));
    const purchasingPaths = getVisibleNavGroups(can, false, undefined, ['Purchasing'])
      .flatMap((group) => group.items.map((item) => item.to));
    const adminPaths = getVisibleNavGroups(can, true, undefined, ['Admin'])
      .flatMap((group) => group.items.map((item) => item.to));

    expect(cashierPaths).toContain('/goods-receipts');
    expect(purchasingPaths).not.toContain('/goods-receipts');
    expect(adminPaths).not.toContain('/goods-receipts');
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
      'Dashboard', 'Pembelian', 'Inventory', 'Penjualan', 'Keuangan', 'Data Master', 'Pengaturan',
    ]);
  });

  it('shift dibuka sebelum kasir dipakai dan penerimaan serta retur berada di grup Inventory', () => {
    const groups = getVisibleNavGroups(() => true, false, undefined, ['Kasir']);
    const paths = groups.flatMap((group) => group.items.map((item) => item.to));
    expect(paths.indexOf('/shift')).toBeLessThan(paths.indexOf('/pos'));
    expect(paths.indexOf('/pos')).toBeLessThan(paths.indexOf('/sales'));
    const inventory = groups.find((group) => group.label === 'Inventory');
    expect(inventory?.items.map((item) => item.to)).toContain('/goods-receipts');
    expect(inventory?.items.map((item) => item.to)).toContain('/supplier-returns');
    expect(paths).not.toContain('/inventory/opening');
    expect(paths).not.toContain('/inventory/transfers');
  });

  it('menampilkan menu stok eksisting dan transfer hanya saat pengaturannya aktif', () => {
    const groups = getVisibleNavGroups(() => true, false, {
      show_opening_balance: true,
      show_stock_transfer: true,
    });
    const paths = groups.flatMap((group) => group.items.map((item) => item.to));
    expect(paths.indexOf('/inventory/opening')).toBeLessThan(paths.indexOf('/inventory/transfers'));
    expect(paths).toContain('/inventory/opening');
    expect(paths).toContain('/inventory/transfers');
  });
});
