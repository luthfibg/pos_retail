import { SETTINGS_PERMISSIONS } from '@/features/settings/settingsSections';
import type { InventoryMenuSetting } from '@/lib/api/types';

export interface NavItem {
  to: string;
  label: string;
  permission?: string | string[];
  roles?: string[];
  cashierOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** Diisi otomatis oleh getVisibleNavGroups: grup dengan satu menu tampil sebagai tautan langsung, tanpa dropdown. */
  standalone?: boolean;
}

/**
 * Satu sumber menu, disusun mengikuti alur operasional toko:
 *
 *  1. Dashboard      beranda: ringkasan penjualan, kas, dan stok
 *  2. Pembelian      Permintaan -> pemeriksaan Finance -> otorisasi Owner saat PO
 *  3. Inventory      penerimaan -> produk -> retur -> stok eksisting toko -> transfer/putaway -> adjustment & opname -> pergerakan stok
 *  4. Penjualan      buka kasir jaga -> jual di kasir -> koreksi/cetak ulang struk
 *  5. Keuangan       periksa kasir jaga -> terima setoran -> tagih HRD
 *  6. Data Master    kategori -> supplier -> karyawan (pembeli kredit)
 *  7. Pengaturan     satu layar untuk semua konfigurasi
 *
 * Item disaring berdasarkan permission dan batas role dari /auth/me, jadi setiap role hanya melihat menunya sendiri.
 * Urutan di dalam grup juga mengikuti alur.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Dashboard',
    items: [{ to: '/dashboard', label: 'Dashboard', permission: 'reports.view' }],
  },
  {
    label: 'Pembelian',
    items: [
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
    label: 'Inventory',
    items: [
      { to: '/goods-receipts', label: 'Penerimaan Barang', permission: 'goods_receipt.create', cashierOnly: true },
      { to: '/products', label: 'Stok Barang', permission: 'inventory.view' },
      { to: '/supplier-returns', label: 'Retur Barang', permission: ['supplier_return.create', 'inventory.adjust.approve'] },
      { to: '/inventory/opening', label: 'Stok Eksisting Toko', permission: 'inventory.opening_balance' },
      { to: '/inventory/transfers', label: 'Transfer Stok', permission: 'stock_transfer.create' },
      { to: '/inventory/adjustments', label: 'Adjustment & Opname', permission: 'opname.view', roles: ['Admin', 'Owner'] },
      { to: '/inventory/adjustments/adjustment', label: 'Adjustment', roles: ['Kasir'] },
      { to: '/inventory/movements', label: 'Pergerakan Stok', permission: 'inventory.view' },
    ],
  },
  {
    label: 'Penjualan',
    items: [
      { to: '/shift', label: 'Kasir Jaga', permission: 'shift.open', cashierOnly: true },
      { to: '/pos', label: 'Kasir', permission: 'sales.create', cashierOnly: true },
      { to: '/sales', label: 'Penjualan', permission: 'sales.create' },
    ],
  },
  {
    label: 'Keuangan',
    items: [
      { to: '/financial', label: 'Laporan Keuangan', permission: 'financial.report.view' },
      { to: '/shifts', label: 'Laporan Kasir Jaga', permission: 'shift.review' },
      { to: '/cash-deposits', label: 'Setoran Masuk', permission: 'cash_deposit.receive' },
      { to: '/billing', label: 'Laporan Piutang', permission: ['billing_period.manage', 'invoice.generate'] },
    ],
  },
  {
    label: 'Data Master',
    items: [
      { to: '/categories', label: 'Kategori', permission: 'category.manage' },
      { to: '/suppliers', label: 'Supplier', permission: 'supplier.manage' },
      { to: '/customers', label: 'Karyawan', permission: 'customer.select' },
    ],
  },
  {
    label: 'Pengaturan',
    // Satu layar untuk semua pengaturan; bagiannya tampil sesuai izin (lihat features/settings/settingsSections.ts).
    items: [{ to: '/settings', label: 'Pengaturan', permission: SETTINGS_PERMISSIONS }],
  },
];

/**
 * Menu yang terlihat untuk pengguna ini. Grup yang hanya punya satu menu bagi pengguna tersebut ditandai `standalone`
 * dan ditampilkan sebagai satu tautan langsung (label = nama menunya), bukan dropdown berisi satu item.
 */
export function getVisibleNavGroups(
  can: (permission: string) => boolean,
  isAdmin: boolean,
  inventoryMenus: InventoryMenuSetting = { show_opening_balance: false, show_stock_transfer: false },
  roles: string[] = [],
): NavGroup[] {
  return NAV_GROUPS.flatMap((group) => {
    const items = group.items.filter((item) => {
      if (item.to === '/inventory/opening' && !inventoryMenus.show_opening_balance) return false;
      if (item.to === '/inventory/transfers' && !inventoryMenus.show_stock_transfer) return false;
      if (item.cashierOnly && (isAdmin || !roles.includes('Kasir'))) return false;
      const roleAllowed = item.roles?.some((role) => roles.includes(role)) ?? false;
      const permissionAllowed = item.permission
        ? Array.isArray(item.permission) ? item.permission.some(can) : can(item.permission)
        : false;
      return roleAllowed || permissionAllowed;
    });

    return items.length > 0 ? [{ ...group, items, standalone: items.length === 1 }] : [];
  });
}
