import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/client';
import { storeSettingsApi } from '@/lib/api/endpoints';
import { useAuth } from '@/features/auth/AuthProvider';
import { SettingsTitle, pageClass } from './embedded';

export function StoreNameSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { me, refreshMe } = useAuth();
  const storeName = me?.store?.name ?? '';
  const [name, setName] = useState(storeName);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setName(storeName);
  }, [storeName]);

  const update = useMutation({
    mutationFn: (nextName: string) => storeSettingsApi.updateName(nextName),
    onSuccess: async (updated) => {
      setName(updated.name);
      await refreshMe();
      setSuccess('Nama toko berhasil diperbarui.');
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    setSuccess(null);
    update.reset();
    if (!nextName || nextName.length > 150) return;
    if (nextName === storeName) return;
    update.mutate(nextName);
  }

  const apiError = update.error instanceof ApiError && update.error.status === 422
    ? update.error.firstError('name')
    : undefined;
  const localError = !name.trim()
    ? 'Nama toko wajib diisi.'
    : name.trim().length > 150
      ? 'Nama toko maksimal 150 karakter.'
      : undefined;
  const error = apiError ?? localError;
  const dirty = name.trim() !== storeName;

  return (
    <div className={pageClass(embedded, 'max-w-3xl')}>
      <div>
        <SettingsTitle embedded={embedded}>Nama toko</SettingsTitle>
        <p className="mt-1 text-sm text-slate-600">
          Ubah nama yang ditampilkan untuk toko ini. Kode, mata uang, zona waktu, dan data tenant lain tidak diubah.
        </p>
      </div>

      {success && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">{success}</p>}
      {update.error && !apiError && <ErrorNotice error={update.error} />}
      {!me?.store && <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Informasi toko aktif tidak tersedia.</p>}

      <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Nama toko" error={error} hint={`${name.length}/150 karakter`}>
          <input
            className={inputCls}
            value={name}
            maxLength={150}
            required
            disabled={!me?.store || update.isPending}
            onChange={(event) => {
              setName(event.target.value);
              setSuccess(null);
              update.reset();
            }}
            autoComplete="organization"
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">Perubahan tercatat di audit toko.</p>
          <button
            type="submit"
            disabled={!me?.store || !dirty || Boolean(error) || update.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {update.isPending ? 'Menyimpan…' : 'Simpan nama toko'}
          </button>
        </div>
      </form>
    </div>
  );
}
