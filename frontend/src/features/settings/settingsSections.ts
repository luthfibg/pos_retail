/**
 * Daftar bagian layar Pengaturan. Satu sumber untuk: isi layar, indeks kategori, izin akses, dan pengalihan rute lama.
 * Izin hanya untuk tampilan; backend tetap penentu akhir.
 */
export type SectionId = 'store-name' | 'admin-model' | 'warehouse' | 'stock-monitoring' | 'inventory-menus' | 'bank-accounts' | 'stock-authority' | 'opname' | 'registers' | 'vat' | 'discounts' | 'float-policy' | 'users' | 'approval-auth' | 'annual-receivable';
export type GroupId = 'store' | 'inventory' | 'sales' | 'cash' | 'accounts' | 'billing';

export interface SettingsSection {
  id: SectionId;
  group: GroupId;
  title: string;
  description: string;
  permission: string | string[];
  keywords: string[];
  /** Bagian kecil terbuka sejak awal; daftar besar (diskon, pengguna) tertutup sampai dibuka. */
  defaultOpen: boolean;
}

export const GROUPS: ReadonlyArray<{ id: GroupId; label: string }> = [
  { id: 'store', label: 'Toko' },
  { id: 'inventory', label: 'Opname' },
  { id: 'sales', label: 'Penjualan & harga' },
  { id: 'cash', label: 'Kas' },
  { id: 'accounts', label: 'Akun' },
  { id: 'billing', label: 'Piutang' },
];

export const SECTIONS: ReadonlyArray<SettingsSection> = [
  {
    id: 'store-name', group: 'store', title: 'Nama toko', permission: 'settings.manage', defaultOpen: true,
    description: 'Ubah nama toko yang ditampilkan tanpa mengubah kode, mata uang, atau zona waktu.',
    keywords: ['nama', 'identitas', 'retail', 'toko'],
  },
  {
    id: 'admin-model', group: 'store', title: 'Model administrasi', permission: 'settings.manage', defaultOpen: true,
    description: 'Pilih model Simple (Admin dan Kasir) atau Standar retail (Kasir, Finance, Purchasing, Accounting, Owner).',
    keywords: ['role', 'peran', 'owner', 'finance', 'purchasing', 'accounting', 'admin'],
  },
  {
    id: 'warehouse', group: 'store', title: 'Gudang', permission: 'settings.manage', defaultOpen: true,
    description: 'Aktifkan lokasi Gudang untuk penerimaan barang dan transfer stok.',
    keywords: ['lokasi', 'stok', 'transfer'],
  },
  {
    id: 'stock-monitoring', group: 'store', title: 'Pemantauan stok', permission: 'settings.manage', defaultOpen: true,
    description: 'Atur ambang stok menipis untuk pembuatan Permintaan otomatis oleh sistem.',
    keywords: ['inventory', 'stok', 'minimum', 'menipis', 'pembelian', 'restock', 'isi ulang', 'permintaan otomatis'],
  },
  {
    id: 'inventory-menus', group: 'store', title: 'Menu Inventory', permission: 'settings.manage', defaultOpen: false,
    description: 'Tampilkan atau sembunyikan menu Stok Eksisting Toko dan Transfer Stok.',
    keywords: ['inventory', 'stok eksisting', 'stok awal', 'transfer', 'menu'],
  },
  {
    id: 'bank-accounts', group: 'store', title: 'Rekening bank', permission: 'settings.manage', defaultOpen: false,
    description: 'Kelola hingga lima rekening bank untuk dicantumkan pada Purchase Order. Saldo tidak dicatat.',
    keywords: ['bank', 'rekening', 'purchase order', 'pembelian', 'nomor rekening'],
  },
  {
    id: 'stock-authority', group: 'store', title: 'Kewenangan stok', permission: 'settings.manage', defaultOpen: false,
    description: 'Siapa yang boleh mencatat stok eksisting toko, penerimaan, transfer, serta mengajukan dan menyetujui adjustment/opname.',
    keywords: ['inventory', 'opname', 'adjustment', 'penerimaan', 'transfer', 'stok eksisting toko', 'wewenang', 'role'],
  },
  {
    id: 'opname', group: 'inventory', title: 'Opname', permission: 'opname.settings.manage', defaultOpen: true,
    description: 'Atur apakah petugas melihat angka stok sistem saat melakukan stock opname.',
    keywords: ['inventory', 'stok', 'stock opname', 'hitung buta', 'selisih', 'ambang persetujuan'],
  },
  {
    id: 'vat', group: 'sales', title: 'PPN', permission: 'settings.manage', defaultOpen: true,
    description: 'Tarif PPN, status harga sudah termasuk PPN, dan tanggal berlaku.',
    keywords: ['pajak', 'pkp', 'tarif', 'invoice'],
  },
  {
    id: 'discounts', group: 'sales', title: 'Diskon', permission: 'discount.manage', defaultOpen: false,
    description: 'Diskon produk atau kategori yang berlaku otomatis di kasir.',
    keywords: ['promo', 'potongan', 'harga'],
  },
  {
    id: 'float-policy', group: 'cash', title: 'Kebijakan endapan', permission: 'float.configure', defaultOpen: true,
    description: 'Uang yang tetap di laci saat kasir jaga ditutup dan aturan setoran akhir kasir jaga.',
    keywords: ['endapan', 'laci', 'setoran', 'kas', 'shift'],
  },
  {
    id: 'registers', group: 'cash', title: 'Mesin kasir', permission: 'register.manage', defaultOpen: true,
    description: 'Kelola mesin kasir dan laci kas. Tiap mesin dipakai bergantian oleh kasir dan memiliki saldo kas kecil sendiri.',
    keywords: ['register', 'laci', 'mesin', 'kasir jaga', 'shift'],
  },
  {
    id: 'users', group: 'accounts', title: 'Pengguna', permission: 'user.manage', defaultOpen: false,
    description: 'Akun, role, akses, dan status pengguna di toko ini.',
    keywords: ['akun', 'sandi', 'password', 'role', 'kasir', 'username'],
  },
  {
    id: 'approval-auth', group: 'accounts', title: 'Otorisasi persetujuan',
    permission: ['settings.manage', 'user.manage', 'purchase_requisition.approve', 'inventory.adjust.approve', 'sales.credit_exception'],
    defaultOpen: true,
    description: 'Atur metode autentikasi ulang dan kunci pribadi untuk pemegang izin persetujuan.',
    keywords: ['owner', 'admin', 'kunci', 'kode', 'passphrase', 'password', 'approval'],
  },
  {
    id: 'annual-receivable', group: 'billing', title: 'Laporan piutang tahunan', permission: 'settings.manage', defaultOpen: false,
    description: '',
    keywords: ['piutang', 'tutup tahun', 'cetak', 'tanggal'],
  },
];

/** Izin yang membuka layar Pengaturan (salah satu cukup). */
export const SETTINGS_PERMISSIONS: string[] = Array.from(new Set(SECTIONS.flatMap((section) =>
  Array.isArray(section.permission) ? section.permission : [section.permission],
)));

/** Rute lama menuju bagian yang sesuai, agar bookmark dan tautan lama tetap bekerja. */
export const LEGACY_REDIRECTS: Record<string, SectionId> = {
  '/settings/admin-model': 'admin-model',
  '/settings/warehouse': 'warehouse',
  '/settings/stock-authority': 'stock-authority',
  '/settings/vat': 'vat',
  '/discounts': 'discounts',
  '/settings/float-policy': 'float-policy',
  '/users': 'users',
};

export function visibleSections(can: (permission: string) => boolean, query = ''): SettingsSection[] {
  const needle = query.trim().toLowerCase();
  return SECTIONS.filter((section) => {
    const permissions = Array.isArray(section.permission) ? section.permission : [section.permission];
    if (!permissions.some(can)) return false;
    if (needle === '') return true;
    return [section.title, section.description, ...section.keywords].some((text) => text.toLowerCase().includes(needle));
  });
}

export function groupSections(sections: SettingsSection[]): Array<{ id: GroupId; label: string; sections: SettingsSection[] }> {
  return GROUPS.flatMap((group) => {
    const inGroup = sections.filter((section) => section.group === group.id);
    return inGroup.length > 0 ? [{ ...group, sections: inGroup }] : [];
  });
}

export function sectionFromHash(hash: string, sections: SettingsSection[]): SectionId | null {
  const id = hash.replace(/^#/, '');
  return sections.find((section) => section.id === id)?.id ?? null;
}
