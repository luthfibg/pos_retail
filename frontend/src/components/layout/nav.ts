export interface NavItem {
  to: string;
  label: string;
  permission: string;
}

// Satu sumber menu. Item disaring berdasarkan permission dari /auth/me.
export const NAV_ITEMS: NavItem[] = [
  { to: '/pos', label: 'Kasir', permission: 'sales.create' },
  { to: '/sales', label: 'Riwayat Penjualan', permission: 'sales.create' },
  { to: '/shift', label: 'Shift Saya', permission: 'shift.open' },
  { to: '/shifts', label: 'Tinjau Shift', permission: 'shift.review' },
  { to: '/cash-deposits', label: 'Setoran Masuk', permission: 'cash_deposit.receive' },
  { to: '/dashboard', label: 'Dashboard', permission: 'reports.view' },
  { to: '/products', label: 'Produk', permission: 'inventory.view' },
  { to: '/categories', label: 'Kategori', permission: 'category.manage' },
  { to: '/suppliers', label: 'Supplier', permission: 'supplier.manage' },
  { to: '/customers', label: 'Karyawan', permission: 'customer.select' },
  { to: '/inventory/opening', label: 'Stok Awal', permission: 'inventory.adjust.approve' },
  { to: '/inventory/movements', label: 'Riwayat Stok', permission: 'inventory.view' },
  { to: '/goods-receipts', label: 'Penerimaan Barang', permission: 'goods_receipt.create' },
  { to: '/discounts', label: 'Diskon', permission: 'discount.manage' },
  { to: '/settings/vat', label: 'Pengaturan PPN', permission: 'settings.manage' },
  { to: '/settings/float-policy', label: 'Kebijakan Endapan', permission: 'float.configure' },
];
