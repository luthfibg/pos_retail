import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { opnameApi } from '@/lib/api/endpoints';
import type { OpnameItem, OpnameSessionSummary } from '@/lib/api/types';
import { formatDateTime, formatQty } from '@/lib/format';
import { formatDiff, shortMessage } from './opnameProcess';

const SESSION_PAGE_SIZE = 10;
const ITEM_PAGE_SIZE = 25;

function ReconciliationItems({ sessionId }: { sessionId: number }) {
  const [page, setPage] = useState(1);
  const items = useQuery({
    queryKey: ['opname', 'final-history-items', sessionId, page],
    queryFn: () => opnameApi.items(sessionId, {
      only_counted: true,
      only_changes: true,
      page,
      per_page: ITEM_PAGE_SIZE,
    }),
  });

  if (items.isPending) return <p className="py-4 text-sm text-slate-500">Memuat rincian perubahan…</p>;
  if (items.isError) return <p role="alert" className="py-4 text-sm text-red-700">{shortMessage(items.error, 'Gagal memuat rincian perubahan')}</p>;
  if (items.data.data.length === 0) {
    return <p className="py-4 text-sm text-slate-500">Tidak ada perubahan stok tercatat pada sesi ini.</p>;
  }

  return (
    <div className="mt-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="px-3 py-2 font-medium">Produk</th>
              <th className="px-3 py-2 font-medium">Tindakan</th>
              <th className="px-3 py-2 font-medium">Alasan</th>
              <th className="px-3 py-2 font-medium">Selisih barang bagus</th>
              <th className="px-3 py-2 font-medium">Selisih barang rusak</th>
              <th className="px-3 py-2 font-medium">Selisih total</th>
            </tr>
          </thead>
          <tbody>
            {items.data.data.map((item) => <ReconciliationRow key={item.id} item={item} />)}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-600">
        <span>{items.data.total} produk dengan perubahan stok</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
            className="min-h-9 rounded-md border border-slate-300 px-3 disabled:opacity-40"
          >
            Sebelumnya
          </button>
          <span>{items.data.current_page}/{items.data.last_page}</span>
          <button
            type="button"
            disabled={page >= items.data.last_page}
            onClick={() => setPage((current) => current + 1)}
            className="min-h-9 rounded-md border border-slate-300 px-3 disabled:opacity-40"
          >
            Berikutnya
          </button>
        </div>
      </div>
    </div>
  );
}

function ReconciliationRow({ item }: { item: OpnameItem }) {
  const goodDiff = item.reconciliation_diff_good_qty ?? item.diff_good_qty;
  const damagedDiff = item.reconciliation_diff_damaged_qty ?? item.diff_damaged_qty;
  const totalDiff = item.reconciliation_diff_qty ?? item.diff_qty;

  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-3 py-3">
        <div className="font-medium text-slate-900">{item.name}</div>
        <div className="mt-0.5 text-xs text-slate-500">
          {[item.sku ? `Kode: ${item.sku}` : null, item.barcode ? `Barcode: ${item.barcode}` : null].filter(Boolean).join(' · ') || '—'}
        </div>
      </td>
      <td className="px-3 py-3">
        {item.reconciliation_action === 'write_off'
          ? 'Pemutihan'
          : item.reconciliation_action === 'correction' ? 'Koreksi stok' : 'Selisih opname'}
      </td>
      <td className="whitespace-pre-wrap px-3 py-3">{item.reconciliation_reason || '—'}</td>
      <td className="px-3 py-3">{goodDiff == null ? '—' : formatDiff(Number(goodDiff))}</td>
      <td className="px-3 py-3">{damagedDiff == null ? '—' : formatDiff(Number(damagedDiff))}</td>
      <td className="px-3 py-3">{totalDiff == null ? '—' : formatDiff(Number(totalDiff))}</td>
    </tr>
  );
}

function SessionRow({
  session,
  expanded,
  onToggle,
}: {
  session: OpnameSessionSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-h-20 w-full flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="min-w-[180px]">
          <span className="block font-semibold text-slate-900">{session.number}</span>
          <span className="mt-1 block text-sm text-slate-500">{session.scope_summary}</span>
        </span>
        <span className="text-sm text-slate-600">
          Selesai {formatDateTime(session.posted_at ?? session.started_at)}
        </span>
        <span className="text-sm text-slate-600">
          {session.variance_products ?? 0} produk berselisih
          {' · '}Kurang {formatQty(session.short_qty)}
          {' · '}Lebih {formatQty(session.over_qty)}
        </span>
        <span className="text-sm font-medium text-slate-800">{expanded ? 'Tutup rincian' : 'Lihat rincian'}</span>
      </button>
      {expanded && (
        <div className="border-t border-slate-200 px-3 py-2 md:px-4">
          <ReconciliationItems sessionId={session.id} />
        </div>
      )}
    </li>
  );
}

export function OpnameFinalHistoryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const query = search.trim();
  const sessions = useQuery({
    queryKey: ['opname', 'final-history', query, page],
    queryFn: () => opnameApi.list({
      status: 'posted',
      q: query.length >= 2 ? query : undefined,
      sort: 'newest',
      page,
      per_page: SESSION_PAGE_SIZE,
    }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Riwayat Final Stok</h2>
          <p className="mt-1 text-sm text-slate-600">Daftar opname yang sudah disetujui beserta perubahan stok per produk.</p>
        </div>
        <label className="w-full max-w-sm text-sm font-medium text-slate-700">
          Cari nomor opname
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Masukkan nomor atau nama sesi"
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal"
          />
        </label>
      </div>

      {query.length === 1 && <p className="text-sm text-slate-500">Pencarian mulai dari dua karakter.</p>}
      {sessions.isPending && <p className="py-8 text-center text-sm text-slate-500">Memuat riwayat opname…</p>}
      {sessions.isError && <p role="alert" className="py-8 text-center text-sm text-red-700">{shortMessage(sessions.error, 'Gagal memuat riwayat opname')}</p>}
      {sessions.data && sessions.data.data.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
          Belum ada opname yang selesai disetujui.
        </p>
      )}
      {sessions.data && sessions.data.data.length > 0 && (
        <>
          <ul className="space-y-3">
            {sessions.data.data.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                expanded={expandedId === session.id}
                onToggle={() => setExpandedId((current) => current === session.id ? null : session.id)}
              />
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
            <span>{sessions.data.total} sesi opname</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
                className="min-h-9 rounded-md border border-slate-300 px-3 disabled:opacity-40"
              >
                Sebelumnya
              </button>
              <span>{sessions.data.current_page}/{sessions.data.last_page}</span>
              <button
                type="button"
                disabled={page >= sessions.data.last_page}
                onClick={() => setPage((current) => current + 1)}
                className="min-h-9 rounded-md border border-slate-300 px-3 disabled:opacity-40"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
