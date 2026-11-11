import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, inputCls } from '@/components/ui/Field';
import { billingApi } from '@/lib/api/endpoints';
import { SettingsTitle, pageClass } from './embedded';

const QUERY_KEY = ['annual-receivable-report-setting'];

export function AnnualReceivableSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const setting = useQuery({ queryKey: QUERY_KEY, queryFn: billingApi.annualReportSetting });
  const [printOn, setPrintOn] = useState('12-31');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (setting.data) setPrintOn(setting.data.print_on);
  }, [setting.data]);

  const update = useMutation({
    mutationFn: () => billingApi.updateAnnualReportSetting(printOn),
    onSuccess: async (value) => {
      queryClient.setQueryData(QUERY_KEY, value);
      setPrintOn(value.print_on);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['annual-receivable-report-years'] });
    },
  });

  return (
    <div className={pageClass(embedded, 'max-w-xl')}>
      <SettingsTitle embedded>Tanggal cetak laporan tahunan</SettingsTitle>
      <ErrorNotice error={setting.error} />
      <ErrorNotice error={update.error} />
      {setting.isLoading ? <p className="text-sm text-slate-500">Memuat pengaturan…</p> : setting.data ? (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(false);
            update.mutate();
          }}
        >
          <Field label="Bulan dan tanggal">
            <input
              type="date"
              className={inputCls}
              required
              value={`2000-${printOn}`}
              onChange={(event) => setPrintOn(event.target.value.slice(5))}
            />
          </Field>
          <button
            type="submit"
            disabled={update.isPending || printOn === setting.data.print_on}
            className="min-h-10 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {update.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
          {saved && <span role="status" className="text-sm text-emerald-700">Tersimpan</span>}
        </form>
      ) : null}
    </div>
  );
}
