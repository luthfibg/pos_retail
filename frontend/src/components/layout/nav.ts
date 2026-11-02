import { SETTINGS_PERMISSIONS } from '@/features/settings/settingsSections';
export interface NavItem {
  to: string;
  label: string;
  permission: string | string[];
  cashierOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** Tampil sebagai satu tautan langsung (tanpa akordeon grup), mis. Pengaturan. */
  standalone?: boolean;
}

// Satu sumber menu. Item disaring berdasarkan permission dari /auth/me.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operasional',
    items: [
      { to: '/pos', label: 'Kasir', permission: 'sales.create', cashierOnly: true },
      { to: '/sales', label: 'Riwayat Penjualan', permission: 'sales.create' },
      { to: '/shift', label: 'Shift Saya', permission: 'shift.open', cashierOnly: true },
      { to: '/shifts', label: 'Tinjau Shift', permission: 'shift.review' },
      { to: '/cash-deposits', label: 'Setoran Masuk', permission: 'cash_deposit.receive' },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { to: '/products', label: 'Produk', permission: 'inventory.view' },
      { to: '/categories', label: 'Kategori', permission: 'category.manage' },
      { to: '/customers', label: 'Karyawan', permission: 'customer.select' },
      { to: '/inventory/opening', label: 'Stok Awal', permission: 'inventory.opening_balance' },
      { to: '/inventory/adjustments', label: 'Adjustment & Opname', permission: ['inventory.adjust.request', 'inventory.adjust.approve'] },
      { to: '/inventory/transfers', label: 'Transfer Stok', permission: 'stock_transfer.create' },
      { to: '/inventory/movements', label: 'Riwayat Stok', permission: 'inventory.view' },
      { to: '/goods-receipts', label: 'Penerimaan Barang', permission: 'goods_receipt.create' },
    ],
  },
  {
    label: 'Pembelian',
    items: [
      { to: '/suppliers', label: 'Supplier', permission: 'supplier.manage' },
      {
        to: '/purchase-requisitions',
        label: 'Permintaan Pembelian',
        permission: [
          'purchase_requisition.create',
          'purchase_requisition.finance_check',
          'purchase_requisition.approve',
          'purchase_order.create',
          'purchase_order.send',
        ],
      },
    ],
  },
  {
    label: 'Keuangan',
    items: [
      {
        to: '/billing',
        label: 'Tagihan HRD',
        permission: ['billing_period.manage', 'invoice.generate'],
      },
    ],
  },
  {
    label: 'Pengaturan',
    standalone: true,
    // Satu layar untuk semua pengaturan; bagiannya tampil sesuai izin (lihat features/settings/settingsSections.ts).
    items: [{ to: '/settings', label: 'Pengaturan', permission: SETTINGS_PERMISSIONS }],
  },
  {
    label: 'Laporan',
    items: [{ to: '/dashboard', label: 'Dashboard', permission: 'reports.view' }],
  },
];

export function getVisibleNavGroups(can: (permission: string) => boolean, isAdmin: boolean): NavGroup[] {
  return NAV_GROUPS.flatMap((group) => {
    const items = group.items.filter((item) => {
      if (isAdmin && item.cashierOnly) return false;
      return Array.isArray(item.permission) ? item.permission.some(can) : can(item.permission);
    });

    return items.length > 0 ? [{ ...group, items }] : [];
  });
}
