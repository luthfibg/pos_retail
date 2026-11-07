import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { opnameSettingsApi } from '@/lib/api/endpoints';
import { SettingsTitle, pageClass } from './embedded';

const QUERY_KEY = ['opname', 'settings'];

export function OpnameSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: opnameSettingsApi.get });
  const mutation = useMutation({
    mutationFn: (show: boolean) => opnameSettingsApi.update(show),
    onSuccess: async (setting) => {
      queryClient.setQueryData(QUERY_KEY, setting);
      setPendingValue(null);
      setSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['opname', 'tree'] }),
        queryClient.invalidateQueries({ queryKey: ['opname', 'items'] }),
      ]);
    },
    onError: () => setPendingValue(null),
  });

  if (query.isLoading || !query.data) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded>Opname</SettingsTitle>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-sm text-slate-500">Memuat pengaturan opname…</p>}
      </div>
    );
  }

  const current = query.data.show_system_qty;
  const error = mutation.error;

  return (
    <div className={pageClass(embedded, 'max-w-2xl')}>
      <div>
        <SettingsTitle embedded>Opname</SettingsTitle>
        <p className="text-sm text-slate-600">
          Pengaturan ini berlaku langsung untuk seluruh sesi opname. Demi menjaga hitung buta, disarankan angka stok disembunyikan.
        </p>
      </div>
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        {saved && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">Pengaturan tersimpan dan berlaku untuk seluruh sesi.</p>}
        {error && <ErrorNotice error={error} />}
        <label className="flex min-h-12 items-start gap-3">
          <input
            type="checkbox"
            checked={current}
            disabled={mutation.isPending || pendingValue !== null}
            onChange={(event) => {
              setSaved(false);
              setPendingValue(event.target.checked);
              mutation.reset();
            }}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            <span className="block font-medium">Tampilkan angka stok saat opname</span>
            <span className="mt-1 block text-sm text-slate-600">
              Jika aktif, angka stok sistem dan status cocok/selisih terlihat selama menghitung. Jika nonaktif, keduanya disembunyikan.
            </span>
          </span>
        </label>
        {pendingValue !== null && (
          <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p>
              {pendingValue
                ? 'Angka stok sistem dan status cocok/selisih akan terlihat pada semua sesi opname.'
                : 'Angka stok sistem dan status cocok/selisih akan disembunyikan pada semua sesi opname.'}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => setPendingValue(null)}
                className="min-h-11 rounded-md border border-slate-300 px-4"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(pendingValue)}
                className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white disabled:opacity-60"
              >
                {mutation.isPending ? 'Menyimpan…' : 'Konfirmasi perubahan'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
