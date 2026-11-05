import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { settingsApi } from '@/lib/api/endpoints';
import type { InventoryMenuSetting } from '@/lib/api/types';
import { SettingsTitle, pageClass } from './embedded';

const QUERY_KEY = ['settings', 'inventory-menus'];

export function InventoryMenuSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: settingsApi.inventoryMenus });
  const [values, setValues] = useState<InventoryMenuSetting | null>(null);

  useEffect(() => {
    if (query.data) setValues(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (setting: InventoryMenuSetting) => settingsApi.saveInventoryMenus(setting),
    onSuccess: (setting) => {
      queryClient.setQueryData(QUERY_KEY, setting);
      setValues(setting);
    },
  });

  if (!query.data || !values) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded>Menu Inventory</SettingsTitle>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-sm text-slate-500">Memuat pengaturan menu Inventory…</p>}
      </div>
    );
  }

  const changed = values.show_opening_balance !== query.data.show_opening_balance
    || values.show_stock_transfer !== query.data.show_stock_transfer;

  return (
    <div className={pageClass(embedded, 'max-w-2xl')}>
      <div>
        <SettingsTitle embedded>Menu Inventory</SettingsTitle>
        <p className="mt-1 text-sm text-slate-600">
          Kedua menu disembunyikan secara default. Aktifkan hanya fitur yang digunakan toko.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <ErrorNotice error={save.error} />
        {([
          ['show_opening_balance', 'Stok Eksisting Toko', 'Tampilkan menu untuk memasukkan jumlah stok yang sudah tersedia di toko.'],
          ['show_stock_transfer', 'Transfer Stok', 'Tampilkan menu untuk memindahkan stok antar lokasi.'],
        ] as const).map(([key, title, description]) => (
          <label key={key} className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={values[key]}
              onChange={(event) => setValues({ ...values, [key]: event.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">{title}</span>
              <span className="mt-0.5 block text-sm text-slate-600">{description}</span>
            </span>
          </label>
        ))}
        <button
          type="button"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate(values)}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {save.isPending ? 'Menyimpan…' : 'Simpan pengaturan'}
        </button>
      </section>
    </div>
  );
}
