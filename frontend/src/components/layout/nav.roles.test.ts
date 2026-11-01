import { describe, expect, it } from 'vitest';
import { getVisibleNavGroups } from './nav';

/**
 * Menu yang dilihat tiap role pada model standar retail.
 * Matriks izin di bawah MENCERMINKAN `PermissionCatalog::roles()` di backend (ASUMSI, menunggu konfirmasi klien).
 * Bila matriks backend berubah, perbarui bagian ini bersamaan agar perubahan menu terlihat saat review.
 */
const PERMISSIONS: Record<string, string[]> = {
  Kasir: [
    'product.create', 'shelf_layout.view', 'inventory.view', 'customer.create', 'customer.select', 'purchase_requisition.create',
    'goods_receipt.create', 'stock_transfer.create', 'inventory.adjust.request', 'sales.create', 'receipt.reprint', 'shift.open',
    'shift.close', 'cash_movement.create', 'float.propose', 'cash_deposit.create', 'reports.view',
  ],
  Finance: [
    'inventory.view', 'customer.select', 'customer.update', 'customer.verify', 'customer.set_limit', 'purchase_requisition.finance_check',
    'shift.review', 'float.propose', 'cash_deposit.receive', 'receipt.reprint', 'reports.view',
  ],
  Purchasing: [
    'product.create', 'product.update', 'category.manage', 'supplier.manage', 'shelf_layout.view', 'inventory.view',
    'purchase_requisition.create', 'purchase_order.create', 'purchase_order.send', 'reports.view',
  ],
  Accounting: [
    'inventory.view', 'goods_receipt.verify_documents', 'billing_period.manage', 'billing_period.close', 'invoice.generate',
    'invoice.issue', 'invoice.record_payment', 'audit_log.view', 'shift.review', 'reports.view',
  ],
  Owner: [
    'user.manage', 'role.manage', 'settings.manage', 'audit_log.view', 'product.activate', 'price.change', 'discount.manage',
    'shelf_layout.manage', 'shelf_layout.view', 'inventory.view', 'inventory.adjust.approve', 'customer.select', 'customer.update',
    'customer.verify', 'customer.set_limit', 'purchase_requisition.approve', 'sales.credit_exception', 'sales.void', 'receipt.reprint',
    'shift.review', 'float.configure', 'reports.view',
  ],
};

function menuFor(role: string): string[] {
  const permissions = new Set(PERMISSIONS[role]);
  const can = (permission: string) => permissions.has(permission);
  // Sama dengan AppLayout: shift.review menandai peran pengawas, yang tidak melihat menu khusus kasir.
  return getVisibleNavGroups(can, can('shift.review')).flatMap((group) => group.items.map((item) => item.to)).sort();
}

describe('menu per role (model standar retail)', () => {
  it('Kasir melihat menu operasional toko', () => {
    expect(menuFor('Kasir')).toEqual([
      '/customers', '/dashboard', '/goods-receipts', '/inventory/adjustments', '/inventory/movements', '/inventory/transfers',
      '/pos', '/products', '/purchase-requisitions', '/sales', '/shift',
    ]);
  });

  it('Finance melihat tinjau shift, setoran masuk, dan pemeriksaan PR', () => {
    expect(menuFor('Finance')).toEqual([
      '/cash-deposits', '/customers', '/dashboard', '/inventory/movements', '/products', '/purchase-requisitions', '/shifts',
    ]);
  });

  it('Purchasing melihat master produk, supplier, dan pembelian', () => {
    expect(menuFor('Purchasing')).toEqual([
      '/categories', '/dashboard', '/inventory/movements', '/products', '/purchase-requisitions', '/suppliers',
    ]);
  });

  it('Accounting melihat tagihan HRD dan tinjau shift', () => {
    // Catatan: verifikasi surat jalan/faktur (`goods_receipt.verify_documents`) belum punya menu; lihat catatan di FRONTEND_PROGRESS.
    expect(menuFor('Accounting')).toEqual(['/billing', '/dashboard', '/inventory/movements', '/products', '/shifts']);
  });

  it('Owner melihat persetujuan, kebijakan, pengaturan, dan model administrasi', () => {
    const owner = menuFor('Owner');
    expect(owner).toContain('/settings/admin-model');
    expect(owner).toContain('/users');
    expect(owner).toContain('/purchase-requisitions');
    expect(owner).toContain('/settings/float-policy');
    expect(owner).not.toContain('/pos');
    expect(owner).not.toContain('/shift');
    expect(owner).not.toContain('/billing');
  });

  it('hanya pemegang settings.manage yang melihat Model Administrasi', () => {
    for (const role of ['Kasir', 'Finance', 'Purchasing', 'Accounting']) {
      expect(menuFor(role)).not.toContain('/settings/admin-model');
    }
  });
});
