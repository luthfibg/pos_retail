import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { authorizationKeyApi } from '@/lib/api/endpoints';
import type { ApprovalAuthMode, ApprovalAuthModeOption, AuthorizationKeyHolder, AuthorizationKeyType } from '@/lib/api/types';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/features/auth/AuthProvider';
import { SettingsTitle, pageClass } from './embedded';
import { normalizeAuthorizationKey, validateAuthorizationKey } from './authorizationKeyLogic';

const MODE_SUMMARY: Record<ApprovalAuthMode, string> = {
  password: 'Pemberi persetujuan mengetik username dan password akunnya.',
  key: 'Pemberi persetujuan mengetik username dan kunci otorisasinya; password tidak diminta.',
  password_and_key: 'Pemberi persetujuan mengetik username, password akun, dan kunci otorisasi.',
};

const KEY_TYPE_LABEL: Record<AuthorizationKeyType, string> = {
  code: 'Kode 6 karakter',
  passphrase: 'Kalimat rahasia',
};

const MODE_QUERY_KEY = ['settings', 'approval-auth'];
const HOLDERS_QUERY_KEY = ['authorization-keys'];
const OWN_QUERY_KEY = ['authorization-key', 'own'];

export function ApprovalAuthSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { me, can, refreshMe } = useAuth();
  const canManageMode = can('settings.manage');
  const canManageUsers = can('user.manage');
  const canManageOwnKey = me?.authorization_key?.eligible === true;
  const [modeTarget, setModeTarget] = useState<ApprovalAuthModeOption | null>(null);
  const [modePassword, setModePassword] = useState('');
  const [modeError, setModeError] = useState<unknown>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [ownType, setOwnType] = useState<AuthorizationKeyType>('code');
  const [ownKey, setOwnKey] = useState('');
  const [ownPassword, setOwnPassword] = useState('');
  const [generateCode, setGenerateCode] = useState(false);
  const [ownError, setOwnError] = useState<unknown>(null);
  const [ownBusy, setOwnBusy] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [removeOwnOpen, setRemoveOwnOpen] = useState(false);
  const [removeOwnPassword, setRemoveOwnPassword] = useState('');
  const [removeOwnError, setRemoveOwnError] = useState<unknown>(null);
  const [removeOwnBusy, setRemoveOwnBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AuthorizationKeyHolder | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeError, setRevokeError] = useState<unknown>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);

  const modeQuery = useQuery({
    queryKey: MODE_QUERY_KEY,
    queryFn: authorizationKeyApi.approvalAuth,
    enabled: canManageMode,
  });
  const ownQuery = useQuery({
    queryKey: OWN_QUERY_KEY,
    queryFn: authorizationKeyApi.own,
    enabled: canManageOwnKey,
  });
  const holdersQuery = useQuery({
    queryKey: HOLDERS_QUERY_KEY,
    queryFn: authorizationKeyApi.holders,
    enabled: canManageUsers,
  });

  const ownStatus = ownQuery.data;
  const ownApiError = ownError instanceof ApiError && ownError.status === 422 ? ownError : null;
  const ownPasswordError = ownApiError?.firstError('current_password');
  const ownKeyError = ownApiError?.firstError('key') ?? ownApiError?.firstError('type') ?? ownApiError?.firstError('generate');

  async function submitOwnKey(event: FormEvent) {
    event.preventDefault();
    if (ownBusy) return;
    setOwnError(null);
    setGeneratedKey(null);
    const keyError = generateCode ? undefined : validateAuthorizationKey(ownType, ownKey);
    if (keyError) {
      setOwnError(new ApiError(422, keyError, { key: [keyError] }));
      return;
    }

    setOwnBusy(true);
    try {
      const updated = await authorizationKeyApi.setOwn({
        current_password: ownPassword,
        type: ownType,
        ...(generateCode ? { generate: true as const } : { key: normalizeAuthorizationKey(ownType, ownKey) }),
      });
      queryClient.setQueryData(OWN_QUERY_KEY, updated);
      setGeneratedKey(updated.generated_key ?? null);
      setOwnKey('');
      setOwnPassword('');
      setGenerateCode(false);
      await refreshMe();
    } catch (error) {
      setOwnError(error);
    } finally {
      setOwnBusy(false);
      setOwnPassword('');
      setOwnKey('');
    }
  }

  async function removeOwnKey(event: FormEvent) {
    event.preventDefault();
    if (removeOwnBusy) return;
    setRemoveOwnBusy(true);
    setRemoveOwnError(null);
    try {
      const updated = await authorizationKeyApi.removeOwn(removeOwnPassword);
      queryClient.setQueryData(OWN_QUERY_KEY, updated);
      setGeneratedKey(null);
      setRemoveOwnOpen(false);
      await refreshMe();
    } catch (error) {
      setRemoveOwnError(error);
    } finally {
      setRemoveOwnBusy(false);
      setRemoveOwnPassword('');
    }
  }

  async function saveMode(event: FormEvent) {
    event.preventDefault();
    if (!modeTarget || modeBusy) return;
    setModeBusy(true);
    setModeError(null);
    try {
      const updated = await authorizationKeyApi.setApprovalAuth(modeTarget.mode, modePassword);
      queryClient.setQueryData(MODE_QUERY_KEY, updated);
      setModeTarget(null);
      setModePassword('');
      await refreshMe();
    } catch (error) {
      setModeError(error);
    } finally {
      setModeBusy(false);
      setModePassword('');
    }
  }

  async function revokeKey(event: FormEvent) {
    event.preventDefault();
    if (!revokeTarget || revokeBusy) return;
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      const updated = await authorizationKeyApi.revoke(revokeTarget.user_id, revokeReason.trim());
      queryClient.setQueryData(HOLDERS_QUERY_KEY, updated);
      queryClient.setQueryData(MODE_QUERY_KEY, (current: typeof modeQuery.data) =>
        current ? { ...current, holders: updated } : current,
      );
      setRevokeTarget(null);
      setRevokeReason('');
      void queryClient.invalidateQueries({ queryKey: MODE_QUERY_KEY });
    } catch (error) {
      setRevokeError(error);
    } finally {
      setRevokeBusy(false);
    }
  }

  function closeModeDialog() {
    if (modeBusy) return;
    setModeTarget(null);
    setModePassword('');
    setModeError(null);
  }

  function closeRevokeDialog() {
    if (revokeBusy) return;
    setRevokeTarget(null);
    setRevokeReason('');
    setRevokeError(null);
  }

  return (
    <div className={pageClass(embedded, 'max-w-5xl')}>
      <div>
        <SettingsTitle embedded={embedded}>Otorisasi persetujuan</SettingsTitle>
        <p className="mt-1 text-sm text-slate-600">
          Kunci bersifat pribadi untuk setiap pemegang izin persetujuan. Pengelola hanya dapat melihat status dan mencabut kunci, bukan melihat atau mengatur kunci milik orang lain.
        </p>
      </div>

      {canManageOwnKey && (
        <OwnKeySection
          status={ownStatus}
          loading={ownQuery.isLoading}
          error={ownQuery.error}
          type={ownType}
          keyValue={ownKey}
          password={ownPassword}
          generateCode={generateCode}
          busy={ownBusy}
          ownError={ownError}
          passwordError={ownPasswordError}
          keyError={ownKeyError}
          generatedKey={generatedKey}
          onType={setOwnType}
          onKey={setOwnKey}
          onPassword={setOwnPassword}
          onGenerate={(value) => { setGenerateCode(value); if (value) setOwnKey(''); }}
          onSubmit={submitOwnKey}
          onDismissGenerated={() => setGeneratedKey(null)}
          onRemove={() => { setRemoveOwnPassword(''); setRemoveOwnError(null); setRemoveOwnOpen(true); }}
        />
      )}

      {canManageMode && (
        <ModeSection
          setting={modeQuery.data}
          loading={modeQuery.isLoading}
          error={modeQuery.error}
          onSwitch={(option) => { setModePassword(''); setModeError(null); setModeTarget(option); }}
        />
      )}

      {canManageUsers && (
        <HoldersSection
          holders={holdersQuery.data}
          loading={holdersQuery.isLoading}
          error={holdersQuery.error}
          currentUserId={me?.user.id}
          onRevoke={(holder) => { setRevokeTarget(holder); setRevokeReason(''); setRevokeError(null); }}
        />
      )}

      {removeOwnOpen && (
        <Modal title="Hapus kunci otorisasi?" onClose={() => { if (!removeOwnBusy) setRemoveOwnOpen(false); }}>
          <form onSubmit={(event) => void removeOwnKey(event)} className="space-y-4 p-5">
            <p className="text-sm text-slate-700">Kunci pribadi Anda akan dihapus. Pada mode kunci, penghapusan ditolak jika Anda adalah pemegang kunci aktif terakhir.</p>
            <ErrorNotice error={removeOwnError} />
            <Field label="Password akun" error={removeOwnError instanceof ApiError ? removeOwnError.firstError('current_password') : undefined}>
              <input autoComplete="current-password" type="password" maxLength={200} required className={inputCls} value={removeOwnPassword} onChange={(event) => setRemoveOwnPassword(event.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={removeOwnBusy} onClick={() => setRemoveOwnOpen(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
              <button type="submit" disabled={removeOwnBusy} className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{removeOwnBusy ? 'Menghapus…' : 'Hapus kunci saya'}</button>
            </div>
          </form>
        </Modal>
      )}

      {modeTarget && (
        <Modal title={`Ganti mode ke “${modeTarget.label}”?`} onClose={closeModeDialog}>
          <form onSubmit={(event) => void saveMode(event)} className="space-y-4 p-5">
            <ErrorNotice error={modeError} />
            <p className="text-sm text-slate-700">{MODE_SUMMARY[modeTarget.mode]}</p>
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Mode baru berlaku untuk persetujuan berikutnya. Pastikan semua pemegang izin sudah memiliki kunci aktif sebelum memilih mode kunci.</p>
            <Field label="Password akun Anda" error={modeError instanceof ApiError ? modeError.firstError('current_password') : undefined}>
              <input autoComplete="current-password" type="password" maxLength={200} required className={inputCls} value={modePassword} onChange={(event) => setModePassword(event.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={modeBusy} onClick={closeModeDialog} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
              <button type="submit" disabled={modeBusy} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{modeBusy ? 'Menyimpan…' : 'Konfirmasi mode'}</button>
            </div>
          </form>
        </Modal>
      )}

      {revokeTarget && (
        <Modal title={`Cabut kunci ${revokeTarget.name}?`} onClose={closeRevokeDialog}>
          <form onSubmit={(event) => void revokeKey(event)} className="space-y-4 p-5">
            <p className="text-sm text-slate-700">Kunci akan langsung tidak berlaku. Pemilik harus mengatur kunci baru sendiri. Tindakan ini tercatat pada audit.</p>
            <ErrorNotice error={revokeError} />
            <Field label="Alasan pencabutan" error={revokeError instanceof ApiError ? revokeError.firstError('reason') ?? revokeError.firstError('key') ?? revokeError.firstError('user') : undefined} hint="Wajib, minimal 3 karakter.">
              <textarea required minLength={3} maxLength={500} rows={3} className={inputCls} value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={revokeBusy} onClick={closeRevokeDialog} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
              <button type="submit" disabled={revokeBusy || revokeReason.trim().length < 3} className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{revokeBusy ? 'Mencabut…' : 'Cabut kunci'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function OwnKeySection({
  status, loading, error, type, keyValue, password, generateCode, busy, ownError, passwordError, keyError,
  generatedKey, onType, onKey, onPassword, onGenerate, onSubmit, onDismissGenerated, onRemove,
}: {
  status: Awaited<ReturnType<typeof authorizationKeyApi.own>> | undefined;
  loading: boolean;
  error: unknown;
  type: AuthorizationKeyType;
  keyValue: string;
  password: string;
  generateCode: boolean;
  busy: boolean;
  ownError: unknown;
  passwordError: string | undefined;
  keyError: string | undefined;
  generatedKey: string | null;
  onType: (type: AuthorizationKeyType) => void;
  onKey: (value: string) => void;
  onPassword: (value: string) => void;
  onGenerate: (value: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onDismissGenerated: () => void;
  onRemove: () => void;
}) {
  const inputError = keyError ?? (ownError instanceof ApiError ? ownError.firstError('type') ?? ownError.firstError('generate') : undefined);

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 className="font-semibold">Kunci pribadi saya</h2>
        <p className="mt-1 text-sm text-slate-600">Hanya Anda yang dapat membuat, merotasi, atau menghapus kunci. Password akun diminta untuk setiap perubahan.</p>
      </div>
      <ErrorNotice error={error} />
      {loading ? <p className="text-sm text-slate-500">Memuat status kunci…</p> : status && (
        <>
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{status.has_key ? `Kunci ${KEY_TYPE_LABEL[status.type ?? 'code']} sudah diatur` : 'Kunci belum diatur'}</strong>
              {status.locked && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Terkunci</span>}
            </div>
            {status.locked && <p className="mt-1 text-red-800">Kunci terkunci setelah terlalu banyak percobaan salah. Atur ulang kunci dengan password akun untuk membuka kunci.</p>}
            {status.last_used_at && <p className="mt-1 text-xs text-slate-500">Terakhir digunakan: {formatDateTime(status.last_used_at)}</p>}
            {status.rotated_at && <p className="text-xs text-slate-500">Terakhir dirotasi: {formatDateTime(status.rotated_at)}</p>}
          </div>

          <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
            {!ownError || (ownError instanceof ApiError && ownError.status === 422) ? null : <ErrorNotice error={ownError} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Jenis kunci">
                <select className={inputCls} value={type} onChange={(event) => onType(event.target.value as AuthorizationKeyType)}>
                  <option value="code">Kode 6 karakter</option>
                  <option value="passphrase">Kalimat rahasia</option>
                </select>
              </Field>
              {type === 'code' && (
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" checked={generateCode} onChange={(event) => onGenerate(event.target.checked)} />
                  Buatkan kode secara otomatis
                </label>
              )}
            </div>
            {!generateCode && (
              <Field
                label={type === 'code' ? 'Kode otorisasi' : 'Kalimat rahasia'}
                error={inputError}
                hint={type === 'code' ? 'Tepat 6 huruf/angka; huruf kecil akan diubah menjadi kapital.' : 'Minimal 16 karakter dan 3 kata. Huruf besar/kecil dibedakan.'}
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={type === 'code' ? 6 : 100}
                  className={inputCls}
                  value={keyValue}
                  onChange={(event) => onKey(type === 'code' ? event.target.value.toUpperCase() : event.target.value)}
                />
              </Field>
            )}
            {generateCode && inputError && <p role="alert" className="text-xs text-red-700">{inputError}</p>}
            <Field label="Password akun" error={passwordError}>
              <input autoComplete="current-password" type="password" required maxLength={200} className={inputCls} value={password} onChange={(event) => onPassword(event.target.value)} />
            </Field>
            {ownError instanceof ApiError && ownError.status === 422 && !passwordError && !inputError && <ErrorNotice error={ownError} />}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy || !password || (!generateCode && !keyValue)} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                {busy ? 'Menyimpan…' : status.has_key ? 'Ganti / buka kunci' : 'Simpan kunci'}
              </button>
              {status.has_key && <button type="button" disabled={busy} onClick={onRemove} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-800 disabled:opacity-60">Hapus kunci saya</button>}
            </div>
          </form>
          {generatedKey && (
            <div role="alert" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-semibold">Simpan kode ini sekarang. Kode tidak akan ditampilkan lagi setelah pesan ini ditutup.</p>
              <input aria-label="Kode otorisasi yang dibuat" readOnly value={generatedKey} onFocus={(event) => event.currentTarget.select()} className="w-full rounded-md border border-amber-400 bg-white px-3 py-2 font-mono text-lg tracking-widest" />
              <button type="button" onClick={onDismissGenerated} className="text-sm underline">Saya sudah menyimpan kode</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ModeSection({
  setting, loading, error, onSwitch,
}: {
  setting: Awaited<ReturnType<typeof authorizationKeyApi.approvalAuth>> | undefined;
  loading: boolean;
  error: unknown;
  onSwitch: (option: ApprovalAuthModeOption) => void;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 className="font-semibold">Metode autentikasi persetujuan</h2>
        <p className="mt-1 text-sm text-slate-600">Berlaku untuk persetujuan PR/PO, adjustment stok loss/expired, dan pengecualian kredit.</p>
      </div>
      <ErrorNotice error={error} />
      {loading ? <p className="text-sm text-slate-500">Memuat mode…</p> : setting && (
        <div className="space-y-3">
          {setting.modes.map((option) => (
            <div key={option.mode} className="rounded-md border border-slate-200 p-3">
              <label className="flex items-start gap-2">
                <input type="radio" name="approval-auth-mode" className="mt-1" checked={setting.mode === option.mode} disabled={setting.mode === option.mode || !option.can_switch} onChange={() => onSwitch(option)} />
                <span>
                  <span className="block font-medium">{option.label}{setting.mode === option.mode ? ' · Aktif' : ''}</span>
                  <span className="mt-0.5 block text-sm text-slate-600">{MODE_SUMMARY[option.mode]}</span>
                </span>
              </label>
              {!option.can_switch && option.blockers.length > 0 && (
                <ul className="ml-6 mt-2 list-disc space-y-1 text-xs text-amber-800">
                  {option.blockers.map((blocker, index) => <li key={`${blocker.user_id ?? blocker.code}-${index}`}>{blocker.message}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HoldersSection({
  holders, loading, error, currentUserId, onRevoke,
}: {
  holders: AuthorizationKeyHolder[] | undefined;
  loading: boolean;
  error: unknown;
  currentUserId: number | undefined;
  onRevoke: (holder: AuthorizationKeyHolder) => void;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 className="font-semibold">Pemegang izin persetujuan</h2>
        <p className="mt-1 text-sm text-slate-600">Daftar ini menunjukkan status saja; kunci pribadi tidak dapat dilihat atau diubah oleh pengelola.</p>
      </div>
      <ErrorNotice error={error} />
      {loading ? <p className="text-sm text-slate-500">Memuat daftar pemegang…</p> : holders && holders.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-2">Pengguna</th><th className="px-3 py-2">Status kunci</th><th className="px-3 py-2">Jenis</th><th className="px-3 py-2">Terakhir digunakan</th><th className="px-3 py-2 text-right">Aksi</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {holders.map((holder) => (
                <tr key={holder.user_id}>
                  <td className="px-3 py-2">{holder.name}<span className="block text-xs text-slate-500">{holder.username}{holder.user_id === currentUserId ? ' · Anda' : ''}</span></td>
                  <td className="px-3 py-2">{holder.locked ? 'Terkunci' : holder.has_key ? 'Aktif' : 'Belum diatur'}</td>
                  <td className="px-3 py-2">{holder.type ? KEY_TYPE_LABEL[holder.type] : '—'}</td>
                  <td className="px-3 py-2">{formatDateTime(holder.last_used_at)}</td>
                  <td className="px-3 py-2 text-right">
                    {holder.has_key && holder.user_id !== currentUserId && (
                      <button type="button" onClick={() => onRevoke(holder)} className="text-red-700 underline">Cabut kunci</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !error ? <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Belum ada pemegang izin persetujuan.</p> : null}
    </section>
  );
}
