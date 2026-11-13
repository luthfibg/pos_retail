import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { settingsApi } from '@/lib/api/endpoints';
import { SettingsTitle, pageClass } from './embedded';

const QUERY_KEY = ['settings', 'purchase-order-owner'];

export function PurchaseOrderOwnerSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: settingsApi.purchaseOrderOwner,
  });
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const mutation = useMutation({
    mutationFn: settingsApi.savePurchaseOrderOwner,
    onSuccess: (setting) => {
      queryClient.setQueryData(QUERY_KEY, setting);
    },
  });

  useEffect(() => {
    if (query.data) setSelectedOwnerId(query.data.owner ? String(query.data.owner.id) : '');
  }, [query.data]);

  if (query.isLoading || !query.data) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded>Nama Owner Purchase Order</SettingsTitle>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-sm text-slate-500">Memuat pengaturan…</p>}
      </div>
    );
  }

  return (
    <div className={pageClass(embedded, 'max-w-2xl')}>
      <SettingsTitle embedded>Nama Owner Purchase Order</SettingsTitle>
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <ErrorNotice error={mutation.error} />
        <div>
          <label htmlFor="purchase-order-owner" className="mb-1 block text-sm font-medium">Akun Owner</label>
          <select
            id="purchase-order-owner"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={selectedOwnerId}
            onChange={(event) => setSelectedOwnerId(event.target.value)}
            disabled={query.data.owners.length === 0 || mutation.isPending}
          >
            <option value="">Pilih akun Owner</option>
            {query.data.owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name} · {owner.username}
              </option>
            ))}
          </select>
        </div>
        {query.data.owners.length === 0 && (
          <p className="text-sm text-amber-800">Tidak ada akun aktif dengan izin persetujuan Permintaan Pembelian.</p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={mutation.isPending || selectedOwnerId === '' || selectedOwnerId === String(query.data.owner?.id ?? '')}
            onClick={() => mutation.mutate(Number(selectedOwnerId))}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
          {query.data.owner && <span className="text-sm text-slate-600">Owner aktif: {query.data.owner.name}</span>}
        </div>
      </section>
    </div>
  );
}
