import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { bankAccountApi } from '@/lib/api/endpoints';
import type { BankAccount } from '@/lib/api/types';
import { SettingsTitle, pageClass } from './embedded';

const QUERY_KEY = ['settings', 'bank-accounts'];
type AccountDraft = Pick<BankAccount, 'bank_name' | 'account_name' | 'account_number'>;
type AccountUpdate = Partial<AccountDraft & Pick<BankAccount, 'is_active'>>;

const EMPTY_ACCOUNT: AccountDraft = { bank_name: '', account_name: '', account_number: '' };

export function BankAccountsSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: bankAccountApi.listForSettings });
  const [drafts, setDrafts] = useState<Record<number, BankAccount>>({});
  const [createDraft, setCreateDraft] = useState<AccountDraft>(EMPTY_ACCOUNT);

  useEffect(() => {
    if (query.data) setDrafts(Object.fromEntries(query.data.map((account) => [account.id, account])));
  }, [query.data]);

  const saveResult = (account: BankAccount) => {
    queryClient.setQueryData<BankAccount[]>(QUERY_KEY, (accounts = []) => {
      const exists = accounts.some((item) => item.id === account.id);
      return exists ? accounts.map((item) => item.id === account.id ? account : item) : [...accounts, account];
    });
    setDrafts((current) => ({ ...current, [account.id]: account }));
  };
  const create = useMutation({
    mutationFn: bankAccountApi.create,
    onSuccess: (account) => {
      saveResult(account);
      setCreateDraft(EMPTY_ACCOUNT);
    },
  });
  const update = useMutation({
    mutationFn: ({ id, values }: { id: number; values: AccountUpdate }) => bankAccountApi.update(id, values),
    onSuccess: saveResult,
  });

  if (!query.data) {
    return (
      <div className={pageClass(embedded)}>
        <SettingsTitle embedded>Rekening bank</SettingsTitle>
        <ErrorNotice error={query.error} />
        {!query.error && <p className="text-sm text-slate-500">Memuat rekening bank…</p>}
      </div>
    );
  }

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    create.mutate(createDraft);
  }

  function saveAccount(event: FormEvent, account: BankAccount) {
    event.preventDefault();
    const { bank_name, account_name, account_number, is_active } = account;
    update.mutate({ id: account.id, values: { bank_name, account_name, account_number, is_active } });
  }

  return (
    <div className={pageClass(embedded, 'max-w-3xl')}>
      <div>
        <SettingsTitle embedded>Rekening bank</SettingsTitle>
        <p className="mt-1 text-sm text-slate-600">
          Data rekening hanya dicantumkan pada PO; sistem tidak mencatat saldo atau memeriksa kecukupan dana. Maksimal lima rekening, termasuk yang dinonaktifkan.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Rekening tersimpan</h2>
          <span className="text-sm text-slate-500">{query.data.length}/5</span>
        </div>
        <ErrorNotice error={update.error} />
        {query.data.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">Belum ada rekening bank.</p>
        ) : (
          <div className="space-y-3">
            {query.data.map((account) => {
              const draft = drafts[account.id] ?? account;
              return (
                <form key={account.id} onSubmit={(event) => saveAccount(event, draft)} className="space-y-3 rounded-md border border-slate-200 p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Nama bank">
                      <input className={inputCls} required maxLength={100} value={draft.bank_name} onChange={(event) => setDrafts({ ...drafts, [account.id]: { ...draft, bank_name: event.target.value } })} />
                    </Field>
                    <Field label="Nama pemilik rekening">
                      <input className={inputCls} required maxLength={150} value={draft.account_name} onChange={(event) => setDrafts({ ...drafts, [account.id]: { ...draft, account_name: event.target.value } })} />
                    </Field>
                    <Field label="Nomor rekening">
                      <input className={inputCls} required maxLength={60} value={draft.account_number} onChange={(event) => setDrafts({ ...drafts, [account.id]: { ...draft, account_number: event.target.value } })} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={draft.is_active} onChange={(event) => setDrafts({ ...drafts, [account.id]: { ...draft, is_active: event.target.checked } })} />
                      Aktif untuk dipilih pada PO
                    </label>
                    <button type="submit" disabled={update.isPending} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">
                      {update.isPending && update.variables?.id === account.id ? 'Menyimpan…' : 'Simpan rekening'}
                    </button>
                  </div>
                </form>
              );
            })}
          </div>
        )}
      </section>

      {query.data.length < 5 && (
        <form onSubmit={submitCreate} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Tambah rekening</h2>
          <ErrorNotice error={create.error} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nama bank">
              <input className={inputCls} required maxLength={100} value={createDraft.bank_name} onChange={(event) => setCreateDraft({ ...createDraft, bank_name: event.target.value })} />
            </Field>
            <Field label="Nama pemilik rekening">
              <input className={inputCls} required maxLength={150} value={createDraft.account_name} onChange={(event) => setCreateDraft({ ...createDraft, account_name: event.target.value })} />
            </Field>
            <Field label="Nomor rekening">
              <input className={inputCls} required maxLength={60} value={createDraft.account_number} onChange={(event) => setCreateDraft({ ...createDraft, account_number: event.target.value })} />
            </Field>
          </div>
          <button type="submit" disabled={create.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            {create.isPending ? 'Menambahkan…' : 'Tambah rekening'}
          </button>
        </form>
      )}
    </div>
  );
}
