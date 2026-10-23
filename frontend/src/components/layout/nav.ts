export interface NavItem {
  to: string;
  label: string;
  permission: string;
}

// Satu sumber menu. Item disaring berdasarkan permission dari /auth/me.
export const NAV_ITEMS: NavItem[] = [
  { to: '/pos', label: 'Kasir', permission: 'sales.create' },
  { to: '/dashboard', label: 'Dashboard', permission: 'reports.view' },
  { to: '/products', label: 'Produk', permission: 'inventory.view' },
  { to: '/categories', label: 'Kategori', permission: 'category.manage' },
  { to: '/suppliers', label: 'Supplier', permission: 'supplier.manage' },
];
