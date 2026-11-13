import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { settingsApi } from '@/lib/api/endpoints';
import { SettingsTitle, pageClass } from './embedded';

const QUERY_KEY = ['settings', 'purchase-order-supplier-selection'];

export function PurchaseOrderSupplierSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: settingsApi.purchaseOrderSupplierSelection,
  });
  const mutation = useMutation({
    mutationFn: settingsApi.savePurchaseOrderSupplierSelection,
    onSuccess: (setting) => {
      queryClient.setQueryData(QUERY_KEY, setting);
    },
  });

  if (query.isLoading || !query.data) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded={embedded}>Supplier Purchase Order</SettingsTitle>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-sm text-slate-500">Memuat pengaturan…</p>}
      </div>
    );
  }

  const automatic = query.data.mode === 'product';

  return (
    <div className={pageClass(embedded, 'max-w-2xl')}>
      <div>
        <SettingsTitle embedded={embedded}>Supplier Purchase Order</SettingsTitle>
        <p className="mt-1 text-sm text-slate-600">Pilih otomatis supplier yang terhubung di master produk.</p>
      </div>
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <ErrorNotice error={mutation.error} />
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-medium">Pemilihan supplier otomatis</h2>
            <p className="mt-1 text-sm text-slate-600">
              {automatic
                ? 'Supplier mengikuti data supplier pada produk. Jika tersedia beberapa, pilih supplier saat membuat PO.'
                : 'Supplier dipilih dari seluruh supplier aktif pada master data.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={automatic}
            aria-label="Pemilihan supplier otomatis dari master produk"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(automatic ? 'manual' : 'product')}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${automatic ? 'bg-blue-700' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${automatic ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {mutation.isPending && <p className="text-sm text-slate-500">Menyimpan…</p>}
      </section>
    </div>
  );
}
