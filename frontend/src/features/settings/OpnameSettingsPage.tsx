import { useEffect, useState } from 'react';
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
  const [perProduct, setPerProduct] = useState('');
  const [perSession, setPerSession] = useState('');
  const [requireFirst, setRequireFirst] = useState(true);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderInterval, setReminderInterval] = useState('30');
  const [reminderBasis, setReminderBasis] = useState<'all' | 'any'>('all');
  const mutation = useMutation({
    mutationFn: (input: Partial<NonNullable<typeof query.data>>) => opnameSettingsApi.update(input),
    onSuccess: async (setting) => {
      queryClient.setQueryData(QUERY_KEY, setting);
      setPendingValue(null);
      setSaved(true);
      setPerProduct(String(setting.per_product_threshold ?? ''));
      setPerSession(String(setting.per_session_threshold ?? ''));
      setRequireFirst(setting.require_first_opname ?? true);
      setReminderEnabled(setting.reminder_enabled);
      setReminderInterval(String(setting.reminder_interval_days));
      setReminderBasis(setting.reminder_basis);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['opname', 'tree'] }),
        queryClient.invalidateQueries({ queryKey: ['opname', 'items'] }),
      ]);
    },
    onError: () => setPendingValue(null),
  });

  useEffect(() => {
    if (!query.data) return;
    setPerProduct(String(query.data.per_product_threshold ?? ''));
    setPerSession(String(query.data.per_session_threshold ?? ''));
    setRequireFirst(query.data.require_first_opname ?? true);
    setReminderEnabled(query.data.reminder_enabled);
    setReminderInterval(String(query.data.reminder_interval_days));
    setReminderBasis(query.data.reminder_basis);
  }, [query.data]);

  if (query.isLoading || !query.data) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded>Penghitungan stok</SettingsTitle>
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
        <SettingsTitle embedded>Penghitungan stok</SettingsTitle>
        <p className="text-sm text-slate-600">
          Pengaturan ini berlaku untuk semua penghitungan stok. Agar hasil hitung tidak dipengaruhi angka di sistem, sebaiknya sembunyikan jumlah stok.
        </p>
      </div>
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        {saved && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">Pengaturan tersimpan dan berlaku untuk semua penghitungan stok.</p>}
        {error && <ErrorNotice error={error} />}
        <div>
          <h3 className="font-semibold">Pengingat penghitungan stok</h3>
          <p className="mt-1 text-sm text-slate-600">Pengingat hanya berupa pemberitahuan di halaman penghitungan stok dan tidak menghentikan pekerjaan.</p>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={reminderEnabled} onChange={(event) => setReminderEnabled(event.target.checked)} className="h-5 w-5" />
          Pengingat penghitungan stok
        </label>
        <label className="block space-y-1 text-sm font-medium">
          <span>Tampilkan pengingat setiap … hari</span>
          <input inputMode="numeric" type="number" min={1} max={365} value={reminderInterval} onChange={(event) => setReminderInterval(event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" />
        </label>
        <label className="block space-y-1 text-sm font-medium">
          <span>Hitung dari</span>
          <select value={reminderBasis} onChange={(event) => setReminderBasis(event.target.value as 'all' | 'any')} className="min-h-11 w-full rounded-md border border-slate-300 px-3">
            <option value="all">Penghitungan seluruh stok toko</option>
            <option value="any">Setiap penghitungan stok</option>
          </select>
        </label>
        <button
          type="button"
          disabled={mutation.isPending || !Number.isInteger(Number(reminderInterval)) || Number(reminderInterval) < 1 || Number(reminderInterval) > 365}
          onClick={() => mutation.mutate({
            reminder_enabled: reminderEnabled,
            reminder_interval_days: Number(reminderInterval),
            reminder_basis: reminderBasis,
          })}
          className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white disabled:opacity-60"
        >
          {mutation.isPending ? 'Menyimpan…' : 'Simpan pengingat'}
        </button>
      </section>
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
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
            <span className="block font-medium">Tampilkan jumlah stok di sistem saat menghitung</span>
            <span className="mt-1 block text-sm text-slate-600">
              Jika aktif, petugas dapat melihat jumlah stok di sistem dan mengetahui apakah hitungannya cocok atau berbeda. Jika nonaktif, keduanya disembunyikan.
            </span>
          </span>
        </label>
        {pendingValue !== null && (
          <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p>
              {pendingValue
                ? 'Jumlah stok di sistem dan keterangan cocok atau berbeda akan terlihat saat penghitungan.'
                : 'Jumlah stok di sistem dan keterangan cocok atau berbeda akan disembunyikan saat penghitungan.'}
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
                onClick={() => mutation.mutate({ show_system_qty: pendingValue })}
                className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white disabled:opacity-60"
              >
                {mutation.isPending ? 'Menyimpan…' : 'Konfirmasi perubahan'}
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <div>
          <h3 className="font-semibold">Persetujuan hasil penghitungan stok</h3>
            <p className="mt-1 text-sm text-slate-600">Perbedaan jumlah yang besar, harga modal barang yang belum diisi, dan penghitungan stok pertama harus disetujui Admin atau Pemilik toko (Owner).</p>
        </div>
        {query.data.per_product_threshold !== undefined ? (
          <>
            <label className="block space-y-1 text-sm font-medium">
              <span>Batas perbedaan untuk satu barang (Rp)</span>
              <input inputMode="numeric" type="number" min={1} step={1} value={perProduct} onChange={(event) => setPerProduct(event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>Batas jumlah seluruh perbedaan dalam satu penghitungan (Rp)</span>
              <input inputMode="numeric" type="number" min={1} step={1} value={perSession} onChange={(event) => setPerSession(event.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 px-3" />
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input type="checkbox" checked={requireFirst} onChange={(event) => setRequireFirst(event.target.checked)} className="h-5 w-5" />
              Hasil penghitungan stok pertama harus disetujui Admin atau Pemilik toko (Owner)
            </label>
            <button
              type="button"
              disabled={mutation.isPending || !Number.isInteger(Number(perProduct)) || Number(perProduct) < 1 || !Number.isInteger(Number(perSession)) || Number(perSession) < 1}
              onClick={() => mutation.mutate({
                per_product_threshold: Number(perProduct),
                per_session_threshold: Number(perSession),
                require_first_opname: requireFirst,
              })}
              className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white disabled:opacity-60"
            >
              {mutation.isPending ? 'Menyimpan…' : 'Simpan batas'}
            </button>
          </>
        ) : (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">Batas nilai dan kewajiban persetujuan penghitungan pertama hanya dapat dilihat dan diubah oleh Admin pada toko sederhana atau Pemilik toko (Owner).</p>
        )}
      </section>
    </div>
  );
}
