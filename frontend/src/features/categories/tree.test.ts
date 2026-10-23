import { describe, expect, it } from 'vitest';
import type { Category } from '@/lib/api/types';
import { descendantIds, flattenTree } from './tree';

const c = (id: number, name: string, parent_id: number | null = null): Category => ({
  id, name, parent_id, is_active: true, products_count: 0,
});

const cats = [c(1, 'Minuman'), c(2, 'Snack'), c(3, 'Teh', 1), c(4, 'Botol', 3), c(5, 'Air', 1)];

describe('tree', () => {
  it('mengurutkan induk lalu anak dengan kedalaman', () => {
    expect(flattenTree(cats).map((r) => [r.category.name, r.depth])).toEqual([
      ['Minuman', 0], ['Air', 1], ['Teh', 1], ['Botol', 2], ['Snack', 0],
    ]);
  });
  it('turunan mencakup cucu', () => {
    expect([...descendantIds(cats, 1)].sort()).toEqual([3, 4, 5]);
    expect(descendantIds(cats, 2).size).toBe(0);
  });
  it('induk yang tidak ada diperlakukan sebagai akar', () => {
    expect(flattenTree([c(9, 'Yatim', 99)])).toHaveLength(1);
  });
});
