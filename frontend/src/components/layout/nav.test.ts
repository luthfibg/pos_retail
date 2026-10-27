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
  });

  it('keeps only groups with at least one permitted menu', () => {
    const groups = getVisibleNavGroups((permission) => permission === 'settings.manage', true);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Pengaturan');
    expect(groups[0]?.items.map((item) => item.to)).toEqual(['/settings/vat']);
  });
});
