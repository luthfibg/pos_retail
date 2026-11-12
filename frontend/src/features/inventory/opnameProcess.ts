import type { OpnameReport, OpnameReportNode, OpnameSessionStatus } from '@/lib/api/types';

export const ACTIVE_STATUSES: readonly OpnameSessionStatus[] = ['in_progress', 'pending_approval'];

/** Hitungan dari isian: angka tak negatif, maksimal 3 desimal, koma atau titik. */
export function parseCount(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  return Number(text);
}

/** "5.000" -> "5", "5.500" -> "5,5". */
export function formatCount(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? String(number).replace('.', ',') : '';
}

export function canFinish(counted: number, total: number): boolean {
  return total > 0 && counted >= total;
}

export function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Pesan galat pendek untuk layar; pesan panjang dari server diganti teks cadangan. */
export function shortMessage(error: unknown, fallback: string, max = 70): string {
  const withFirst = error as { firstError?: () => string } | null;
  const text = typeof withFirst?.firstError === 'function'
    ? withFirst.firstError()
    : error instanceof Error ? error.message : '';
  const trimmed = text.trim();
  return trimmed !== '' && trimmed.length <= max ? trimmed : fallback;
}

export interface VarianceRow {
  id: number;
  name: string;
  /** Selisih bertanda: kurang = negatif, lebih = positif. */
  diff: number;
}

/** Semua produk berselisih dari laporan, urut nama, tanpa duplikat. */
export function varianceRows(report: OpnameReport | undefined): VarianceRow[] {
  const rows = new Map<number, VarianceRow>();
  const visit = (node: OpnameReportNode) => {
    for (const line of node.lines) {
      const size = Math.abs(Number(line.diff_qty));
      if (!Number.isFinite(size) || size === 0) continue;
      rows.set(line.item_id, { id: line.item_id, name: line.name, diff: line.direction === 'short' ? -size : size });
    }
    node.children.forEach(visit);
  };
  report?.categories?.forEach(visit);
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

export function formatDiff(diff: number): string {
  return `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${formatCount(Math.abs(diff))}`;
}
