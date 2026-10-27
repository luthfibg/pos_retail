import { describe, expect, it } from 'vitest';
import type { PurchaseOrderSummary, PurchaseRequisitionSummary } from '@/lib/api/types';
import {
  buildBoard,
  isPoPrintable,
  isPrPrintable,
  matchesPo,
  matchesPr,
  poNextAction,
  poStage,
  prStage,
  tabCount,
  trackerStageForPr,
} from './purchaseFlow';

function pr(id: number, status: PurchaseRequisitionSummary['status']): PurchaseRequisitionSummary {
  return {
    id, doc_number: `PR-${id}`, status, reason: null, est_total: '0', items_count: 1,
    requested_by: 1, requester_name: 'Kasir Satu', submitted_at: null, created_at: '2026-10-27 00:00:00',
  };
}

function po(id: number, status: PurchaseOrderSummary['status']): PurchaseOrderSummary {
  return {
    id, doc_number: `PO-${id}`, status, receipt_status: 'none', payment_status: 'unpaid', payment_terms: 'cod',
    pr_id: 1, pr_doc_number: 'PR-1', supplier_id: 1, supplier_name: 'CV Maju', order_date: '2026-10-27',
    expected_date: null, total: '1000', created_at: '2026-10-27 00:00:00',
  };
}

describe('purchaseFlow', () => {
  it('memetakan status PR ke tahap', () => {
    expect(prStage('submitted')).toBe('pr_new');
    expect(prStage('finance_checked')).toBe('owner');
    expect(prStage('approved')).toBe('ready');
    for (const status of ['draft', 'returned', 'rejected', 'cancelled', 'converted'] as const) {
      expect(prStage(status)).toBe('archive');
    }
  });

  it('memetakan status PO ke tahap', () => {
    for (const status of ['draft', 'pending_confirmation', 'approved'] as const) expect(poStage(status)).toBe('po_process');
    for (const status of ['sent', 'partially_received', 'received'] as const) expect(poStage(status)).toBe('po_out');
    expect(poStage('cancelled')).toBe('archive');
  });

  it('mengelompokkan board dan menghitung per tab', () => {
    const board = buildBoard(
      [pr(1, 'submitted'), pr(2, 'submitted'), pr(3, 'finance_checked'), pr(4, 'approved'), pr(5, 'rejected')],
      [po(1, 'draft'), po(2, 'sent'), po(3, 'received'), po(4, 'cancelled')],
    );
    expect(tabCount(board, 'pr_new')).toBe(2);
    expect(tabCount(board, 'owner')).toBe(1);
    expect(tabCount(board, 'ready')).toBe(1);
    expect(tabCount(board, 'po_process')).toBe(1);
    expect(tabCount(board, 'po_out')).toBe(2);
    expect(tabCount(board, 'archive')).toBe(2);
  });

  it('pelacak PR converted mengikuti posisi PO-nya', () => {
    const base = { status: 'converted' as const };
    expect(trackerStageForPr({ ...base, purchase_orders: [{ id: 1, doc_number: 'PO-1', status: 'draft', total: null }] })).toBe('po_process');
    expect(trackerStageForPr({ ...base, purchase_orders: [{ id: 1, doc_number: 'PO-1', status: 'sent', total: null }] })).toBe('po_out');
    expect(trackerStageForPr({ status: 'approved', purchase_orders: [] })).toBe('ready');
  });

  it('hanya dokumen valid yang bisa dicetak', () => {
    expect(isPrPrintable('approved')).toBe(true);
    expect(isPrPrintable('converted')).toBe(true);
    expect(isPrPrintable('submitted')).toBe(false);
    expect(isPrPrintable('rejected')).toBe(false);
    expect(isPoPrintable('approved')).toBe(true);
    expect(isPoPrintable('sent')).toBe(true);
    expect(isPoPrintable('draft')).toBe(false);
    expect(isPoPrintable('pending_confirmation')).toBe(false);
    expect(isPoPrintable('cancelled')).toBe(false);
  });

  it('label aksi PO mengikuti langkah berikutnya', () => {
    expect(poNextAction('draft')).toBe('Ajukan PO');
    expect(poNextAction('pending_confirmation')).toBe('Konfirmasi Owner');
    expect(poNextAction('approved')).toBe('Kirim ke supplier');
    expect(poNextAction('sent')).toBe('Lihat');
  });

  it('pencarian cocok pada nomor, pemohon, supplier, dan PR asal', () => {
    expect(matchesPr(pr(7, 'submitted'), 'pr-7')).toBe(true);
    expect(matchesPr(pr(7, 'submitted'), 'kasir')).toBe(true);
    expect(matchesPr(pr(7, 'submitted'), 'zzz')).toBe(false);
    expect(matchesPo(po(3, 'sent'), 'maju')).toBe(true);
    expect(matchesPo(po(3, 'sent'), 'pr-1')).toBe(true);
    expect(matchesPo(po(3, 'sent'), '')).toBe(true);
  });
});
