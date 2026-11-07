import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { opnameApi } from '@/lib/api/endpoints';
import type { OpnameCategoryOption, OpnameSessionSummary } from '@/lib/api/types';

interface Props {
  onClose: () => void;
  onSuccess: (session: OpnameSessionSummary) => void;
}

function descendants(category: OpnameCategoryOption): number[] {
  return [category.id, ...category.children.flatMap(descendants)];
}

function activeProductCount(categories: OpnameCategoryOption[], selected: Set<number>, ancestorSelected = false): number {
  return categories.reduce((total, category) => {
    const isSelected = selected.has(category.id);
    if (isSelected && !ancestorSelected) return total + category.product_count;
    return total + activeProductCount(category.children, selected, ancestorSelected || isSelected);
  }, 0);
}

function filterTree(categories: OpnameCategoryOption[], term: string): OpnameCategoryOption[] {
  if (!term) return categories;
  return categories.flatMap((category) => {
    if (category.name.toLocaleLowerCase('id').includes(term)) return [category];
    const children = filterTree(category.children, term);
    return children.length
      ? [{ ...category, children }]
      : [];
  });
}

function lockedDescendant(category: OpnameCategoryOption): OpnameCategoryOption['locked_by'] {
  if (category.locked_by) return category.locked_by;
  for (const child of category.children) {
    const locked = lockedDescendant(child);
    if (locked) return locked;
  }
  return null;
}

export function StartOpnameForm({ onClose, onSuccess }: Props) {
  const [scopeType, setScopeType] = useState<'all' | 'categories'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [clientRequestId] = useState(() => window.crypto.randomUUID());
  const options = useQuery({
    queryKey: ['opname', 'scope-options'],
    queryFn: opnameApi.scopeOptions,
  });
  const start = useMutation({
    mutationFn: () => opnameApi.start({
      scope_type: scopeType,
      ...(scopeType === 'categories' ? { category_ids: [...selectedIds] } : {}),
      name: name.trim() || undefined,
      notes: notes.trim() || undefined,
      client_request_id: clientRequestId,
    }),
    onSuccess,
  });
  const categories = options.data?.data ?? [];
  const categoryIndex = useMemo(() => new Map(flattenCategories(categories).map((category) => [category.id, category])), [categories]);
  const visibleCategories = useMemo(() => filterTree(categories, search.trim().toLocaleLowerCase('id')), [categories, search]);
  const totalCount = scopeType === 'all'
    ? options.data?.total_products ?? 0
    : activeProductCount(categories, selectedIds);

  function toggleCategory(category: OpnameCategoryOption) {
    const ids = descendants(category);
    const locked = flattenCategories(categories).some((item) => ids.includes(item.id) && item.locked_by !== null);
    if (locked) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      const selecting = !ids.every((id) => current.has(id));
      ids.forEach((id) => selecting ? next.add(id) : next.delete(id));
      return next;
    });
  }

  function toggleExpanded(id: number) {
    setExpandedIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    start.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-slate-900/50 md:items-start md:p-4">
      <form
        onSubmit={submit}
        className="flex min-h-0 w-full flex-col bg-white md:my-8 md:max-h-[calc(100dvh-4rem)] md:max-w-3xl md:rounded-xl md:shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-opname-title"
      >
        <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4 md:px-6">
          <div>
            <h2 id="start-opname-title" className="text-lg font-semibold">Mulai Opname</h2>
            <p className="text-xs text-slate-600">Pilih cakupan produk yang akan dihitung.</p>
          </div>
          <button type="button" onClick={onClose} disabled={start.isPending} className="min-h-11 min-w-11 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-50" aria-label="Tutup">
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Cakupan opname</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={scopeType === 'all'}
                disabled={start.isPending}
                onClick={() => setScopeType('all')}
                className={`min-h-16 rounded-lg border px-4 text-left text-sm font-medium disabled:opacity-60 ${scopeType === 'all' ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900' : 'border-slate-300'}`}
              >
                Seluruh toko
              </button>
              <button
                type="button"
                aria-pressed={scopeType === 'categories'}
                disabled={start.isPending}
                onClick={() => setScopeType('categories')}
                className={`min-h-16 rounded-lg border px-4 text-left text-sm font-medium disabled:opacity-60 ${scopeType === 'categories' ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900' : 'border-slate-300'}`}
              >
                Pilih kategori
              </button>
            </div>
          </fieldset>

          {scopeType === 'categories' && (
            <section aria-label="Pilih kategori" className="space-y-3">
              <label className="block text-sm font-medium">
                Cari kategori
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  disabled={start.isPending}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm"
                  placeholder="Nama kategori"
                />
              </label>
              {options.isLoading && <div role="status" className="space-y-2">{[1, 2, 3].map((item) => <div key={item} className="h-11 animate-pulse rounded bg-slate-100" />)}</div>}
              {options.data && visibleCategories.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">Kategori tidak ditemukan.</p>}
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                {visibleCategories.map((category) => (
                  <CategoryRow
                    key={category.id}
                    category={category}
                    selectedIds={selectedIds}
                    expandedIds={expandedIds}
                    searchActive={search.trim() !== ''}
                    categoryIndex={categoryIndex}
                    disabled={start.isPending}
                    onToggle={toggleCategory}
                    onExpand={toggleExpanded}
                  />
                ))}
              </div>
            </section>
          )}

          {options.error && (
            <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <p>{options.error instanceof Error ? options.error.message : 'Kategori tidak dapat dimuat.'}</p>
              <button type="button" onClick={() => void options.refetch()} className="mt-2 min-h-11 underline">Coba lagi</button>
            </div>
          )}
          <p role="status" className="rounded-lg bg-slate-50 px-3 py-3 text-sm font-medium text-slate-800">
            {options.isLoading
              ? 'Memuat jumlah produk aktif…'
              : `Total ${new Intl.NumberFormat('id-ID').format(totalCount)} jenis produk akan dihitung.`}
            {scopeType === 'all' && !options.isLoading && <span className="mt-1 block text-xs font-normal text-slate-600">Termasuk semua produk aktif di toko.</span>}
          </p>

          <label className="block text-sm font-medium">
            Nama sesi <span className="font-normal text-slate-500">(opsional)</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
              disabled={start.isPending}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3"
              placeholder="Contoh: Opname Bulanan November"
            />
          </label>
          <label className="block text-sm font-medium">
            Catatan <span className="font-normal text-slate-500">(opsional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={5000}
              disabled={start.isPending}
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          {start.error && (
            <div role="alert" className="space-y-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <p>{start.error instanceof ApiError ? start.error.firstError('scope') : 'Sesi tidak dapat dibuat. Periksa koneksi lalu coba lagi.'}</p>
              {start.error instanceof ApiError && start.error.conflictingSessions?.map((conflict) => (
                <Link
                  key={conflict.id}
                  to={`/inventory/adjustments/opname/${conflict.id}`}
                  onClick={onClose}
                  className="block min-h-11 font-medium underline"
                >
                  Buka sesi {conflict.number}
                </Link>
              ))}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6">
          {start.isPending && <p role="status" className="mb-2 text-center text-sm text-slate-600">Membuat sesi dan menyiapkan daftar produk…</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={start.isPending} className="min-h-11 rounded-md border border-slate-300 px-5 text-sm font-medium disabled:opacity-50">
              Kembali
            </button>
            <button
              type="submit"
              disabled={start.isPending || options.isLoading || options.isError || (scopeType === 'categories' && selectedIds.size === 0)}
              className="min-h-11 rounded-md bg-slate-900 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {start.isPending ? 'Memulai…' : 'Mulai'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function flattenCategories(categories: OpnameCategoryOption[]): OpnameCategoryOption[] {
  return categories.flatMap((category) => [category, ...flattenCategories(category.children)]);
}

function CategoryRow({
  category,
  selectedIds,
  expandedIds,
  searchActive,
  categoryIndex,
  disabled,
  onToggle,
  onExpand,
}: {
  category: OpnameCategoryOption;
  selectedIds: Set<number>;
  expandedIds: Set<number>;
  searchActive: boolean;
  categoryIndex: Map<number, OpnameCategoryOption>;
  disabled: boolean;
  onToggle: (category: OpnameCategoryOption) => void;
  onExpand: (id: number) => void;
}) {
  const fullCategory = categoryIndex.get(category.id) ?? category;
  const ids = descendants(fullCategory);
  const checked = ids.every((id) => selectedIds.has(id));
  const locked = lockedDescendant(fullCategory);
  const canExpand = fullCategory.children.length > 0;
  const isExpanded = searchActive || expandedIds.has(category.id);

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="flex min-h-12 items-center gap-2 px-2">
        <button
          type="button"
          onClick={() => onExpand(category.id)}
          disabled={disabled || !canExpand}
          aria-label={canExpand ? `${isExpanded ? 'Tutup' : 'Buka'} subkategori ${category.name}` : undefined}
          className="min-h-11 min-w-9 rounded text-slate-500 disabled:invisible"
        >
          {isExpanded ? '▾' : '▸'}
        </button>
        <label className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm ${locked ? 'text-slate-400' : 'text-slate-800'}`}>
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled || locked !== null}
            onChange={() => onToggle(fullCategory)}
            className="h-4 w-4 shrink-0"
          />
          <span className="min-w-0 flex-1 break-words">{category.name} ({new Intl.NumberFormat('id-ID').format(category.product_count)})</span>
        </label>
        {locked && <span className="max-w-36 text-right text-xs text-amber-800">Dipakai {locked.number}</span>}
      </div>
      {canExpand && isExpanded && (
        <div className="ml-5 border-l border-slate-200 pl-1">
          {category.children.map((child) => (
            <CategoryRow
              key={child.id}
              category={child}
              selectedIds={selectedIds}
              expandedIds={expandedIds}
              searchActive={searchActive}
              categoryIndex={categoryIndex}
              disabled={disabled}
              onToggle={onToggle}
              onExpand={onExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}
