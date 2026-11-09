import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { registerApi } from '@/lib/api/endpoints';

export function RegisterSettingsPage({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [deactivating, setDeactivating] = useState<{ id: number; name: string; reason: string } | null>(null);
  const list = useQuery({ queryKey: ['registers'], queryFn: registerApi.list });
  const refresh = () => qc.invalidateQueries({ queryKey: ['registers'] });
  const create = useMutation({
    mutationFn: () => registerApi.create(name.trim()),
    onSuccess: async () => { setName(''); await refresh(); },
  });
  const update = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Pilih mesin kasir yang akan diubah.');
      return registerApi.update(editing.id, { name: editing.name.trim() });
    },
    onSuccess: async () => { setEditing(null); await refresh(); },
  });
  const toggle = useMutation({
    mutationFn: (input: { id: number; is_active: boolean }) =>
      registerApi.update(input.id, { is_active: input.is_active }),
    onSuccess: refresh,
  });
  const deactivate = useMutation({
    mutationFn: () => {
      if (!deactivating) throw new Error('Pilih mesin kasir yang akan dinonaktifkan.');
      return registerApi.deactivate(deactivating.id, deactivating.reason.trim());
    },
    onSuccess: async () => { setDeactivating(null); await refresh(); },
  });

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault();
    update.mutate();
  }

  function submitDeactivate(event: FormEvent) {
    event.preventDefault();
    deactivate.mutate();
  }

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4 p-6'}>
      {!embedded && <div>
        <h1 className="text-xl font-semibold">Mesin kasir</h1>
        <p className="mt-1 text-sm text-slate-600">Kelola mesin kasir dan laci kas toko.</p>
      </div>}
      <ErrorNotice error={list.error ?? create.error ?? update.error ?? toggle.error ?? deactivate.error} />
      <form className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-3" onSubmit={submitCreate}>
        <Field label="Nama mesin kasir">
          <input className={inputCls} required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Contoh: Kasir Depan" />
        </Field>
        <button type="submit" disabled={create.isPending || !name.trim()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
          {create.isPending ? 'Menyimpan…' : 'Tambah mesin kasir'}
        </button>
      </form>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Mesin kasir</th>
              <th className="px-3 py-2">Akun laci</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Shift berjalan</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.data?.map((register) => (
              <tr key={register.id}>
                <td className="px-3 py-2 font-medium">{register.name}</td>
                <td className="px-3 py-2">{register.fund_account_name ?? 'Akun kas belum tersedia'}</td>
                <td className="px-3 py-2">{register.is_active ? 'Aktif' : 'Nonaktif'}</td>
                <td className="px-3 py-2">{register.active_shift
                  ? <><span className="block">{register.active_shift.cashier_name} · {register.active_shift.status === 'counting' ? 'Sedang dihitung' : 'Berjalan'}</span>{register.active_shift.cashier_number && <span className="block text-xs text-slate-500">{register.active_shift.cashier_number}</span>}</>
                  : 'Tidak ada'}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-3">
                    <button type="button" className="text-blue-700 underline" onClick={() => setEditing({ id: register.id, name: register.name })}>Ubah</button>
                    {register.is_active ? (
                      <button type="button" className="text-red-700 underline" onClick={() => setDeactivating({ id: register.id, name: register.name, reason: '' })}>Nonaktifkan</button>
                    ) : (
                      <button type="button" disabled={toggle.isPending} className="text-blue-700 underline" onClick={() => toggle.mutate({ id: register.id, is_active: true })}>Aktifkan</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {list.isLoading && <tr><td className="px-3 py-5 text-center text-slate-500" colSpan={5}>Memuat mesin kasir…</td></tr>}
            {!list.isLoading && list.data?.length === 0 && <tr><td className="px-3 py-5 text-center text-slate-500" colSpan={5}>Belum ada mesin kasir.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Mesin kasir yang memiliki riwayat tidak dihapus permanen. Penonaktifan mempertahankan laporan dan saldo laci; mesin dengan shift berjalan harus ditutup dahulu.
      </p>

      {editing && (
        <Modal title={`Ubah ${editing.name}`} onClose={() => !update.isPending && setEditing(null)}>
          <form className="space-y-4 p-5" onSubmit={submitEdit}>
            <ErrorNotice error={update.error} />
            <Field label="Nama mesin kasir">
              <input className={inputCls} required maxLength={60} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" disabled={update.isPending} onClick={() => setEditing(null)}>Batal</button>
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60" disabled={update.isPending || !editing.name.trim()}>
                {update.isPending ? 'Menyimpan…' : 'Simpan'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deactivating && (
        <Modal title={`Nonaktifkan ${deactivating.name}?`} onClose={() => !deactivate.isPending && setDeactivating(null)}>
          <form className="space-y-4 p-5" onSubmit={submitDeactivate}>
            <ErrorNotice error={deactivate.error} />
            <p className="text-sm text-slate-600">Riwayat shift dan transaksi tetap tersimpan. Mesin ini tidak dapat dipilih untuk shift baru.</p>
            <Field label="Alasan penonaktifan">
              <input className={inputCls} required maxLength={255} value={deactivating.reason} onChange={(event) => setDeactivating({ ...deactivating, reason: event.target.value })} autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" disabled={deactivate.isPending} onClick={() => setDeactivating(null)}>Batal</button>
              <button type="submit" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-60" disabled={deactivate.isPending}>
                {deactivate.isPending ? 'Menonaktifkan…' : 'Nonaktifkan mesin'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
