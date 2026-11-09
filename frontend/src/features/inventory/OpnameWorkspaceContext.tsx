import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { OpnameItem, OpnameProgressTree } from '@/lib/api/types';

interface OpnameWorkspaceValue {
  activeNodeId: string | null;
  setActiveNodeId: Dispatch<SetStateAction<string | null>>;
  tree: OpnameProgressTree;
  selectedItem: OpnameItem | null;
  setSelectedItem: Dispatch<SetStateAction<OpnameItem | null>>;
  highlightedItemId: number | null;
  setHighlightedItemId: Dispatch<SetStateAction<number | null>>;
  loadItem: (item: OpnameItem) => void;
  selectItem: (item: OpnameItem) => void;
  startNode: (nodeId: string) => void;
  workingNodeId: string | null;
}

const OpnameWorkspaceContext = createContext<OpnameWorkspaceValue | null>(null);

export function OpnameWorkspaceProvider({
  value,
  children,
}: {
  value: OpnameWorkspaceValue;
  children: ReactNode;
}) {
  return <OpnameWorkspaceContext.Provider value={value}>{children}</OpnameWorkspaceContext.Provider>;
}

export function useOpnameWorkspace(): OpnameWorkspaceValue {
  const context = useContext(OpnameWorkspaceContext);
  if (!context) throw new Error('useOpnameWorkspace harus digunakan di dalam OpnameWorkspaceProvider.');
  return context;
}
