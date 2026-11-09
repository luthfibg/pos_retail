import { describe, expect, it } from 'vitest';
import type { OpnameProgressNode, OpnameProgressTree } from '@/lib/api/types';
import { nextIncompleteNode, resolveWorkingNode } from './opnameWorkingNode';

function node(
  id: string | number,
  directProductCount: number,
  directCountedCount: number,
  children: OpnameProgressNode[] = [],
): OpnameProgressNode {
  const childProducts = children.reduce((total, child) => total + child.product_count, 0);
  const childCounted = children.reduce((total, child) => total + child.counted_count, 0);
  return {
    id,
    name: String(id),
    parent_id: null,
    depth: 0,
    product_count: directProductCount + childProducts,
    counted_count: directCountedCount + childCounted,
    status: 'partial',
    direct_product_count: directProductCount,
    direct_counted_count: directCountedCount,
    children,
  };
}

function tree(nodes: OpnameProgressNode[]): OpnameProgressTree {
  return {
    session: { id: 1, number: 'OPN-TEST', status: 'in_progress' },
    display: { reveals_system_qty: false },
    summary: {
      total_products: nodes.reduce((total, item) => total + item.product_count, 0),
      counted_products: nodes.reduce((total, item) => total + item.counted_count, 0),
    },
    nodes,
  };
}

describe('opname working node', () => {
  it('prefers direct uncounted products before descending into children', () => {
    const child = node('child', 2, 0);
    const parent = node('parent', 1, 0, [child]);

    expect(resolveWorkingNode(tree([parent]), 'parent')?.id).toBe('parent');
  });

  it('finds the first incomplete descendant in depth-first order', () => {
    const first = node('first', 1, 1);
    const second = node('second', 2, 1);
    const parent = node('parent', 0, 0, [first, second]);

    expect(resolveWorkingNode(tree([parent]), 'parent')?.id).toBe('second');
  });

  it('chooses the next incomplete node after a completed subtree', () => {
    const completedChild = node('completed-child', 1, 1);
    const completedParent = node('completed-parent', 0, 0, [completedChild]);
    const next = node('next', 2, 0);

    expect(nextIncompleteNode(tree([completedParent, next]), 'completed-parent')?.id).toBe('next');
  });
});
