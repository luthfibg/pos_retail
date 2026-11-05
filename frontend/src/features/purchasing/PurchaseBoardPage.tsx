import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { inputCls } from '@/components/ui/Field';
import { useAuth } from '@/features/auth/AuthProvider';
import { purchaseOrderApi, purchaseRequisitionApi, supplierApi } from '@/lib/api/endpoints';
import type { PurchaseOrder, PurchaseOrderSummary, PurchaseRequisition, PurchaseRequisitionSummary } from '@/lib/api/types';
import { formatDate, formatDateTime, formatRupiah } from '@/lib/format';
import { ORDER_STATUS_LABEL, PurchaseOrderCreateDialog, PurchaseOrderManageDialog } from './PurchaseOrderDialogs';
import { PurchasePrintSheet, type PrintJob } from './PurchasePrint';
import { PurchaseFundBalance } from './PurchaseFundBalance';
import {
  PurchaseRequisitionDetailDialog,
  PurchaseRequisitionForm,
  PurchaseRequisitionsPage,
  STATUS_LABEL,
} from './PurchaseRequisitionsPage';
import {
  FLOW_STAGES,
  buildBoard,
  isPoPrintable,
  isPrPrintable,
  matchesPo,
  matchesPr,
  poNextAction,
  poStage,
  prStage,
  tabCount,
  tabLabel,
  type FlowStage,
  type FlowTab,
} from './purchaseFlow';

const RECEIPT_LABEL = { none: 'Belum diterima', partial: 'Sebagian', complete: 'Lengkap' } as const;

type Watch = { kind: 'pr' | 'po'; id: number; stage: FlowTab };
type Notice = { doc: string; statusText: string; tab: FlowTab; kind: 'pr' | 'po'; id: number };

/** Kasir (hanya membuat Permintaan) tetap memakai daftar sendiri; peran pengelola memakai papan tahap. */
export function PurchasingEntryPage() {
  const { can } = useAuth();
  const manages = can('purchase_requisition.finance_check')
    || can('purchase_requisition.approve')
    || can('purchase_order.create')
    || can('purchase_order.send')
    || can('purchase_fund.view')
    || can('purchase_fund.allocate');
  return manages ? <PurchaseBoardPage /> : <PurchaseRequisitionsPage />;
}

export function PurchaseBoardPage() {
  const { can, me } = useAuth();
  const canCreatePr = can('purchase_requisition.create');
  const canFinanceCheck = can('purchase_requisition.finance_check');
  const canApprove = can('purchase_requisition.approve');
  const canCreatePo = can('purchase_order.create');
  const canSendPo = can('purchase_order.send');
  const canViewPurchaseFund = can('purchase_fund.view') || can('purchase_fund.allocate');
  const canManagePo = canCreatePo || canSendPo || canApprove || canViewPurchaseFund;

  const [tab, setTab] = useState<FlowStage>('pr_review');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [createPoForPr, setCreatePoForPr] = useState<PurchaseRequisition | null>(null);
  const [managePoId, setManagePoId] = useState<number | null>(null);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [printedPoIds, setPrintedPoIds] = useState<Set<number>>(() => new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [highlight, setHighlight] = useState<{ kind: 'pr' | 'po'; id: number } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const watch = useRef<Watch | null>(null);
  const printJobRef = useRef<PrintJob | null>(null);
  printJobRef.current = printJob;

  // Papan mengambil 100 dokumen terbaru sekali, lalu mengelompokkan per tahap di klien.
  // Dengan begitu hitungan tiap tab selalu sinkron dan perpindahan tab instan.
  const prs = useQuery({
    queryKey: ['purchase-requisitions', 'board'],
    queryFn: () => purchaseRequisitionApi.list({ per_page: 100 }),
  });
  const pos = useQuery({
    queryKey: ['purchase-orders', 'board'],
    queryFn: () => purchaseOrderApi.list({ per_page: 100 }),
    enabled: canManagePo,
  });

  const refetchAll = useCallback(() => {
    void prs.refetch();
    void pos.refetch();
  }, [prs, pos]);

  // Tab PO hanya untuk peran yang boleh melihat PO (buat/kirim/setujui); Finance murni hanya memeriksa Permintaan.
  const visibleStages = FLOW_STAGES.filter((stage) => canManagePo || stage.key === 'pr_review');
  const needle = search.trim().toLowerCase();
  const board = useMemo(
    () => buildBoard(
      (prs.data?.data ?? []).filter((pr) => matchesPr(pr, needle)),
      (pos.data?.data ?? []).filter((po) => matchesPo(po, needle)),
    ),
    [prs.data, pos.data, needle],
  );

  // Deteksi dokumen yang baru pindah tahap, lalu beri tahu ke mana ia pergi.
  useEffect(() => {
    const w = watch.current;
    if (!w) return;
    let stage: FlowTab | null = null;
    let doc = '';
    let statusText = '';
    if (w.kind === 'pr') {
      const found = prs.data?.data.find((item) => item.id === w.id);
      if (found) { stage = prStage(found.status); doc = found.doc_number; statusText = STATUS_LABEL[found.status]; }
    } else {
      const found = pos.data?.data.find((item) => item.id === w.id);
      if (found) { stage = poStage(found.status); doc = found.doc_number; statusText = ORDER_STATUS_LABEL[found.status]; }
    }
    if (stage === null || stage === w.stage) return;
    watch.current = null;
    setNotice({ doc, statusText, tab: stage, kind: w.kind, id: w.id });
    if (w.kind === 'po') setManagePoId(null);
  }, [prs.data, pos.data]);

  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(null), 5000);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  const finishPrint = useCallback(() => {
    const finished = printJobRef.current;
    if (finished?.kind === 'po') {
      setPrintedPoIds((current) => new Set(current).add(finished.po.id));
    }
    printJobRef.current = null;
    setPrintJob(null);
  }, []);

  function openPr(pr: PurchaseRequisitionSummary) {
    watch.current = { kind: 'pr', id: pr.id, stage: prStage(pr.status) };
    setNotice(null);
    setSelectedId(pr.id);
  }

  function openPo(po: PurchaseOrderSummary) {
    watch.current = { kind: 'po', id: po.id, stage: poStage(po.status) };
    setNotice(null);
    setManagePoId(po.id);
  }

  async function run(key: string, task: () => Promise<void>) {
    setBusyKey(key);
    setActionError(null);
    try {
      await task();
    } catch (error) {
      setActionError(error);
    } finally {
      setBusyKey(null);
    }
  }

  const startCreatePo = (id: number) => run(`pr-${id}`, async () => {
    setNotice(null);
    setCreatePoForPr(await purchaseRequisitionApi.get(id));
  });

  const printPrById = (id: number) => run(`pr-${id}`, async () => {
    setPrintJob({ kind: 'pr', pr: await purchaseRequisitionApi.get(id) });
  });

  const printPo = useCallback(async (po: PurchaseOrder) => {
    let supplier = null;
    try {
      supplier = (await supplierApi.list({ per_page: 100 })).data.find((item) => item.id === po.supplier_id) ?? null;
    } catch {
      // Alamat/telepon supplier hanya pelengkap; PO tetap dicetak dengan nama supplier.
    }
    setPrintJob({ kind: 'po', po, supplier });
  }, []);

  const printPoById = (id: number) => run(`po-${id}`, async () => {
    await printPo(await purchaseOrderApi.get(id));
  });

  function openTab(next: FlowStage, target?: { kind: 'pr' | 'po'; id: number }) {
    setTab(next);
    setNotice(null);
    setHighlight(target ?? null);
  }

  const actionable: Record<FlowStage, boolean> = {
    pr_review: canFinanceCheck,
    po_prepare: canCreatePo && can('purchase_fund.allocate'),
    po_send: canSendPo,
  };
  const hint = FLOW_STAGES.find((stage) => stage.key === tab)?.hint ?? '';
  const truncated = (prs.data?.total ?? 0) > (prs.data?.data.length ?? 0) || (pos.data?.total ?? 0) > (pos.data?.data.length ?? 0);

  return (
    <>
      <div className="no-print space-y-5 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Permintaan Pembelian</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Proses pembelian dalam tiga tahap: periksa Permintaan, siapkan dan setujui PO sekali, lalu cetak dan konfirmasi pengiriman.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canViewPurchaseFund && <PurchaseFundBalance />}
            <input
              className={`${inputCls} w-64`}
              placeholder="Cari nomor, pemohon, atau supplier"
              aria-label="Cari dokumen"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </header>

        <div role="tablist" aria-label="Tahap pembelian" className="flex overflow-x-auto rounded-lg border border-slate-200 bg-white">
          {visibleStages.map((stage, index) => {
            const count = tabCount(board, stage.key);
            const selected = tab === stage.key;
            return (
              <button
                key={stage.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => openTab(stage.key)}
                className={`flex min-w-40 flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-sm ${selected ? 'border-slate-900 bg-slate-50 font-semibold' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${selected ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'}`}>{index + 1}</span>
                {stage.label}
                <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${actionable[stage.key] && count > 0 ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {notice && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {notice.tab === 'archive'
              ? <span><strong className="font-mono">{notice.doc}</strong> sekarang berstatus “{notice.statusText}” dan tidak lagi tampil di papan pembelian.</span>
              : <span><strong className="font-mono">{notice.doc}</strong> sekarang berstatus “{notice.statusText}” dan pindah ke tab <strong>{tabLabel(notice.tab)}</strong>.</span>}
            <span className="flex gap-2">
              {notice.tab !== 'archive' && <button type="button" onClick={() => openTab(notice.tab as FlowStage, { kind: notice.kind, id: notice.id })} className="rounded-md bg-emerald-800 px-3 py-1.5 font-medium text-white">Buka tab</button>}
              <button type="button" onClick={() => setNotice(null)} className="rounded-md border border-emerald-300 px-3 py-1.5">Tutup</button>
            </span>
          </div>
        )}

        <ErrorNotice error={prs.error ?? pos.error ?? actionError} />

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">{hint}</p>
          {(prs.isLoading || pos.isLoading) && <p className="text-sm text-slate-500">Memuat dokumen…</p>}

          {tab === 'pr_review' && (
            <PrTable
              rows={board.pr_review}
              stage={tab}
              highlightId={highlight?.kind === 'pr' ? highlight.id : null}
              busyKey={busyKey}
              canAct={(pr) => canFinanceCheck && pr.status === 'submitted'}
              canCreatePo={false}
              onOpen={openPr}
              onCreatePo={(pr) => void startCreatePo(pr.id)}
              onPrint={(pr) => void printPrById(pr.id)}
            />
          )}

          {tab === 'po_prepare' && (
            <div className="space-y-5">
              <div>
                <h2 className="mb-2 text-sm font-semibold">Permintaan siap dibuat PO</h2>
                <PrTable
                  rows={board.pr_ready}
                  stage="po_prepare"
                  highlightId={highlight?.kind === 'pr' ? highlight.id : null}
                  busyKey={busyKey}
                  canAct={() => false}
                  canCreatePo={canCreatePo && can('purchase_fund.allocate')}
                  onOpen={openPr}
                  onCreatePo={(pr) => void startCreatePo(pr.id)}
                  onPrint={(pr) => void printPrById(pr.id)}
                />
              </div>
              <div>
                <h2 className="mb-2 text-sm font-semibold">PO legacy yang menunggu persiapan atau persetujuan</h2>
                <PoTable
                  rows={board.po_prepare}
                  stage={tab}
                  highlightId={highlight?.kind === 'po' ? highlight.id : null}
                  busyKey={busyKey}
                  canAct={canManagePo}
                  onOpen={openPo}
                  onPrint={(po) => void printPoById(po.id)}
                />
              </div>
            </div>
          )}

          {tab === 'po_send' && (
            <PoTable
              rows={board.po_send}
              stage={tab}
              highlightId={highlight?.kind === 'po' ? highlight.id : null}
              busyKey={busyKey}
              canAct={canSendPo}
              onOpen={openPo}
              onPrint={(po) => void printPoById(po.id)}
            />
          )}

          {truncated && <p className="text-xs text-slate-500">Papan menampilkan 100 dokumen terbaru per jenis. Dokumen yang lebih lama tidak muncul di sini.</p>}
        </section>

        {createOpen && <PurchaseRequisitionForm onClose={() => setCreateOpen(false)} onSaved={(pr) => { setCreateOpen(false); setSelectedId(pr.id); refetchAll(); }} />}
        {editId !== null && <PurchaseRequisitionForm prId={editId} onClose={() => setEditId(null)} onSaved={(pr) => { setEditId(null); setSelectedId(pr.id); refetchAll(); }} />}
        {selectedId !== null && <PurchaseRequisitionDetailDialog
          prId={selectedId}
          canManagePr={canCreatePr}
          canCancel={canCreatePr}
          canFinanceCheck={canFinanceCheck}
          canCreatePo={canCreatePo && can('purchase_fund.allocate')}
          canManagePo={canManagePo}
          closeOnSuccess
          onPrint={(pr) => setPrintJob({ kind: 'pr', pr })}
          onClose={() => setSelectedId(null)}
          onEdit={() => { setEditId(selectedId); setSelectedId(null); }}
          onSaved={refetchAll}
          onCreatePo={(pr) => { setSelectedId(null); setCreatePoForPr(pr); }}
          onManagePo={(poId) => { setSelectedId(null); watch.current = null; setManagePoId(poId); }}
        />}
        {createPoForPr && <PurchaseOrderCreateDialog
          pr={createPoForPr}
          onClose={() => setCreatePoForPr(null)}
          onCreated={(po) => {
            setCreatePoForPr(null);
            watch.current = { kind: 'po', id: po.id, stage: 'po_send' };
            setManagePoId(po.id);
            refetchAll();
          }}
        />}
        {managePoId !== null && <PurchaseOrderManageDialog
          poId={managePoId}
          hasPrinted={printedPoIds.has(managePoId)}
          onPrint={(po) => void printPo(po)}
          onClose={() => setManagePoId(null)}
          onChanged={refetchAll}
        />}
      </div>

      {printJob && <PurchasePrintSheet job={printJob} storeName={me?.store?.name ?? 'POS Retail SMK'} onDone={finishPrint} />}
    </>
  );
}

function StatusChip({ text, tone = 'slate' }: { text: string; tone?: 'slate' | 'amber' | 'green' | 'red' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    amber: 'bg-amber-100 text-amber-800',
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
  } as const;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{text}</span>;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">{text}</p>;
}

const REQUEST_EMPTY: Record<FlowStage, string> = {
  pr_review: 'Tidak ada Permintaan baru yang menunggu pemeriksaan Finance.',
  po_prepare: 'Tidak ada Permintaan siap PO atau PO yang menunggu persiapan/persetujuan.',
  po_send: 'Belum ada PO yang menunggu dicetak/dikirim atau sedang diterima.',
};

function PrTable({ rows, stage, highlightId, busyKey, canAct, canCreatePo, onOpen, onCreatePo, onPrint }: {
  rows: PurchaseRequisitionSummary[];
  stage: FlowStage;
  highlightId: number | null;
  busyKey: string | null;
  canAct: (pr: PurchaseRequisitionSummary) => boolean;
  canCreatePo: boolean;
  onOpen: (pr: PurchaseRequisitionSummary) => void;
  onCreatePo: (pr: PurchaseRequisitionSummary) => void;
  onPrint: (pr: PurchaseRequisitionSummary) => void;
}) {
  if (rows.length === 0) return <Empty text={REQUEST_EMPTY[stage]} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Nomor Permintaan</th>
            <th className="px-3 py-2">Pemohon</th>
            <th className="px-3 py-2">Alasan</th>
            <th className="px-3 py-2 text-right">Barang</th>
            <th className="px-3 py-2 text-right">Estimasi</th>
            <th className="px-3 py-2">Diajukan</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((pr) => (
            <tr key={pr.id} className={highlightId === pr.id ? 'bg-amber-50' : undefined}>
              <td className="px-3 py-2 font-mono font-medium">
                {pr.doc_number}
                {pr.is_auto_generated && <span className="mt-1 block font-sans text-xs font-medium text-blue-700">Otomatis · pemantauan stok</span>}
              </td>
              <td className="px-3 py-2">{pr.is_auto_generated ? 'Sistem pemantauan stok' : pr.requester_name}</td>
              <td className="max-w-xs truncate px-3 py-2">{pr.reason || '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{pr.items_count}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(pr.est_total)}</td>
              <td className="px-3 py-2">{formatDateTime(pr.submitted_at)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <span className="inline-flex items-center gap-3">
                  {isPrPrintable(pr.status) && <button type="button" disabled={busyKey === `pr-${pr.id}`} onClick={() => onPrint(pr)} className="font-medium text-slate-700 hover:underline disabled:opacity-50">Cetak</button>}
                  <button type="button" onClick={() => onOpen(pr)} className="font-medium text-blue-700 hover:underline">Detail</button>
                  {canAct(pr) && <button type="button" onClick={() => onOpen(pr)} className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white">Periksa Permintaan</button>}
                  {canCreatePo && stage === 'po_prepare' && <button type="button" disabled={busyKey === `pr-${pr.id}`} onClick={() => onCreatePo(pr)} className="rounded-md bg-blue-700 px-3 py-1.5 font-medium text-white disabled:opacity-60">{busyKey === `pr-${pr.id}` ? 'Memuat…' : 'Siapkan & buat PO'}</button>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PoTable({ rows, stage, highlightId, busyKey, canAct, onOpen, onPrint }: {
  rows: PurchaseOrderSummary[];
  stage: FlowStage;
  highlightId: number | null;
  busyKey: string | null;
  canAct: boolean;
  onOpen: (po: PurchaseOrderSummary) => void;
  onPrint: (po: PurchaseOrderSummary) => void;
}) {
  if (rows.length === 0) {
    return <Empty text={stage === 'po_prepare' ? 'Tidak ada PO yang menunggu persiapan atau persetujuan.' : 'Belum ada PO yang menunggu dikirim ke supplier.'} />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Nomor PO</th>
            <th className="px-3 py-2">Dari Permintaan</th>
            <th className="px-3 py-2">Supplier</th>
            <th className="px-3 py-2">Tanggal PO</th>
            <th className="px-3 py-2">Permintaan tiba</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2">Status</th>
            {stage === 'po_send' && <th className="px-3 py-2">Penerimaan</th>}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((po) => (
            <tr key={po.id} className={highlightId === po.id ? 'bg-amber-50' : undefined}>
              <td className="px-3 py-2 font-mono font-medium">{po.doc_number}</td>
              <td className="px-3 py-2 font-mono">{po.pr_doc_number}</td>
              <td className="px-3 py-2">{po.supplier_name}</td>
              <td className="px-3 py-2">{formatDate(po.order_date)}</td>
              <td className="px-3 py-2">{formatDate(po.expected_date)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(po.total)}</td>
              <td className="px-3 py-2"><StatusChip text={ORDER_STATUS_LABEL[po.status]} tone={po.status === 'pending_confirmation' ? 'amber' : po.status === 'received' ? 'green' : 'slate'} /></td>
              {stage === 'po_send' && <td className="px-3 py-2">{RECEIPT_LABEL[po.receipt_status]}</td>}
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <span className="inline-flex items-center gap-3">
                  {isPoPrintable(po.status) && <button type="button" disabled={busyKey === `po-${po.id}`} onClick={() => onPrint(po)} className="font-medium text-slate-700 hover:underline disabled:opacity-50">Cetak</button>}
                  {canAct && (stage === 'po_prepare' || (stage === 'po_send' && po.status === 'approved'))
                    ? <button type="button" onClick={() => onOpen(po)} className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white">{poNextAction(po.status)}</button>
                    : <button type="button" onClick={() => onOpen(po)} className="font-medium text-blue-700 hover:underline">Lihat</button>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
