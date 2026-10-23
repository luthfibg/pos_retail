import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { categoryApi } from '@/lib/api/endpoints';
import type { Category } from '@/lib/api/types';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { ActiveBadge } from '@/components/ui/ActiveBadge';
import { CategoryFormDialog } from './CategoryFormDialog';
import { flattenTree } from './tree';

export function CategoriesPage() {
  const [showInactive, setShowInactive] = useState(true);
  const [dialog, setDialog] = useState<{ category?: Category } | null>(null);

  const query = useQuery({ queryKey: ['categories', 'all'], queryFn: () => categoryApi.list() });
  const all = useMemo(() => query.data ?? [], [query.data]);
  const rows = useMemo(
    () => flattenTree(showInactive ? all : all.filter((c) => c.is_active)),
    [all, showInactive],
  );

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kategori</h1>
        <button type="button" onClick={() => setDialog({})} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          Kategori baru
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Tampilkan yang nonaktif
      </label>

      <ErrorNotice error={query.error} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2 text-right">Produk</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ category: c, depth }) => (
              <tr key={c.id} className={c.is_active ? '' : 'text-slate-400'}>
                <td className="px-3 py-2" style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}>
                  {depth > 0 && <span className="mr-1 text-slate-300">└</span>}
                  {c.name}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.products_count}</td>
                <td className="px-3 py-2"><ActiveBadge active={c.is_active} /></td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => setDialog({ category: c })} className="text-sm text-slate-700 underline">Ubah</button>
                </td>
              </tr>
            ))}
            {query.isLoading && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">Memuat…</td></tr>}
            {!query.isLoading && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">Belum ada kategori.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {dialog && <CategoryFormDialog category={dialog.category} all={all} onClose={() => setDialog(null)} />}
    </div>
  );
}
