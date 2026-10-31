import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { ActiveBadge } from '@/components/ui/ActiveBadge';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Pagination } from '@/components/ui/Pagination';
import { useDebounce } from '@/hooks/useDebounce';
import { platformStoreApi } from '@/lib/api/endpoints';
import type { PlatformStore, PlatformStoreDetail, PlatformTenantInput } from '@/lib/api/types';

export function PlatformStoresPage() {
  const { me, logout } = useAuth();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [createdOwner, setCreatedOwner] = useState<{ storeName: string; username: string } | null>(null);
  const debouncedQ = useDebounce(q);

  const stores = useQuery({
    queryKey: ['platform-stores', { q: debouncedQ, status, page }],
    queryFn: () => platformStoreApi.list({ q: debouncedQ || undefined, status: status || undefined, page }),
    placeholderData: (previous) => previous,
  });
  const createStore = useMutation({
    mutationFn: platformStoreApi.create,
    onSuccess: (created) => {
      setCreateOpen(false);
      setCreatedOwner({ storeName: created.name, username: created.initial_owner.username });
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ['platform-stores'] });
    },
  });
  const setStoreStatus = useMutation({
    mutationFn: ({ store, active }: { store: PlatformStore; active: boolean }) =>
      platformStoreApi.setActive(store.id, active),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform-stores'] });
      void queryClient.invalidateQueries({ queryKey: ['platform-store'] });
    },
  });

  const rows = stores.data?.data ?? [];

  function changeStatus(next: '' | 'active' | 'inactive') {
    setStatus(next);
    setPage(1);
  }

  function confirmStatus(store: PlatformStore) {
    const active = !store.is_active;
    const action = active ? 'mengaktifkan' : 'menonaktifkan';
    if (!window.confirm(`Yakin ingin ${action} tenant "${store.name}"? Data tenant tidak dihapus.`)) return;
    setStoreStatus.mutate({ store, active });
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <div className="text-sm font-semibold">POS Retail · Management Retail</div>
          <div className="text-xs text-slate-500">Operator sistem · {me?.user.name}</div>
        </div>
        <button type="button" onClick={() => void logout()} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
          Keluar
        </button>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-5 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Tenant retail</h1>
            <p className="mt-1 text-sm text-slate-500">Kelola toko klien dan status aksesnya.</p>
          </div>
          <button
            type="button"
            onClick={() => { setCreatedOwner(null); setCreateOpen(true); }}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Tenant baru
          </button>
        </div>

        {createdOwner && (
          <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Tenant <strong>{createdOwner.storeName}</strong> berhasil dibuat. Akun Admin awal: <strong>{createdOwner.username}</strong>.
            Password yang Anda masukkan saat onboarding tidak disimpan di layar ini; bagikan dengan aman.
            <button type="button" className="ml-3 underline" onClick={() => setCreatedOwner(null)}>Tutup</button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="Cari kode atau nama tenant"
            value={q}
            onChange={(event) => { setQ(event.target.value); setPage(1); }}
          />
          <label className="flex items-center gap-2 text-sm">
            <span>Status</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2"
              value={status}
              onChange={(event) => changeStatus(event.target.value as '' | 'active' | 'inactive')}
            >
              <option value="">Semua</option>
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </label>
        </div>

        <ErrorNotice error={stores.error} />
        <ErrorNotice error={setStoreStatus.error} />

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Kode</th>
                <th className="px-3 py-2">Nama tenant</th>
                <th className="px-3 py-2">Zona waktu</th>
                <th className="px-3 py-2">Mata uang</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Operasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((store) => (
                <tr key={store.id} className={store.is_active ? '' : 'text-slate-500'}>
                  <td className="px-3 py-2 font-mono text-xs">{store.code}</td>
                  <td className="px-3 py-2 font-medium">{store.name}</td>
                  <td className="px-3 py-2">{store.timezone}</td>
                  <td className="px-3 py-2">{store.currency}</td>
                  <td className="px-3 py-2"><ActiveBadge active={store.is_active} /></td>
                  <td className="space-x-3 px-3 py-2 text-right">
                    <button type="button" onClick={() => setDetailId(store.id)} className="underline">Detail</button>
                    <button
                      type="button"
                      disabled={setStoreStatus.isPending}
                      onClick={() => confirmStatus(store)}
                      className="underline disabled:opacity-50"
                    >
                      {store.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </td>
                </tr>
              ))}
              {stores.isLoading && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Memuat tenant…</td></tr>}
              {!stores.isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Tidak ada tenant.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {stores.data && (
          <Pagination
            page={page}
            lastPage={stores.data.last_page}
            from={stores.data.from}
            to={stores.data.to}
            total={stores.data.total}
            onPage={setPage}
          />
        )}
      </main>

      {createOpen && (
        <TenantCreateDialog
          busy={createStore.isPending}
          error={createStore.error}
          onClose={() => setCreateOpen(false)}
          onSubmit={(input) => createStore.mutateAsync(input)}
        />
      )}
      {detailId !== null && <TenantDetailDialog storeId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function TenantCreateDialog({
  busy,
  error,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (input: PlatformTenantInput) => Promise<unknown>;
}) {
  const [values, setValues] = useState({
    code: '',
    name: '',
    timezone: 'Asia/Jakarta',
    currency: 'IDR',
    ownerName: '',
    ownerUsername: '',
    ownerEmail: '',
    ownerPassword: '',
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({
      code: values.code.trim(),
      name: values.name.trim(),
      timezone: values.timezone,
      currency: values.currency.toUpperCase(),
      owner: {
        name: values.ownerName.trim(),
        username: values.ownerUsername.trim(),
        ...(values.ownerEmail.trim() ? { email: values.ownerEmail.trim() } : {}),
        password: values.ownerPassword,
      },
    });
  }

  function update(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <form onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="tenant-create-title" className="my-auto w-full max-w-xl space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 id="tenant-create-title" className="text-lg font-semibold">Onboarding tenant</h2>
            <p className="text-sm text-slate-500">Tenant dibuat bersama akun Admin awal dan konfigurasi dasar.</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm underline">Tutup</button>
        </div>
        <ErrorNotice error={error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm"><span>Kode tenant</span><input required maxLength={20} value={values.code} onChange={(e) => update('code', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <label className="space-y-1 text-sm"><span>Nama toko</span><input required maxLength={150} value={values.name} onChange={(e) => update('name', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <label className="space-y-1 text-sm"><span>Zona waktu</span><input required value={values.timezone} onChange={(e) => update('timezone', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <label className="space-y-1 text-sm"><span>Mata uang</span><input required minLength={3} maxLength={3} value={values.currency} onChange={(e) => update('currency', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 uppercase" /></label>
        </div>

        <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium">Akun Admin awal</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm"><span>Nama</span><input required maxLength={150} value={values.ownerName} onChange={(e) => update('ownerName', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" /></label>
            <label className="space-y-1 text-sm"><span>Username</span><input required maxLength={60} autoComplete="off" value={values.ownerUsername} onChange={(e) => update('ownerUsername', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" /></label>
            <label className="space-y-1 text-sm"><span>Email (opsional)</span><input type="email" maxLength={190} value={values.ownerEmail} onChange={(e) => update('ownerEmail', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" /></label>
            <label className="space-y-1 text-sm"><span>Password awal (min. 12 karakter)</span><input type="password" required minLength={12} maxLength={255} autoComplete="new-password" value={values.ownerPassword} onChange={(e) => update('ownerPassword', e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          </div>
        </fieldset>

        <p className="text-xs text-slate-500">Password hanya dikirim saat onboarding dan tidak ditampilkan kembali oleh API.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
          <button type="submit" disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? 'Membuat…' : 'Buat tenant'}
          </button>
        </div>
      </form>
    </div>
  );
}

function TenantDetailDialog({ storeId, onClose }: { storeId: number; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['platform-store', storeId],
    queryFn: () => platformStoreApi.get(storeId),
  });
  const store = detail.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="tenant-detail-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 id="tenant-detail-title" className="text-lg font-semibold">Detail tenant</h2>
          <button type="button" onClick={onClose} className="text-sm underline">Tutup</button>
        </div>
        <ErrorNotice error={detail.error} />
        {detail.isLoading && <p className="text-sm text-slate-500">Memuat detail…</p>}
        {store && <TenantDetailContent store={store} />}
      </section>
    </div>
  );
}

function TenantDetailContent({ store }: { store: PlatformStoreDetail }) {
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <DetailValue label="Kode" value={store.code} />
        <DetailValue label="Nama" value={store.name} />
        <DetailValue label="Status" value={store.is_active ? 'Aktif' : 'Nonaktif'} />
        <DetailValue label="Zona waktu" value={store.timezone} />
        <DetailValue label="Mata uang" value={store.currency} />
        <DetailValue label="Jumlah pengguna" value={String(store.user_count)} />
      </dl>
      <div>
        <h3 className="mb-2 font-medium">Akun Admin toko</h3>
        {store.admin_users.length === 0 ? (
          <p className="text-slate-500">Belum ada akun Admin.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {store.admin_users.map((admin) => (
              <li key={admin.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>{admin.name}<span className="block text-xs text-slate-500">{admin.username}{admin.email ? ` · ${admin.email}` : ''}</span></span>
                <ActiveBadge active={admin.is_active} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className="font-medium">{value}</dd></div>;
}
