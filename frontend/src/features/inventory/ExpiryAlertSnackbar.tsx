import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { inventoryApi } from '@/lib/api/endpoints';

const REFRESH_MS = 5 * 60 * 1000;

export function ExpiryAlertSnackbar() {
  const [dismissed, setDismissed] = useState(false);
  const query = useQuery({
    queryKey: ['inventory', 'expiry-monitoring', 'alerts'],
    queryFn: () => inventoryApi.expiryMonitoring(),
    refetchInterval: REFRESH_MS,
    retry: false,
  });

  if (dismissed) return null;

  if (query.error) {
    return (
      <div className="sticky top-0 z-30 px-4 pt-3">
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-white p-3 shadow-md">
          <div className="min-w-0 flex-1"><ErrorNotice error={query.error} /></div>
          <button
            type="button"
            aria-label="Tutup pesan kesalahan pemantauan kedaluwarsa"
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
          >
            Tutup
          </button>
        </div>
      </div>
    );
  }

  const monitoring = query.data;
  const expired = monitoring?.alert_counts.expired ?? 0;
  const nearExpiry = monitoring?.alert_counts.near_expiry ?? 0;
  if (!monitoring || monitoring.alert_counts.total === 0) return null;

  const message = expired > 0 && nearExpiry > 0
    ? `${expired} batch kedaluwarsa dan ${nearExpiry} batch akan kedaluwarsa dalam ${monitoring.warning_days} hari.`
    : expired > 0
      ? `${expired} batch kedaluwarsa.`
      : `${nearExpiry} batch akan kedaluwarsa dalam ${monitoring.warning_days} hari.`;

  return (
    <div className="sticky top-0 z-30 px-4 pt-3">
      <div
        role={expired > 0 ? 'alert' : 'status'}
        className={`flex items-center gap-3 rounded-lg border p-3 shadow-md ${expired > 0 ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}
      >
        <p className="min-w-0 flex-1 text-sm font-medium">{message}</p>
        <button
          type="button"
          aria-label="Tutup pengingat kedaluwarsa"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded px-2 py-1 text-sm hover:bg-black/5"
        >
          Tutup
        </button>
      </div>
    </div>
  );
}
