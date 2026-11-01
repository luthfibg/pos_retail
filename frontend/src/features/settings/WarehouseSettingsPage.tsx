import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Modal } from '@/components/ui/Modal';
import { settingsApi } from '@/lib/api/endpoints';

export function WarehouseSettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['settings', 'warehouse'],
    queryFn: settingsApi.warehouse,
  });
  const [nextEnabled, setNextEnabled] = useState<boolean | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const mutation = useMutation({
    mutationFn: () => {
      if (nextEnabled === null) throw new Error('Status Gudang belum dipilih.');
      return settingsApi.saveWarehouse(nextEnabled);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'warehouse'], data);
      setNextEnabled(null);
      setSavedNotice(true);
    },
    onError: () => setNextEnabled(null),
  });

  if (query.isLoading || !query.data) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">Pengaturan Gudang</h1>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-slate-500">Memuat…</p>}
      </div>
    );
  }

  const { enabled, locations } = query.data;

  return (
    <div className="max-w-2xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Pengaturan Gudang</h1>
        <p className="mt-1 text-sm text-slate-600">
          Aktifkan gudang bila toko menyimpan stok di lokasi gudang terpisah dari area toko.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <ErrorNotice error={mutation.error} />
        {savedNotice && (
          <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
            Pengaturan Gudang tersimpan.
          </p>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">Status Gudang</h2>
            <p className="mt-1 text-sm text-slate-600">
              Saat aktif, Gudang tersedia untuk penerimaan barang dan transfer stok.
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
            {enabled ? 'Aktif' : 'Nonaktif'}
          </span>
        </div>

        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <div className="font-medium">Lokasi gudang</div>
          {locations.length === 0 ? (
            <p className="mt-1 text-amber-800">Lokasi Gudang belum dibuat untuk toko ini.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {locations.map((location) => (
                <li key={location.id} className="flex items-center justify-between gap-3">
                  <span>{location.name}</span>
                  <span className={location.is_active ? 'text-emerald-700' : 'text-slate-500'}>
                    {location.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-sm text-slate-600">
          Menonaktifkan gudang menghentikan penggunaan lokasi Gudang. Stok dan riwayat yang sudah ada tidak dihapus.
        </p>

        <button
          type="button"
          disabled={mutation.isPending || (enabled && locations.length === 0)}
          onClick={() => { setSavedNotice(false); setNextEnabled(!enabled); }}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${enabled ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-900 hover:bg-slate-800'}`}
        >
          {enabled ? 'Nonaktifkan Gudang' : 'Aktifkan Gudang'}
        </button>
      </section>

      {nextEnabled !== null && (
        <Modal
          title={nextEnabled ? 'Aktifkan Gudang?' : 'Nonaktifkan Gudang?'}
          onClose={() => { if (!mutation.isPending) setNextEnabled(null); }}
        >
          <div className="space-y-2 p-5 text-sm">
            <p>
              {nextEnabled
                ? 'Lokasi Gudang akan diaktifkan dan dapat dipilih untuk penerimaan barang serta transfer stok.'
                : 'Lokasi Gudang akan dinonaktifkan. Penerimaan dan transfer baru yang melibatkan Gudang tidak dapat dilakukan.'}
            </p>
            <p className="text-slate-600">Stok, transaksi, dan riwayat Gudang tidak dihapus.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => setNextEnabled(null)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {mutation.isPending ? 'Menyimpan…' : 'Ya, lanjutkan'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
