import type { ReactNode } from 'react';

export function FullPageMessage({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center text-slate-500">{children}</div>;
}
