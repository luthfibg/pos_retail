import type { OpnameProgressNode, OpnameProgressTree } from '@/lib/api/types';

export function findNode(nodes: OpnameProgressNode[], id: string | null): OpnameProgressNode | null {
  if (id === null) return null;
  for (const node of nodes) {
    if (String(node.id) === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
}

function firstIncompleteDirectNode(node: OpnameProgressNode): OpnameProgressNode | null {
  if (node.direct_counted_count < node.direct_product_count) return node;
  for (const child of node.children) {
    const candidate = firstIncompleteDirectNode(child);
    if (candidate) return candidate;
  }
  return null;
}

export function resolveWorkingNode(tree: OpnameProgressTree, activeNodeId: string | null): OpnameProgressNode | null {
  const activeNode = findNode(tree.nodes, activeNodeId);
  return activeNode ? firstIncompleteDirectNode(activeNode) : null;
}

function flatten(nodes: OpnameProgressNode[]): OpnameProgressNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

export function nextIncompleteNode(tree: OpnameProgressTree, currentNodeId: string | null): OpnameProgressNode | null {
  const nodes = flatten(tree.nodes);
  const currentIndex = nodes.findIndex((node) => String(node.id) === currentNodeId);
  return nodes.slice(currentIndex + 1).find((node) => node.direct_counted_count < node.direct_product_count) ?? null;
}
