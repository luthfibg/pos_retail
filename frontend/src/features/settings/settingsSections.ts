/**
 * Daftar bagian layar Pengaturan. Satu sumber untuk: isi layar, indeks kategori, izin akses, dan pengalihan rute lama.
 * Izin hanya untuk tampilan; backend tetap penentu akhir.
 */
export type SectionId = 'store-name' | 'admin-model' | 'warehouse' | 'stock-monitoring' | 'purchase-order-suppliers' | 'purchase-order-owner' | 'inventory-menus' | 'bank-accounts' | 'stock-authority' | 'opname' | 'registers' | 'vat' | 'discounts' | 'float-policy' | 'users' | 'approval-auth' | 'annual-receivable';
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
  { id: 'inventory', label: 'Penghitungan stok' },
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
    id: 'admin-model', group: 'store', title: 'Pembagian tugas toko', permission: 'settings.manage', defaultOpen: true,
    description: 'Pilih apakah semua tugas dikelola Admin dan Kasir, atau dibagi ke peran Keuangan, Pembelian, Pembukuan, dan Pemilik toko.',
    keywords: ['role', 'peran', 'owner', 'finance', 'purchasing', 'accounting', 'admin'],
  },
  {
    id: 'warehouse', group: 'store', title: 'Gudang', permission: 'settings.manage', defaultOpen: true,
    description: 'Aktifkan lokasi Gudang untuk penerimaan barang dan transfer stok.',
    keywords: ['lokasi', 'stok', 'transfer'],
  },
  {
    id: 'stock-monitoring', group: 'store', title: 'Pemantauan stok', permission: 'settings.manage', defaultOpen: true,
    description: 'Atur batas stok untuk membuat permintaan pembelian secara otomatis.',
    keywords: ['inventory', 'stok', 'minimum', 'menipis', 'pembelian', 'restock', 'isi ulang', 'permintaan otomatis'],
  },
  {
    id: 'purchase-order-suppliers', group: 'store', title: 'Pemasok pesanan pembelian', permission: 'settings.manage', defaultOpen: false,
    description: 'Pilih pemasok untuk pesanan pembelian (PO), baik dari data produk maupun daftar pemasok aktif.',
    keywords: ['supplier po', 'supplier', 'pembelian', 'purchase order', 'po', 'produk', 'otomatis'],
  },
  {
    id: 'purchase-order-owner', group: 'store', title: 'Pemilik toko untuk persetujuan pembelian', permission: 'settings.manage', defaultOpen: false,
    description: 'Pilih akun pemilik toko yang mengonfirmasi permintaan pembelian dan namanya dicantumkan pada pesanan.',
    keywords: ['nama owner', 'owner', 'nama', 'akun', 'persetujuan', 'pembelian', 'purchase order', 'po'],
  },
  {
    id: 'inventory-menus', group: 'store', title: 'Menu stok', permission: 'settings.manage', defaultOpen: false,
    description: 'Pilih menu stok awal toko dan pemindahan stok yang ingin ditampilkan.',
    keywords: ['inventory', 'stok eksisting', 'stok awal', 'transfer', 'menu'],
  },
  {
    id: 'bank-accounts', group: 'store', title: 'Rekening bank', permission: 'settings.manage', defaultOpen: false,
    description: 'Kelola hingga lima rekening bank yang dapat dicantumkan pada pesanan pembelian (PO). Saldo rekening tidak disimpan.',
    keywords: ['bank', 'rekening', 'purchase order', 'pembelian', 'nomor rekening'],
  },
  {
    id: 'stock-authority', group: 'store', title: 'Akses untuk mengelola stok', permission: 'settings.manage', defaultOpen: false,
    description: 'Tentukan peran yang boleh mencatat stok awal, menerima dan memindahkan barang, serta menyetujui perubahan stok.',
    keywords: ['inventory', 'opname', 'adjustment', 'penerimaan', 'transfer', 'stok eksisting toko', 'wewenang', 'role'],
  },
  {
    id: 'opname', group: 'inventory', title: 'Penghitungan stok', permission: 'opname.settings.manage', defaultOpen: true,
    description: 'Atur pengingat, tampilan jumlah stok di sistem, dan persetujuan hasil penghitungan stok.',
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
    id: 'float-policy', group: 'cash', title: 'Uang yang disisakan di laci', permission: 'float.configure', defaultOpen: true,
    description: 'Atur jumlah uang yang ditinggalkan di laci dan jumlah yang disetorkan saat kasir jaga ditutup.',
    keywords: ['endapan', 'laci', 'setoran', 'kas', 'shift'],
  },
  {
    id: 'registers', group: 'cash', title: 'Mesin kasir', permission: 'register.manage', defaultOpen: true,
    description: 'Kelola titik kasir dan laci kas. Setiap titik digunakan bergantian oleh kasir dan memiliki saldo kas sendiri.',
    keywords: ['register', 'laci', 'mesin', 'kasir jaga', 'shift'],
  },
  {
    id: 'users', group: 'accounts', title: 'Pengguna', permission: 'user.manage', defaultOpen: false,
    description: 'Akun, peran, akses, dan status pengguna di toko ini.',
    keywords: ['akun', 'sandi', 'password', 'role', 'kasir', 'username'],
  },
  {
    id: 'approval-auth', group: 'accounts', title: 'Cara mengonfirmasi persetujuan',
    permission: ['settings.manage', 'user.manage', 'purchase_requisition.approve', 'inventory.adjust.approve', 'sales.credit_exception'],
    defaultOpen: true,
    description: 'Pilih cara pengguna membuktikan identitas saat menyetujui tindakan tertentu, serta kelola kunci persetujuan pribadi.',
    keywords: ['owner', 'admin', 'kunci', 'kode', 'passphrase', 'password', 'approval'],
  },
  {
    id: 'annual-receivable', group: 'billing', title: 'Laporan piutang tahunan', permission: 'settings.manage', defaultOpen: false,
    description: 'Atur bulan dan tanggal yang dicantumkan sebagai tanggal cetak laporan tahunan.',
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
