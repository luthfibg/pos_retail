import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { OpeningBalanceResult } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { inputCls } from '@/components/ui/Field';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { ProductPicker } from '@/features/products/ProductPicker';
import {
  buildOpeningPayload, isBlank, mapServerErrors, newRow, validateOpening,
  type OpeningErrors, type OpeningRow,
} from './openingForm';

const INITIAL_ROWS = 5;
const initialRows = () => Array.from({ length: INITIAL_ROWS }, newRow);

export function OpeningBalancePage() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<OpeningRow[]>(initialRows);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<OpeningErrors>({ rows: {} });
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<OpeningBalanceResult | null>(null);
  // pemetaan indeks server -> layar untuk permintaan yang sedang/terakhir dikirim
  const [indexMap, setIndexMap] = useState<number[]>([]);

  const mutation = useMutation({
    mutationFn: inventoryApi.openingBalance,
    onSuccess: (data) => {
      setResult(data);
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => {
      setConfirming(false);
      if (err instanceof ApiError && err.status === 422) setErrors(mapServerErrors(err.errors, indexMap));
    },
  });

  const update = (key: number, patch: Partial<OpeningRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const filledCount = rows.filter((r) => !isBlank(r)).length;

  function review() {
    mutation.reset();
    const found = validateOpening(rows, note);
    setErrors(found);
    if (found.general || Object.keys(found.rows).length > 0) return;
    setConfirming(true);
  }

  function submit() {
    if (mutation.isPending) return; // cegah kirim ganda
    const built = buildOpeningPayload(rows, note);
    setIndexMap(built.indexMap);
    mutation.mutate(built.payload);
  }

  function reset() {
    setRows(initialRows());
    setNote('');
    setErrors({ rows: {} });
    setResult(null);
    mutation.reset();
  }

  if (result) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">Stok Awal</h1>
        <div className="max-w-xl space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm">
          <p className="font-medium text-emerald-900">Stok awal tersimpan.</p>
          <p>Nomor dokumen: <span className="font-mono font-medium">{result.document_no}</span></p>
          <p>{result.items.length} baris tercatat.</p>
          <button type="button" onClick={reset} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Input dokumen lain</button>
        </div>
      </div>
    );
  }

  const showTop = !(mutation.error instanceof ApiError && mutation.error.status === 422);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Stok Awal</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Catat saldo awal saat peralihan sistem. Satu dokumen berisi banyak baris dan disimpan sekaligus: bila satu baris ditolak, tidak ada yang tersimpan.
          Produk yang sudah punya pergerakan stok tidak bisa diisi di sini (gunakan adjustment).
        </p>
      </div>

      {showTop && <ErrorNotice error={mutation.error} />}
      {errors.general && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errors.general}</div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2">#</th>
              <th className="px-3 py-2">Produk</th>
              <th className="w-28 px-3 py-2">Qty</th>
              <th className="w-32 px-3 py-2">HPP / satuan</th>
              <th className="w-40 px-3 py-2">Kadaluarsa</th>
              <th className="w-28 px-3 py-2">Kode batch</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {rows.map((r, i) => {
              const e = errors.rows[i] ?? {};
              return (
                <tr key={r.key}>
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <ProductPicker value={r.product} onChange={(p) => update(r.key, { product: p })} />
                    {e.product_id && <p role="alert" className="mt-1 text-xs text-red-700">{e.product_id}</p>}
                    {r.product?.track_expiry && !r.expiry && (
                      <p className="mt-1 text-xs text-amber-700">Produk ini melacak kadaluarsa; tanpa tanggal, batch tidak dapat dipantau.</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={r.qty} onChange={(ev) => update(r.key, { qty: ev.target.value })} />
                    </div>
                    {r.product && <span className="text-xs text-slate-400">{r.product.unit_name}</span>}
                    {e.qty && <p role="alert" className="mt-1 text-xs text-red-700">{e.qty}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={r.unitCost} onChange={(ev) => update(r.key, { unitCost: ev.target.value })} />
                    {e.unit_cost && <p role="alert" className="mt-1 text-xs text-red-700">{e.unit_cost}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <input type="date" className={inputCls} value={r.expiry} onChange={(ev) => update(r.key, { expiry: ev.target.value })} />
                    {e.expiry_date && <p role="alert" className="mt-1 text-xs text-red-700">{e.expiry_date}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputCls} value={r.batchCode} maxLength={60} onChange={(ev) => update(r.key, { batchCode: ev.target.value })} />
                    {e.batch_code && <p role="alert" className="mt-1 text-xs text-red-700">{e.batch_code}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => remove(r.key)} aria-label={`Hapus baris ${i + 1}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, newRow()])}
          disabled={rows.length >= 200}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          Tambah baris
        </button>
        <span className="text-sm text-slate-500">{filledCount} baris terisi</span>
      </div>

      <label className="block max-w-xl text-sm">
        <span className="mb-1 block font-medium">Catatan dokumen (opsional)</span>
        <input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="mis. Stok awal cut-over" />
      </label>

      <div>
        <button type="button" onClick={review} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          Tinjau dan simpan
        </button>
      </div>

      {confirming && (
        <Modal title="Simpan stok awal?" onClose={() => !mutation.isPending && setConfirming(false)}>
          <div className="space-y-2 p-5 text-sm">
            <p>{filledCount} baris akan dicatat sebagai satu dokumen stok awal.</p>
            <p className="text-slate-600">Setelah tersimpan, koreksi dilakukan lewat adjustment, bukan mengubah dokumen ini.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={mutation.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Periksa lagi</button>
            <button type="button" disabled={mutation.isPending} onClick={submit} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
              {mutation.isPending ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
