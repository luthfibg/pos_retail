import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { userApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { ManagedRole, ManagedUser } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/features/auth/AuthProvider';
import { buildCreateUser, buildUpdateUser, emptyUserForm, validateUserForm, type UserFormErrors, type UserFormValues } from './userForm';

type UserStatus = 'active' | 'inactive' | '';

export function UsersPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [values, setValues] = useState({ q: '', status: '' as UserStatus, role: '' });
  const [filters, setFilters] = useState({ q: '', status: '' as UserStatus, role: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<UserFormValues>(emptyUserForm());
  const [formErrors, setFormErrors] = useState<UserFormErrors>({});
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['users', filters, page],
    queryFn: () => userApi.list({
      q: filters.q || undefined,
      status: filters.status || undefined,
      role: filters.role || undefined,
      page,
    }),
  });
  const roles = useQuery({ queryKey: ['user-roles'], queryFn: userApi.roles });
  const refreshUsers = () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
  };
  const create = useMutation({
    mutationFn: () => userApi.create(buildCreateUser(form)),
    onSuccess: () => {
      refreshUsers();
      setSelected(null);
      setEditing(false);
      setForm(emptyUserForm());
    },
  });
  const update = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Pengguna yang akan diubah belum dipilih.');
      return userApi.update(selected.id, buildUpdateUser(form, selected));
    },
    onSuccess: (user) => {
      refreshUsers();
      setSelected(user);
      setEditing(false);
    },
  });
  const setActive = useMutation({
    mutationFn: (user: ManagedUser) => userApi.update(user.id, { is_active: !user.is_active }),
    onSuccess: refreshUsers,
  });
  const reset = useMutation({
    mutationFn: () => {
      if (!resetTarget) throw new Error('Pengguna untuk reset sandi belum dipilih.');
      return userApi.resetPassword(resetTarget.id, resetPassword);
    },
    onSuccess: () => {
      refreshUsers();
      setResetTarget(null);
      setResetPassword('');
      setResetError(null);
    },
  });

  const isEditingSelf = selected?.id === me?.user.id;

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ ...values, q: values.q.trim() });
    setPage(1);
  }

  function openCreate() {
    setSelected(null);
    setEditing(false);
    setForm(emptyUserForm());
    setFormErrors({});
    create.reset();
    update.reset();
    setSelected({ id: -1, name: '', username: '', email: null, is_active: true, roles: [], last_login_at: null });
    setEditing(true);
  }

  function openEdit(user: ManagedUser) {
    setSelected(user);
    setForm({
      name: user.name,
      username: user.username,
      email: user.email ?? '',
      password: '',
      role: user.roles[0] ?? '',
    });
    setFormErrors({});
    create.reset();
    update.reset();
    setEditing(true);
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mode = selected?.id === -1 ? 'create' : 'edit';
    const errors = validateUserForm(form, mode);
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    if (mode === 'create') create.mutate();
    else if (Object.keys(buildUpdateUser(form, selected!)).length > 0) update.mutate();
    else setEditing(false);
  }

  function startReset(user: ManagedUser) {
    setResetTarget(user);
    setResetPassword('');
    setResetError(null);
    reset.reset();
  }

  const isCreate = selected?.id === -1;
  const busy = create.isPending || update.isPending;
  const mutationError = create.error ?? update.error;
  const validationErrors = mutationError instanceof ApiError && mutationError.status === 422 ? mutationError.errors ?? {} : {};

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Manajemen Pengguna</h1>
          <p className="mt-1 text-sm text-slate-600">Kelola akun, role, akses, dan status pengguna di toko ini.</p>
        </div>
        <button type="button" onClick={openCreate} disabled={roles.isLoading || Boolean(roles.error)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">Tambah pengguna</button>
      </header>

      <ErrorNotice error={roles.error} />
      <form onSubmit={applyFilters} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
        <Field label="Cari nama atau username">
          <input className={inputCls} value={values.q} onChange={(event) => setValues({ ...values, q: event.target.value })} placeholder="Cari pengguna" />
        </Field>
        <Field label="Role">
          <select className={inputCls} value={values.role} onChange={(event) => setValues({ ...values, role: event.target.value })}>
            <option value="">Semua role</option>
            {roles.data?.map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as UserStatus })}>
            <option value="">Semua status</option>
            <option value="active">Aktif</option>
            <option value="inactive">Nonaktif</option>
          </select>
        </Field>
        <div className="flex gap-2">
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">Terapkan</button>
          <button type="button" onClick={() => { setValues({ q: '', status: '', role: '' }); setFilters({ q: '', status: '', role: '' }); setPage(1); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Reset</button>
        </div>
      </form>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <ErrorNotice error={list.error} />
        {list.isLoading ? <p className="text-sm text-slate-500">Memuat daftar pengguna…</p> : list.error && !list.data ? null : list.data?.data.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="py-2 pr-3">Nama pengguna</th><th className="py-2 pr-3">Email</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Login terakhir</th><th className="py-2">Aksi</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {list.data.data.map((user) => (
                    <tr key={user.id}>
                      <td className="py-3 pr-3"><span className="block font-medium">{user.name}</span><span className="text-xs text-slate-500">{user.username}</span></td>
                      <td className="py-3 pr-3">{user.email ?? '—'}</td>
                      <td className="py-3 pr-3">{user.roles.join(', ') || '—'}</td>
                      <td className="py-3 pr-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${user.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{user.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
                      <td className="py-3 pr-3 whitespace-nowrap">{user.last_login_at ? formatDateTime(user.last_login_at) : 'Belum pernah'}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => openEdit(user)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Ubah</button>
                          <button type="button" onClick={() => startReset(user)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Reset sandi</button>
                          <button
                            type="button"
                            disabled={user.id === me?.user.id || setActive.isPending}
                            onClick={() => {
                              const action = user.is_active ? 'nonaktifkan' : 'aktifkan';
                              if (window.confirm(`Apakah Anda yakin ingin ${action} akun ${user.username}?`)) setActive.mutate(user);
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                          >{user.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.current_page} lastPage={list.data.last_page} from={list.data.from} to={list.data.to} total={list.data.total} onPage={setPage} />
          </>
        ) : <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Tidak ada pengguna yang cocok dengan filter.</p>}
        <ErrorNotice error={setActive.error} />
      </section>

      {editing && selected && (
        <UserFormDialog
          title={isCreate ? 'Tambah pengguna' : 'Ubah pengguna'}
          isCreate={isCreate}
          isSelf={Boolean(isEditingSelf)}
          values={form}
          errors={formErrors}
          roles={roles.data ?? []}
          serverErrors={validationErrors}
          mutationError={mutationError}
          busy={busy}
          onChange={setForm}
          onSubmit={submitForm}
          onClose={() => { if (!busy) setEditing(false); }}
        />
      )}
      {resetTarget && (
        <Modal title={`Reset sandi: ${resetTarget.username}`} onClose={() => { if (!reset.isPending) setResetTarget(null); }}>
          <form onSubmit={(event) => { event.preventDefault(); if (resetPassword.length < 8 || resetPassword.length > 255) { setResetError('Sandi harus 8–255 karakter.'); return; } setResetError(null); reset.mutate(); }} className="space-y-4 p-5">
            <p className="text-sm text-slate-600">Semua sesi aktif pengguna ini akan diakhiri setelah sandi direset.</p>
            <Field label="Sandi baru" error={resetError ?? (reset.error instanceof ApiError ? reset.error.firstError('password') : undefined)}>
              <input autoComplete="new-password" className={inputCls} type="password" maxLength={255} value={resetPassword} onChange={(event) => { setResetPassword(event.target.value); setResetError(null); }} />
            </Field>
            <ErrorNotice error={reset.error && !(reset.error instanceof ApiError && reset.error.status === 422) ? reset.error : null} />
            <div className="flex justify-end gap-2">
              <button type="button" disabled={reset.isPending} onClick={() => setResetTarget(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
              <button type="submit" disabled={reset.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{reset.isPending ? 'Mereset…' : 'Reset sandi'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function UserFormDialog({
  title, isCreate, isSelf, values, errors, roles, serverErrors, mutationError, busy, onChange, onSubmit, onClose,
}: {
  title: string;
  isCreate: boolean;
  isSelf: boolean;
  values: UserFormValues;
  errors: UserFormErrors;
  roles: ManagedRole[];
  serverErrors: Record<string, string[]>;
  mutationError: unknown;
  busy: boolean;
  onChange: (values: UserFormValues) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const errorFor = (field: keyof UserFormErrors) => errors[field] ?? serverErrors[field]?.[0];
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4 p-5">
        <ErrorNotice error={mutationError && !(mutationError instanceof ApiError && mutationError.status === 422) ? mutationError : null} />
        <Field label="Nama lengkap" error={errorFor('name')}>
          <input autoComplete="name" className={inputCls} maxLength={150} value={values.name} onChange={(event) => onChange({ ...values, name: event.target.value })} />
        </Field>
        <Field label="Username" error={errorFor('username')} hint={isCreate ? 'Huruf, angka, titik, garis bawah, dan strip; tidak dapat diubah setelah dibuat.' : 'Username tidak dapat diubah.'}>
          <input autoComplete="username" className={`${inputCls} ${!isCreate ? 'disabled:cursor-not-allowed' : ''}`} maxLength={60} disabled={!isCreate} value={values.username} onChange={(event) => onChange({ ...values, username: event.target.value })} />
        </Field>
        <Field label="Email (opsional)" error={errorFor('email')}>
          <input autoComplete="email" className={inputCls} type="email" maxLength={190} value={values.email} onChange={(event) => onChange({ ...values, email: event.target.value })} />
        </Field>
        {isCreate && (
          <Field label="Sandi awal" error={errorFor('password')}>
            <input autoComplete="new-password" className={inputCls} type="password" maxLength={255} value={values.password} onChange={(event) => onChange({ ...values, password: event.target.value })} />
          </Field>
        )}
        <Field label="Role" error={errorFor('role')} hint={isSelf ? 'Role akun sendiri tidak dapat diubah.' : 'Satu role per pengguna per toko.'}>
          <select className={inputCls} disabled={isSelf} value={values.role} onChange={(event) => onChange({ ...values, role: event.target.value })}>
            <option value="">Pilih role</option>
            {roles.map((role) => <option key={role.id} value={role.name}>{role.name}{role.description ? ` — ${role.description}` : ''}</option>)}
          </select>
        </Field>
        {serverErrors.role?.[0] && <p role="alert" className="text-xs text-red-700">{serverErrors.role[0]}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Batal</button>
          <button type="submit" disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Modal>
  );
}
