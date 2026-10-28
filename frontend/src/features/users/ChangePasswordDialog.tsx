import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { userApi } from '@/lib/api/endpoints';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { validatePasswordChange } from './userForm';

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => userApi.changePassword({ current_password: currentPassword, password }),
    onSuccess: onClose,
  });
  const apiError = change.error instanceof ApiError && change.error.status === 422 ? change.error : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validatePasswordChange(currentPassword, password, confirmation);
    setFormError(error);
    if (error) return;
    change.mutate();
  }

  return (
    <Modal title="Ganti sandi" onClose={() => { if (!change.isPending) onClose(); }}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <ErrorNotice error={change.error && !apiError ? change.error : null} />
        <Field label="Sandi saat ini" error={formError === 'Masukkan sandi saat ini.' ? formError : apiError?.firstError('current_password')}>
          <input autoComplete="current-password" className={inputCls} type="password" maxLength={255} value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setFormError(null); }} />
        </Field>
        <Field label="Sandi baru" error={formError && formError !== 'Masukkan sandi saat ini.' ? formError : apiError?.firstError('password')}>
          <input autoComplete="new-password" className={inputCls} type="password" maxLength={255} value={password} onChange={(event) => { setPassword(event.target.value); setFormError(null); }} />
        </Field>
        <Field label="Ulangi sandi baru">
          <input autoComplete="new-password" className={inputCls} type="password" maxLength={255} value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setFormError(null); }} />
        </Field>
        <p className="text-xs text-slate-500">Sandi baru minimal 8 karakter. Sesi lain dari akun ini akan diakhiri; sesi ini tetap aktif.</p>
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button type="button" disabled={change.isPending} onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
          <button type="submit" disabled={change.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{change.isPending ? 'Menyimpan…' : 'Simpan sandi baru'}</button>
        </div>
      </form>
    </Modal>
  );
}
