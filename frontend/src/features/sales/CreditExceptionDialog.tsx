import { useState, type FormEvent } from 'react';
import type { CreditExceptionInput } from '@/lib/api/types';
import { Modal } from '@/components/ui/Modal';
import { Field, inputCls } from '@/components/ui/Field';
import type { SaleErrors } from './cartLogic';

interface Props {
  /** Pesan server (memuat sisa batas dan total). */
  reason: string | undefined;
  errors: SaleErrors['fields'];
  busy: boolean;
  onSubmit: (ex: CreditExceptionInput) => void;
  onCancel: () => void;
}

/**
 * Pengecualian kredit melebihi batas. ADMIN mengetik username dan passwordnya sendiri di sini;
 * Kasir tidak pernah memegang kredensial itu. State hanya hidup selama dialog terbuka.
 */
export function CreditExceptionDialog({ reason, errors, busy, onSubmit, onCancel }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [local, setLocal] = useState<{ username?: string; password?: string; note?: string }>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const found: typeof local = {};
    if (!username.trim()) found.username = 'Username Admin wajib diisi.';
    if (!password) found.password = 'Password wajib diisi.';
    if (!note.trim()) found.note = 'Catatan pengecualian wajib diisi.';
    else if (note.trim().length > 255) found.note = 'Maksimal 255 karakter.';
    setLocal(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({ approver_username: username, approver_password: password, note });
  }

  return (
    <Modal title="Melebihi batas kredit" onClose={() => { if (!busy) onCancel(); }}>
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 p-5">
          {reason && <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{reason}</p>}
          <p className="text-sm text-slate-600">
            Tawarkan pembayaran tunai terlebih dahulu. Bila tetap kredit, <span className="font-medium">Admin</span> harus
            memasukkan username dan passwordnya sendiri. Transaksi diberi label “melebihi batas”.
          </p>
          <Field label="Username Admin" error={local.username ?? errors.approver_username}>
            <input className={inputCls} value={username} autoComplete="off" autoFocus onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Password Admin" error={local.password ?? errors.approver_password}>
            <input className={inputCls} type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Catatan pengecualian (wajib)" error={local.note ?? errors['credit_exception.note']} hint="mis. disetujui HRD, kebutuhan mendesak">
            <input className={inputCls} value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Kembali ke tunai</button>
          <button type="submit" disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            {busy ? 'Memproses…' : 'Setujui dan proses'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
