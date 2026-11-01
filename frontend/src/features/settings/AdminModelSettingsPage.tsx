import { SettingsTitle, pageClass } from './embedded';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError } from '@/lib/api/client';
import { settingsApi } from '@/lib/api/endpoints';
import type { AdminModelId, AdminModelOption, AdminModelSetting } from '@/lib/api/types';
import {
  MODEL_SUMMARY,
  MODEL_TITLE,
  buildChecklist,
  conversionLine,
  convertsCurrentUser,
  modelErrorMessages,
} from './adminModelLogic';

const QUERY_KEY = ['settings', 'admin-model'];

export function AdminModelSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { me, can, refreshMe } = useAuth();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: settingsApi.adminModel });
  const [target, setTarget] = useState<AdminModelOption | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (model: AdminModelId) => settingsApi.saveAdminModel(model),
    onSuccess: async (data) => {
      queryClient.setQueryData(QUERY_KEY, data);
      // Menu mengikuti permission dari /auth/me, jadi muat ulang sesi agar sidebar langsung berubah.
      await refreshMe();
      void queryClient.invalidateQueries({ queryKey: ['user-roles'] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      setTarget(null);
      setUnderstood(false);
      setNotice(`Model administrasi kini ${MODEL_TITLE[data.model]}. Menu setiap pengguna mengikuti perannya.`);
    },
  });

  function openConfirm(option: AdminModelOption) {
    mutation.reset();
    setNotice(null);
    setUnderstood(false);
    setTarget(option);
  }

  function closeConfirm() {
    if (mutation.isPending) return;
    setTarget(null);
  }

  if (query.isLoading || !query.data) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded={embedded}>Model Administrasi</SettingsTitle>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-slate-500">Memuat…</p>}
      </div>
    );
  }

  const setting = query.data;
  const current = setting.options.find((option) => option.current);
  const others = setting.options.filter((option) => !option.current);

  return (
    <div className={pageClass(embedded, 'max-w-4xl')}>
      <div>
        <SettingsTitle embedded={embedded}>Model Administrasi</SettingsTitle>
        <p className="mt-1 text-sm text-slate-600">
          Pilih cara toko membagi tugas. Hak akses tetap ditentukan oleh peran masing-masing akun; model ini menentukan peran mana yang tersedia.
        </p>
      </div>

      {notice && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Model aktif</h2>
            <p className="mt-1 text-lg font-semibold">{MODEL_TITLE[setting.model]}</p>
            <p className="mt-1 text-sm text-slate-600">{MODEL_SUMMARY[setting.model].text}</p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">Aktif</span>
        </div>
        <p className="text-sm text-slate-600">
          Peran tersedia: <strong>{setting.assignable_roles.join(', ')}</strong>. Pengendali toko: <strong>{setting.controlling_role}</strong>.
        </p>
        {current && <p className="text-xs text-slate-500">{current.label}</p>}
      </section>

      {others.map((option) => (
        <OptionCard key={option.model} option={option} setting={setting} onSwitch={() => openConfirm(option)} />
      ))}

      <RolesTable setting={setting} canManageUsers={can('user.manage')} />

      {target && (
        <Modal title={`Beralih ke model ${MODEL_TITLE[target.model]}?`} onClose={closeConfirm}>
          <div className="space-y-3 p-5 text-sm">
            <ModelErrors error={mutation.error} />
            <p>{MODEL_SUMMARY[target.model].text}</p>

            <div className="rounded-md bg-slate-50 p-3">
              <div className="font-medium">Perubahan peran</div>
              {target.conversions.length === 0 ? (
                <p className="mt-1 text-slate-600">Tidak ada akun yang dikonversi.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {target.conversions.map((conversion) => <li key={`${conversion.from}-${conversion.to}`}>{conversionLine(conversion)}</li>)}
                </ul>
              )}
            </div>

            <ul className="list-disc space-y-1 pl-5 text-slate-700">
              {target.model === 'standard' ? (
                <>
                  <li>Peran Admin tidak lagi tersedia. Semua pemegang Admin otomatis menjadi Owner.</li>
                  <li>Owner memegang persetujuan, kebijakan, dan pengawasan, bukan fungsi operasional harian.</li>
                </>
              ) : (
                <>
                  <li>Peran Owner diganti Admin, yang memegang semua izin.</li>
                  <li>Finance, Purchasing, dan Accounting tetap dapat dipakai sebagai delegasi.</li>
                </>
              )}
              <li>Perubahan berlaku seketika; menu dan akses setiap pengguna mengikuti perannya.</li>
              {convertsCurrentUser(target, me?.user.id) && (
                <li className="font-medium text-amber-800">Akun Anda ikut dikonversi, sehingga menu dan akses Anda sendiri akan berubah.</li>
              )}
            </ul>

            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
              <span>Saya mengerti dampak perubahan ini.</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={mutation.isPending} onClick={closeConfirm} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
            <button
              type="button"
              disabled={mutation.isPending || !understood}
              onClick={() => mutation.mutate(target.model)}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {mutation.isPending ? 'Menyimpan…' : 'Ya, beralih'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ModelErrors({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 422) {
    const messages = modelErrorMessages(error.errors);
    if (messages.length > 0) {
      return (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <ul className="list-disc space-y-1 pl-4">{messages.map((message) => <li key={message}>{message}</li>)}</ul>
        </div>
      );
    }
  }
  return <ErrorNotice error={error} />;
}

function OptionCard({ option, setting, onSwitch }: { option: AdminModelOption; setting: AdminModelSetting; onSwitch: () => void }) {
  const checklist = buildChecklist(setting, option);
  const summary = MODEL_SUMMARY[option.model];

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Beralih ke model {MODEL_TITLE[option.model]}</h2>
        <p className="mt-1 text-sm text-slate-600">{summary.text}</p>
        <p className="mt-1 text-xs text-slate-500">Peran: {summary.roles}</p>
      </div>

      <div>
        <h3 className="text-sm font-medium">Kesiapan akun</h3>
        <ul className="mt-2 space-y-1.5">
          {checklist.map((row) => (
            <li key={row.key} className="flex items-start gap-2 text-sm">
              <span aria-hidden className={row.ok ? 'text-emerald-700' : 'text-red-700'}>{row.ok ? '✓' : '✗'}</span>
              <span className="sr-only">{row.ok ? 'Siap' : 'Belum siap'}:</span>
              <span className="flex-1">
                {row.label} <span className="text-slate-500">({row.activeUsers} akun aktif)</span>
                {row.message && <span className="mt-0.5 block text-red-800">{row.message}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!option.can_switch}
          onClick={onSwitch}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Beralih ke {MODEL_TITLE[option.model]}
        </button>
        {!option.can_switch && option.blockers.length > 0 && (
          <span className="text-sm text-slate-600">Lengkapi akun yang belum ada di <Link to="/settings#users" className="font-medium text-blue-700 underline">Manajemen Pengguna</Link>, lalu muat ulang halaman ini.</span>
        )}
      </div>
    </section>
  );
}

function RolesTable({ setting, canManageUsers }: { setting: AdminModelSetting; canManageUsers: boolean }) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Akun per peran</h2>
        {canManageUsers && <Link to="/settings#users" className="text-sm font-medium text-blue-700 underline">Kelola pengguna</Link>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Peran</th>
              <th className="px-3 py-2">Keterangan</th>
              <th className="px-3 py-2">Pada model ini</th>
              <th className="px-3 py-2 text-right">Akun aktif / total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {setting.roles.map((role) => (
              <tr key={role.name} className={role.assignable ? undefined : 'text-slate-400'}>
                <td className="px-3 py-2 font-medium">{role.name}</td>
                <td className="px-3 py-2">{role.description ?? '—'}</td>
                <td className="px-3 py-2">{role.assignable ? 'Tersedia' : 'Tidak tersedia'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{role.active_users} / {role.total_users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Akun pada peran yang tidak tersedia tetap tercatat, tetapi tidak dapat diaktifkan ulang sebelum perannya diganti.</p>
    </section>
  );
}
