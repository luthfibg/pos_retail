import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError } from '@/lib/api/client';
import { settingsApi } from '@/lib/api/endpoints';
import { SettingsTitle, pageClass } from './embedded';
import {
  buildPayload,
  effectiveRoles,
  emptyRuleKeys,
  formatRoles,
  groupRules,
  pendingChanges,
  resetToDefault,
  rowTitle,
  sameRoles,
  toggleRole,
  validationMessages,
  type StockDraft,
} from './stockAuthorityLogic';

const QUERY_KEY = ['settings', 'stock-authority'];
const MODEL_LABEL = { simple: 'Simple', standard: 'Standar retail' } as const;

export function StockAuthoritySettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { refreshMe } = useAuth();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: settingsApi.stockAuthority });
  const [draft, setDraft] = useState<StockDraft>({});
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) => settingsApi.saveStockAuthority(payload),
    onSuccess: async (data) => {
      queryClient.setQueryData(QUERY_KEY, data);
      // Permission stok diturunkan dari matriks ini, jadi sesi dimuat ulang agar menu mengikuti.
      await refreshMe();
      setDraft({});
      setConfirming(false);
      setNotice('Kewenangan stok tersimpan. Menu dan akses pengguna kini mengikuti matriks ini.');
    },
    onError: () => setConfirming(false),
  });

  if (query.isLoading || !query.data) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded={embedded}>Kewenangan Stok</SettingsTitle>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-slate-500">Memuat…</p>}
      </div>
    );
  }

  const { rules, assignable_roles: roles, admin_model: model, warehouse_enabled: warehouseEnabled } = query.data;
  const changes = pendingChanges(rules, draft);
  const empty = emptyRuleKeys(rules, draft);
  const groups = groupRules(rules);
  const dirty = changes.length > 0;
  const canSave = dirty && empty.length === 0 && !mutation.isPending;
  const validation = mutation.error instanceof ApiError && mutation.error.status === 422 ? validationMessages(mutation.error.errors) : [];

  function change(next: StockDraft) {
    mutation.reset();
    setNotice(null);
    setDraft(next);
  }

  return (
    <div className={pageClass(embedded, 'max-w-4xl')}>
      <div>
        <SettingsTitle embedded={embedded}>Kewenangan Stok</SettingsTitle>
        <p className="text-sm text-slate-600">
          Tentukan role mana yang boleh melakukan setiap operasi stok. Berlaku untuk model <strong>{MODEL_LABEL[model]}</strong>
          {warehouseEnabled ? '.' : '; aturan Gudang baru berlaku setelah Gudang diaktifkan.'} Pengecualian per pengguna tetap berlaku di atas matriks ini.
        </p>
      </div>

      {notice && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {validation.length > 0 ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <ul className="list-disc space-y-1 pl-4">{validation.map((message) => <li key={message}>{message}</li>)}</ul>
        </div>
      ) : (
        <ErrorNotice error={mutation.error} />
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">Operasi</th>
              {roles.map((role) => <th key={role} scope="col" className="px-3 py-2 text-center">{role}</th>)}
              <th scope="col" className="px-3 py-2"><span className="sr-only">Aksi</span></th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.action} className="divide-y divide-slate-100 border-t border-slate-200">
              <tr>
                <th colSpan={roles.length + 2} scope="colgroup" className="bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">{group.title}</th>
              </tr>
              {group.rules.map((rule) => {
                const selected = effectiveRoles(rule, draft);
                const isEmpty = selected.length === 0;
                const modified = draft[rule.key] !== undefined;
                return (
                  <tr key={rule.key} className={isEmpty ? 'bg-red-50' : modified ? 'bg-amber-50' : undefined}>
                    <th scope="row" className="px-4 py-3 align-top font-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{rowTitle(rule)}</span>
                        {!rule.applies && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Belum berlaku</span>}
                        {rule.customized && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Disesuaikan</span>}
                      </div>
                      <p className="mt-0.5 max-w-sm text-xs text-slate-500">{rule.description}</p>
                      {isEmpty && <p className="mt-1 text-xs font-medium text-red-700">Pilih minimal satu role.</p>}
                      {!modified && rule.warnings.map((warning) => <p key={warning.code} className="mt-1 text-xs text-red-700">{warning.message}</p>)}
                    </th>
                    {roles.map((role) => (
                      <td key={role} className="px-3 py-3 text-center align-top">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          aria-label={`${group.title}, ${rowTitle(rule)}: ${role}`}
                          checked={selected.includes(role)}
                          onChange={() => change(toggleRole(rule, draft, role, roles))}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right align-top">
                      {!sameRoles(selected, rule.default_roles) && (
                        <button type="button" onClick={() => change(resetToDefault(rule, draft))} className="text-xs font-medium text-blue-700 hover:underline">Default</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!canSave} onClick={() => setConfirming(true)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Simpan kewenangan</button>
        <button type="button" disabled={!dirty || mutation.isPending} onClick={() => change({})} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">Batalkan perubahan</button>
        <span className="text-sm text-slate-600">{dirty ? `${changes.length} aturan diubah` : 'Belum ada perubahan'}</span>
      </div>

      {confirming && (
        <Modal title="Simpan perubahan kewenangan stok?" onClose={() => { if (!mutation.isPending) setConfirming(false); }}>
          <div className="space-y-3 p-5 text-sm">
            <ul className="space-y-2">
              {changes.map((item) => (
                <li key={item.rule.key} className="rounded-md bg-slate-50 p-3">
                  <div className="font-medium">{item.rule.label}</div>
                  <div className="mt-1 text-slate-600">{formatRoles(item.from)} → <strong className="text-slate-900">{formatRoles(item.to)}</strong>{item.toDefault && ' (default)'}</div>
                </li>
              ))}
            </ul>
            <p className="text-slate-700">Perubahan berlaku seketika dan dicatat di audit. Pengguna yang kehilangan wewenang tidak lagi melihat menu atau tombol terkait.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" disabled={mutation.isPending} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Batal</button>
            <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(buildPayload(changes))} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{mutation.isPending ? 'Menyimpan…' : 'Ya, simpan'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
