import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cashDepositApi } from '@/lib/api/endpoints';
import type { DepositStatus, FundAccount } from '@/lib/api/types';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { ApiError } from '@/lib/api/client';
import {
  buildReceiveDepositInput, validateDepositReason, validateReceiveDeposit,
  type DepositErrors, type DepositReceiveValues,
} from './depositForm';

const STATUS_LABEL: Record<DepositStatus, string> = {
  draft: 'Draft — belum diserahkan',
  submitted: 'Diserahkan — menunggu Finance',
  received: 'Diterima Finance',
  discrepancy: 'Ada selisih — menunggu koreksi',
  corrected: 'Selisih dikoreksi',
};
const STATUS_OPTIONS: Array<{ value: DepositStatus | 'all'; label: string }> = [
  { value: 'submitted', label: 'Menunggu penerimaan' },
  { value: 'discrepancy', label: 'Menunggu koreksi selisih' },
  { value: 'received', label: 'Sudah diterima' },
  { value: 'corrected', label: 'Sudah dikoreksi' },
  { value: 'all', label: 'Semua status' },
];

export function DepositQueuePage() {
  const [status, setStatus] = useState<DepositStatus | 'all'>('submitted');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const deposits = useQuery({
    queryKey: ['cash-deposits', 'finance', status, page],
    queryFn: () => cashDepositApi.list({
      ...(status === 'all' ? {} : { status }),
      page,
      per_page: 25,
    }),
  });
  const funds = useQuery({
    queryKey: ['fund-accounts'],
    queryFn: cashDepositApi.funds,
  });

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold">Setoran Masuk</h1>
        <p className="mt-1 text-sm text-slate-600">Terima setoran dari Kasir, catat selisih, dan pantau saldo dana.</p>
      </div>

      <FundBalances funds={funds.data ?? []} loading={funds.isLoading} error={funds.error} />

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Antrean setoran</h2>
            <p className="mt-1 text-sm text-slate-600">Setoran masuk diproses setelah Kasir menyerahkan uang secara fisik.</p>
          </div>
          <Field label="Status">
            <select
              className={inputCls}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as DepositStatus | 'all');
                setPage(1);
              }}
            >
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        </div>

        <ErrorNotice error={deposits.error} />
        {deposits.isLoading ? (
          <p className="text-sm text-slate-500">Memuat antrean setoran…</p>
        ) : deposits.error && !deposits.data ? null : deposits.data?.data.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Tidak ada setoran pada status ini.</p>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {deposits.data?.data.map((deposit) => (
                <button
                  type="button"
                  key={deposit.id}
                  onClick={() => setSelectedId(deposit.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 py-4 text-left hover:bg-slate-50"
                >
                  <span>
                    <span className="block font-mono text-sm font-medium">{deposit.doc_number}</span>
                    <span className="mt-1 block text-xs text-slate-600">
                      {deposit.kind === 'partial' ? 'Parsial' : 'Akhir shift'} · Shift {deposit.shift_doc_number} · {deposit.created_by_name}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">{STATUS_LABEL[deposit.status]} · {formatDateTime(deposit.created_at)}</span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="block font-semibold tabular-nums">{formatRupiah(deposit.deposit_amount)}</span>
                    {deposit.received_amount !== null && (
                      <span className="block text-xs text-slate-600">Diterima {formatRupiah(deposit.received_amount)}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            {deposits.data && (
              <Pagination
                page={deposits.data.current_page}
                lastPage={deposits.data.last_page}
                from={deposits.data.from}
                to={deposits.data.to}
                total={deposits.data.total}
                onPage={setPage}
              />
            )}
          </>
        )}
      </section>

      {selectedId !== null && <DepositDetailDialog depositId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function FundBalances({ funds, loading, error }: { funds: FundAccount[]; loading: boolean; error: unknown }) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Saldo dana</h2>
      <ErrorNotice error={error} />
      {loading ? (
        <p className="text-sm text-slate-500">Memuat saldo dana…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {funds.map((fund) => (
            <div key={fund.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-600">{fund.name}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{formatRupiah(fund.balance)}</p>
              <p className="mt-1 text-xs text-slate-500">{fund.type === 'petty_cash' ? 'Kas Kecil' : 'Kas Besar'}</p>
            </div>
          ))}
          {!funds.length && !error && <p className="text-sm text-slate-500">Belum ada akun dana aktif.</p>}
        </div>
      )}
    </section>
  );
}

function DepositDetailDialog({ depositId, onClose }: { depositId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<DepositReceiveValues>({ amount: '', note: '' });
  const [errors, setErrors] = useState<DepositErrors>({});
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [confirming, setConfirming] = useState<'receive' | 'correct' | null>(null);

  const detail = useQuery({
    queryKey: ['cash-deposit', depositId],
    queryFn: () => cashDepositApi.get(depositId),
  });
  const invalidateFinance = () => {
    void qc.invalidateQueries({ queryKey: ['cash-deposits', 'finance'] });
    void qc.invalidateQueries({ queryKey: ['fund-accounts'] });
    void qc.invalidateQueries({ queryKey: ['cash-deposit', depositId] });
  };
  const receive = useMutation({
    mutationFn: () => cashDepositApi.receive(depositId, buildReceiveDepositInput(values)),
    onSuccess: () => { setConfirming(null); invalidateFinance(); },
    onError: () => setConfirming(null),
  });
  const correct = useMutation({
    mutationFn: () => cashDepositApi.correct(depositId, reason.trim()),
    onSuccess: () => { setConfirming(null); invalidateFinance(); },
    onError: () => setConfirming(null),
  });

  const deposit = detail.data;
  const receiveErrors = receive.error instanceof ApiError && receive.error.status === 422 ? receive.error.errors ?? {} : {};
  const correctErrors = correct.error instanceof ApiError && correct.error.status === 422 ? correct.error.errors ?? {} : {};

  function reviewReceive(event: FormEvent) {
    event.preventDefault();
    if (receive.isPending) return;
    receive.reset();
    const found = validateReceiveDeposit(values, deposit?.deposit_amount ?? '');
    setErrors(found);
    if (!Object.keys(found).length) setConfirming('receive');
  }

  function reviewCorrection(event: FormEvent) {
    event.preventDefault();
    if (correct.isPending) return;
    correct.reset();
    const found = validateDepositReason(reason);
    setReasonError(found);
    if (!found) setConfirming('correct');
  }

  const update = (key: keyof DepositReceiveValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    receive.reset();
  };

  return (
    <Modal title="Detail setoran" onClose={() => !receive.isPending && !correct.isPending && onClose()}>
      {detail.isLoading ? (
        <p className="p-5 text-sm text-slate-500">Memuat detail setoran…</p>
      ) : detail.error ? (
        <div className="space-y-3 p-5"><ErrorNotice error={detail.error} /></div>
      ) : deposit ? (
        <div className="space-y-4 p-5">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Detail label="Nomor" value={deposit.doc_number} />
            <Detail label="Jenis" value={deposit.kind === 'partial' ? 'Setoran parsial' : 'Setoran akhir shift'} />
            <Detail label="Shift" value={deposit.shift_doc_number} />
            <Detail label="Kasir" value={deposit.created_by_name} />
            <Detail label="Status" value={STATUS_LABEL[deposit.status]} />
            <Detail label="Dibuat" value={formatDateTime(deposit.created_at)} />
            <Detail label="Uang terhitung" value={formatRupiah(deposit.counted_amount)} />
            <Detail label="Setoran" value={formatRupiah(deposit.deposit_amount)} />
            <Detail label="Endapan" value={formatRupiah(deposit.float_kept)} />
            {deposit.received_amount !== null && <Detail label="Diterima Finance" value={formatRupiah(deposit.received_amount)} />}
            {deposit.difference !== null && <Detail label="Selisih (diterima − setoran)" value={formatRupiah(deposit.difference)} />}
            {deposit.received_by_name && <Detail label="Penerima" value={`${deposit.received_by_name} · ${formatDateTime(deposit.received_at)}`} />}
          </div>
          {deposit.note && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Catatan: {deposit.note}</p>}

          {deposit.status === 'submitted' && (
            <form onSubmit={reviewReceive} noValidate className="space-y-3 rounded-md bg-slate-50 p-4">
              <h3 className="font-medium">Catat uang yang diterima</h3>
              <ErrorNotice error={receive.error} />
              <Field label="Jumlah diterima (Rp)" error={errors.amount ?? receiveErrors.received_amount?.[0]}>
                <input className={`${inputCls} tabular-nums`} inputMode="decimal" value={values.amount} onChange={(event) => update('amount', event.target.value)} />
              </Field>
              <Field label="Catatan penerimaan / selisih" error={errors.note ?? receiveErrors.note?.[0]} hint="Wajib bila jumlah diterima berbeda; maksimal 500 karakter.">
                <textarea className={inputCls} rows={2} maxLength={500} value={values.note} onChange={(event) => update('note', event.target.value)} />
              </Field>
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Periksa penerimaan</button>
            </form>
          )}

          {deposit.status === 'discrepancy' && (
            <form onSubmit={reviewCorrection} noValidate className="space-y-3 rounded-md bg-amber-50 p-4">
              <h3 className="font-medium">Koreksi selisih</h3>
              <p className="text-sm text-amber-900">Koreksi menutup status selisih dan mencatat alasan; tidak mengubah ledger penerimaan.</p>
              <ErrorNotice error={correct.error} />
              <Field label="Alasan koreksi (wajib)" error={reasonError ?? correctErrors.reason?.[0]}>
                <textarea className={inputCls} rows={2} maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); setReasonError(undefined); correct.reset(); }} />
              </Field>
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Periksa koreksi</button>
            </form>
          )}

          {confirming === 'receive' && (
            <div className="space-y-3 rounded-md border border-slate-300 p-4">
              <p className="text-sm">
                Akan dicatat diterima <strong>{formatRupiah(values.amount.replace(',', '.'))}</strong> dari setoran {formatRupiah(deposit.deposit_amount)}.
              </p>
              <p className="text-xs text-slate-600">Kas Kecil dikurangi sebesar jumlah setoran, Kas Besar ditambah sebesar jumlah yang diterima. Perbedaan jumlah mewajibkan catatan dan menandai setoran berselisih.</p>
              <ErrorNotice error={receive.error} />
              <div className="flex justify-end gap-2">
                <button type="button" disabled={receive.isPending} onClick={() => setConfirming(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Periksa lagi</button>
                <button type="button" disabled={receive.isPending} onClick={() => receive.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{receive.isPending ? 'Mencatat…' : 'Konfirmasi penerimaan'}</button>
              </div>
            </div>
          )}

          {confirming === 'correct' && (
            <div className="space-y-3 rounded-md border border-amber-300 p-4">
              <p className="text-sm">Tutup status selisih pada dokumen ini dengan alasan: <strong>{reason.trim()}</strong></p>
              <p className="text-xs text-slate-600">Saldo Kas Kecil/Kas Besar tidak berubah oleh tindakan koreksi ini.</p>
              <ErrorNotice error={correct.error} />
              <div className="flex justify-end gap-2">
                <button type="button" disabled={correct.isPending} onClick={() => setConfirming(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Periksa lagi</button>
                <button type="button" disabled={correct.isPending} onClick={() => correct.mutate()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{correct.isPending ? 'Menyimpan…' : 'Konfirmasi koreksi'}</button>
              </div>
            </div>
          )}

          <ErrorNotice error={detail.error} />
        </div>
      ) : null}
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="font-medium">{value}</p></div>;
}
