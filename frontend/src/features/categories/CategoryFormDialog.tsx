import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { categoryApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { Category } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { descendantIds, flattenTree } from './tree';

type Job =
  | { kind: 'create'; input: { name: string; parent_id?: number | null } }
  | { kind: 'update'; id: number; input: { name?: string; parent_id?: number | null; is_active?: boolean } };

interface Props {
  category?: Category;
  all: Category[];
  onClose: () => void;
}

export function CategoryFormDialog({ category, all, onClose }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState(category?.parent_id != null ? String(category.parent_id) : '');
  const [isActive, setIsActive] = useState(category?.is_active ?? true);
  const [nameError, setNameError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: (job: Job) =>
      job.kind === 'create' ? categoryApi.create(job.input) : categoryApi.update(job.id, job.input),
    onSuccess: () => {
      // kategori memengaruhi daftar produk (nama kategori) dan pilihan di form produk
      void qc.invalidateQueries({ queryKey: ['categories'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
  });

  // Pilihan induk: bukan dirinya/turunannya; yang nonaktif hanya jika sedang menjadi induknya.
  const blocked = category ? new Set([category.id, ...descendantIds(all, category.id)]) : new Set<number>();
  const parentOptions = flattenTree(all).filter(
    ({ category: c }) => !blocked.has(c.id) && (c.is_active || c.id === category?.parent_id),
  );

  const serverErrors = mutation.error instanceof ApiError && mutation.error.status === 422 ? mutation.error.errors ?? {} : {};
  const showTop = !(mutation.error instanceof ApiError && mutation.error.status === 422);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();

    const trimmed = name.trim();
    if (!trimmed) { setNameError('Nama kategori wajib diisi.'); return; }
    if (trimmed.length > 120) { setNameError('Maksimal 120 karakter.'); return; }
    setNameError(undefined);

    const newParent = parentId ? Number(parentId) : null;

    if (!category) {
      mutation.mutate({ kind: 'create', input: { name: trimmed, ...(newParent !== null ? { parent_id: newParent } : {}) } });
      return;
    }

    const input: { name?: string; parent_id?: number | null; is_active?: boolean } = {};
    if (trimmed !== category.name) input.name = trimmed;
    if (newParent !== category.parent_id) input.parent_id = newParent;
    if (isActive !== category.is_active) input.is_active = isActive;
    if (Object.keys(input).length === 0) { onClose(); return; }
    mutation.mutate({ kind: 'update', id: category.id, input });
  }

  return (
    <Modal title={category ? 'Ubah kategori' : 'Kategori baru'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <div className="space-y-4 p-5">
          {showTop && <ErrorNotice error={mutation.error} />}

          <Field label="Nama kategori" error={nameError ?? serverErrors.name?.[0]}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>

          <Field label="Induk kategori" error={serverErrors.parent_id?.[0]} hint="Kosongkan bila kategori utama.">
            <select className={inputCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Tanpa induk</option>
              {parentOptions.map(({ category: c, depth }) => (
                <option key={c.id} value={c.id}>{`${'— '.repeat(depth)}${c.name}`}</option>
              ))}
            </select>
          </Field>

          {category && (
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                Kategori aktif
              </label>
              {serverErrors.is_active?.[0] && (
                <p role="alert" className="mt-1 text-xs text-red-700">{serverErrors.is_active[0]}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">Kategori tidak dihapus; nonaktifkan agar tidak muncul di pilihan baru.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
          <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
