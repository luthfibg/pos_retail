import type {
  PurchaseOrderStatus,
  PurchaseOrderSummary,
  PurchaseRequisition,
  PurchaseRequisitionStatus,
  PurchaseRequisitionSummary,
} from '@/lib/api/types';

/**
 * Tahap alur pembelian, dari kiri ke kanan:
 * PR Masuk -> Persetujuan Owner -> Siap Dibuat PO -> PO Diproses -> PO Keluar.
 * Hanya logika murni (tanpa React) supaya mudah diuji.
 */
export type FlowStage = 'pr_new' | 'owner' | 'ready' | 'po_process' | 'po_out';
export type FlowTab = FlowStage | 'archive';

export const FLOW_STAGES: ReadonlyArray<{ key: FlowStage; label: string; hint: string }> = [
  { key: 'pr_new', label: 'PR Masuk', hint: 'PR yang diajukan Kasir dan menunggu pemeriksaan Finance (saldo/kelayakan).' },
  { key: 'owner', label: 'Persetujuan Owner', hint: 'PR sudah lolos Finance dan menunggu persetujuan Owner (autentikasi ulang).' },
  { key: 'ready', label: 'Siap Dibuat PO', hint: 'PR disetujui Owner. Pilih supplier lalu buat PO per supplier.' },
  { key: 'po_process', label: 'PO Diproses', hint: 'PO Draft, menunggu konfirmasi Owner, atau sudah disetujui dan siap dikirim ke supplier.' },
  { key: 'po_out', label: 'PO Keluar', hint: 'PO yang sudah dikirim ke supplier, lengkap dengan status penerimaan barang.' },
];

export const ARCHIVE_TAB = {
  label: 'Riwayat',
  hint: 'PR yang dikembalikan, ditolak, dibatalkan, masih Draft, atau sudah seluruhnya dipesan; serta PO yang dibatalkan.',
} as const;

const PR_STAGE: Partial<Record<PurchaseRequisitionStatus, FlowStage>> = {
  submitted: 'pr_new',
  finance_checked: 'owner',
  approved: 'ready',
};

const PO_STAGE: Partial<Record<PurchaseOrderStatus, FlowStage>> = {
  draft: 'po_process',
  pending_confirmation: 'po_process',
  approved: 'po_process',
  sent: 'po_out',
  partially_received: 'po_out',
  received: 'po_out',
};

export function prStage(status: PurchaseRequisitionStatus): FlowTab {
  return PR_STAGE[status] ?? 'archive';
}

export function poStage(status: PurchaseOrderStatus): FlowTab {
  return PO_STAGE[status] ?? 'archive';
}

export function tabLabel(tab: FlowTab): string {
  if (tab === 'archive') return ARCHIVE_TAB.label;
  return FLOW_STAGES.find((stage) => stage.key === tab)?.label ?? tab;
}

/** PR yang sudah dipesan seluruhnya (`converted`) ditampilkan di posisi PO-nya, bukan di Riwayat, pada pelacak detail. */
export function trackerStageForPr(pr: Pick<PurchaseRequisition, 'status' | 'purchase_orders'>): FlowTab {
  if (pr.status === 'converted') {
    return pr.purchase_orders.some((po) => poStage(po.status) === 'po_out') ? 'po_out' : 'po_process';
  }
  return prStage(pr.status);
}

/** Dokumen yang sah dicetak. Ubah di sini bila aturan bisnis berubah. */
export function isPrPrintable(status: PurchaseRequisitionStatus): boolean {
  return status === 'approved' || status === 'converted';
}

export function isPoPrintable(status: PurchaseOrderStatus): boolean {
  return status === 'approved' || status === 'sent' || status === 'partially_received' || status === 'received';
}

/** Label tombol utama pada baris PO, mengikuti langkah berikutnya. */
export function poNextAction(status: PurchaseOrderStatus): string {
  if (status === 'draft') return 'Ajukan PO';
  if (status === 'pending_confirmation') return 'Konfirmasi Owner';
  if (status === 'approved') return 'Kirim ke supplier';
  return 'Lihat';
}

export interface FlowBoard {
  pr_new: PurchaseRequisitionSummary[];
  owner: PurchaseRequisitionSummary[];
  ready: PurchaseRequisitionSummary[];
  po_process: PurchaseOrderSummary[];
  po_out: PurchaseOrderSummary[];
  archivePr: PurchaseRequisitionSummary[];
  archivePo: PurchaseOrderSummary[];
}

export function buildBoard(prs: PurchaseRequisitionSummary[], pos: PurchaseOrderSummary[]): FlowBoard {
  const board: FlowBoard = { pr_new: [], owner: [], ready: [], po_process: [], po_out: [], archivePr: [], archivePo: [] };
  for (const pr of prs) {
    const stage = prStage(pr.status);
    if (stage === 'pr_new' || stage === 'owner' || stage === 'ready') board[stage].push(pr);
    else board.archivePr.push(pr);
  }
  for (const po of pos) {
    const stage = poStage(po.status);
    if (stage === 'po_process' || stage === 'po_out') board[stage].push(po);
    else board.archivePo.push(po);
  }
  return board;
}

export function tabCount(board: FlowBoard, tab: FlowTab): number {
  if (tab === 'archive') return board.archivePr.length + board.archivePo.length;
  return board[tab].length;
}

function includes(needle: string, ...fields: Array<string | null | undefined>): boolean {
  if (needle === '') return true;
  return fields.some((field) => (field ?? '').toLowerCase().includes(needle));
}

export function matchesPr(pr: PurchaseRequisitionSummary, needle: string): boolean {
  return includes(needle, pr.doc_number, pr.requester_name, pr.reason);
}

export function matchesPo(po: PurchaseOrderSummary, needle: string): boolean {
  return includes(needle, po.doc_number, po.pr_doc_number, po.supplier_name);
}
