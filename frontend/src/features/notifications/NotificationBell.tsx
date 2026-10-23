import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '@/lib/api/endpoints';
import type { AppNotification } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { badgeText, notificationTarget } from './notificationLink';

const POLL_MS = 60_000; // belum ada push; polling ringan sesuai saran backend

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationApi.list({ unread: true, per_page: 10 }),
    refetchInterval: POLL_MS,
    // kegagalan polling tidak boleh mengganggu layar; cukup tidak menampilkan badge
    retry: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: (id: number) => notificationApi.read(id), onSettled: refresh });
  const markAll = useMutation({ mutationFn: notificationApi.readAll, onSettled: refresh });

  const unread = query.data?.unread_count ?? 0;
  const items = query.data?.data ?? [];

  function onPick(n: AppNotification) {
    markRead.mutate(n.id);
    setOpen(false);
    const target = notificationTarget(n);
    if (target) navigate(target);
  }

  return (
    <div className="no-print relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'}
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white">
            {badgeText(unread)}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div role="dialog" aria-label="Notifikasi" className="fixed left-3 top-14 z-40 w-80 rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <span className="text-sm font-semibold">Notifikasi</span>
              <button
                type="button"
                disabled={unread === 0 || markAll.isPending}
                onClick={() => markAll.mutate()}
                className="text-xs text-slate-600 underline disabled:no-underline disabled:opacity-40"
              >
                Tandai semua terbaca
              </button>
            </div>
            <ul className="max-h-80 divide-y divide-slate-100 overflow-auto">
              {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">Tidak ada notifikasi baru.</li>}
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => onPick(n)} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
                    <span className="block text-sm">{n.message}</span>
                    <span className="block text-xs text-slate-400">{formatDateTime(n.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {unread > items.length && (
              <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
                Menampilkan {items.length} dari {unread} yang belum dibaca.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
