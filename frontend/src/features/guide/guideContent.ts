/**
 * Isi halaman Panduan. Data murni (tanpa React) agar mudah diuji dan ditambah per role.
 *
 * Aturan tulis: label singkat dan langkah pendek, tanpa kalimat deskriptif panjang. Tulis "stok produk", bukan "saldo produk".
 * Nama menu, tombol, dan status harus sama persis dengan yang tampil di layar; `guideContent.test.ts` memeriksa
 * bahwa setiap menu yang ditautkan masih ada di `nav.ts` dan setiap bagian Pengaturan tercakup.
 *
 * Menambah role baru: tambahkan entri di `GUIDES`; menu Panduan dan rute `/guide` otomatis mengikuti.
 */
export type GuideGroupId =
  | 'mulai' | 'pembelian' | 'inventory' | 'penjualan' | 'keuangan' | 'master' | 'pengaturan' | 'referensi';

export type GuideBlock =
  | { kind: 'steps'; title?: string; items: string[] }
  | { kind: 'list'; title?: string; items: string[] }
  | { kind: 'table'; title?: string; head: string[]; rows: string[][] }
  | { kind: 'note'; tone: 'info' | 'warn'; text: string };

export interface GuideSection {
  id: string;
  group: GuideGroupId;
  title: string;
  /** Menu yang dijelaskan; dipakai untuk tombol "Buka menu". Boleh memuat #bagian untuk layar Pengaturan. */
  menu?: { to: string; label: string };
  keywords: string[];
  blocks: GuideBlock[];
}

export interface RoleGuide {
  role: string;
  title: string;
  /** Satu baris konteks di bawah judul. */
  scope: string;
  sections: GuideSection[];
}

export const GUIDE_GROUPS: ReadonlyArray<{ id: GuideGroupId; label: string }> = [
  { id: 'mulai', label: 'Mulai' },
  { id: 'pembelian', label: 'Pembelian' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'penjualan', label: 'Penjualan' },
  { id: 'keuangan', label: 'Keuangan' },
  { id: 'master', label: 'Data Master' },
  { id: 'pengaturan', label: 'Pengaturan' },
  { id: 'referensi', label: 'Referensi' },
];

const ADMIN_SECTIONS: GuideSection[] = [
  {
    id: 'mulai', group: 'mulai', title: 'Mulai',
    keywords: ['login', 'sandi', 'password', 'notifikasi', 'sidebar', 'menu', 'keluar'],
    blocks: [
      {
        kind: 'steps', title: 'Masuk dan keluar',
        items: [
          'Buka aplikasi, login dengan username dan sandi Admin.',
          'Ganti sandi: tombol Ganti sandi di bawah sidebar.',
          'Keluar: tombol Keluar di bawah sidebar.',
        ],
      },
      {
        kind: 'table', title: 'Menu sidebar Admin', head: ['Grup', 'Menu'],
        rows: [
          ['Dashboard', 'Dashboard'],
          ['Pembelian', 'Permintaan Pembelian'],
          ['Inventory', 'Stok Barang, Retur Barang, Stok Opname, Pergerakan Stok'],
          ['Inventory (opsional)', 'Stok Eksisting Toko, Transfer Stok'],
          ['Penjualan', 'Data struk penjualan'],
          ['Keuangan', 'Laporan Kasir Jaga, Setoran Masuk, Laporan Piutang, Laporan Keuangan'],
          ['Data Master', 'Kategori, Supplier, Data Debitur'],
          ['Pengaturan', 'Pengaturan'],
          ['Panduan', 'Panduan'],
        ],
      },
      { kind: 'note', tone: 'info', text: 'Kasir, Kasir Jaga, dan Penerimaan Barang khusus role Kasir.' },
      {
        kind: 'list', title: 'Tanda di layar',
        items: [
          'Lonceng di kepala sidebar: notifikasi. Tandai semua terbaca tersedia di panel.',
          'Pengingat kedaluwarsa tampil di atas layar bila ada produk lewat atau mendekati kedaluwarsa. Tutup dengan ✕.',
        ],
      },
    ],
  },
  {
    id: 'persiapan', group: 'mulai', title: 'Persiapan awal',
    keywords: ['setup', 'awal', 'urutan', 'toko baru', 'onboarding'],
    blocks: [
      {
        kind: 'steps', title: 'Urutan siap pakai',
        items: [
          'Pengaturan > Nama toko: isi nama toko.',
          'Pengaturan > Pengguna: tambah akun Kasir.',
          'Pengaturan > Mesin kasir: tambah mesin kasir.',
          'Pengaturan > Uang yang disisakan di laci: tentukan jumlah yang ditinggalkan dan aturan pembulatan setoran.',
          'Pengaturan > Cara mengonfirmasi persetujuan: pilih kata sandi, kunci pribadi, atau keduanya.',
          'Pengaturan > Akun pemilik toko untuk pembelian: pilih akun yang menyetujui permintaan pembelian.',
          'Pengaturan > Rekening bank: isi rekening untuk PO (maks. 5).',
          'Pengaturan > PPN: isi tarif dan status harga.',
          'Data Master > Kategori, lalu Supplier.',
          'Stok Barang > Produk baru: isi supplier, harga jual, Harga Modal, batas stok; status Aktif.',
          'Stok awal: aktifkan menu Stok awal toko di Pengaturan > Menu stok.',
          'Data Debitur: daftarkan debitur, isi batas kredit.',
          'Laporan Piutang > Tagihan Bulan Berjalan: Buka periode.',
        ],
      },
      { kind: 'note', tone: 'warn', text: 'Tanpa batas kredit dan periode terbuka, transaksi kredit tidak dapat diproses.' },
      { kind: 'note', tone: 'warn', text: 'Buat PO membutuhkan akun Owner PO, rekening, supplier, dan item.' },
    ],
  },
  {
    id: 'dashboard', group: 'mulai', title: 'Dashboard',
    menu: { to: '/dashboard', label: 'Dashboard' },
    keywords: ['ringkasan', 'laporan', 'kartu', 'periode', 'tanggal'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Isi Tanggal awal dan Tanggal akhir.',
          'Klik Terapkan.',
          'Baca kartu ringkasan; klik kartu untuk membuka menunya.',
        ],
      },
      {
        kind: 'table', head: ['Kartu', 'Periode'],
        rows: [
          ['Barang Masuk & Keluar', 'Tanggal filter'],
          ['Laporan Kasir Jaga', 'Tanggal filter'],
          ['Tagihan Bulan Berjalan', 'Bulan berjalan'],
          ['Tagihan Tahun Berjalan', 'Tahun berjalan'],
          ['Retur Supplier', 'Semua retur'],
        ],
      },
    ],
  },

  {
    id: 'permintaan-pembelian', group: 'pembelian', title: 'Permintaan Pembelian',
    menu: { to: '/purchase-requisitions', label: 'Permintaan Pembelian' },
    keywords: ['pr', 'po', 'purchase order', 'permintaan', 'pemesanan', 'owner', 'supplier', 'cetak', 'kirim', 'finance'],
    blocks: [
      {
        kind: 'table', title: 'Tab', head: ['Tab', 'Isi'],
        rows: [
          ['Permintaan Pembelian', 'Permintaan baru, status Belum Diperiksa'],
          ['Buat Pemesanan', 'Permintaan siap dibuatkan PO'],
          ['Cetak Dokumen', 'PO untuk dicetak, dikirim, dan dipantau penerimaannya'],
        ],
      },
      {
        kind: 'steps', title: 'Periksa Permintaan',
        items: [
          'Tab Permintaan Pembelian: klik Cek pada Permintaan.',
          'Periksa barang, jumlah, dan alasan.',
          'Lanjutkan: Permintaan pindah ke tab Buat Pemesanan.',
          'Kembali: isi Catatan keputusan (wajib), klik Kembalikan Permintaan.',
        ],
      },
      {
        kind: 'steps', title: 'Buat PO',
        items: [
          'Tab Buat Pemesanan: klik Buat PO.',
          'Pilih Supplier.',
          'Pilih Termin pembayaran; isi Jumlah hari TOP bila termin TOP.',
          'Isi Tanggal PO dan Permintaan tiba.',
          'Atur jumlah tiap item (maks. sesuai sisa Permintaan).',
          'Pilih Rekening.',
          'Persetujuan Owner: isi Nama Owner dan Password Owner atau Kunci otorisasi, sesuai mode.',
          'Klik Lanjutkan. PO langsung disetujui dan pindah ke tab Cetak Dokumen.',
        ],
      },
      {
        kind: 'steps', title: 'Cetak dan kirim PO',
        items: [
          'Tab Cetak Dokumen: klik Cetak & konfirmasi kirim.',
          'Klik Cetak PO.',
          'Klik Konfirmasi sudah dikirim ke supplier (aktif setelah dicetak).',
          'Pantau kolom Penerimaan sampai Diterima.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Satu PO untuk satu supplier; supplier berbeda dibuat PO terpisah.',
          'Hanya produk yang terkait supplier terpilih yang dapat dipesan.',
          'Permintaan otomatis berlabel Otomatis · pemantauan stok; tidak dapat diubah atau dibatalkan manual.',
          'Permintaan otomatis dibuat untuk produk Aktif dengan stok ≤ ambang dan Jumlah isi ulang > 0.',
          'Produk yang sudah tercakup Permintaan atau PO aktif tidak diminta ulang.',
          'Permintaan dengan status Disetujui atau Selesai dipesan dapat dicetak.',
          'Dokumen Dikembalikan, Ditolak, Dibatalkan, atau Selesai dipesan keluar dari papan.',
          'Penerimaan barang dicatat Kasir, bukan Admin.',
        ],
      },
      {
        kind: 'table', title: 'Status Permintaan', head: ['Status', 'Arti'],
        rows: [
          ['Draft', 'Belum diajukan'],
          ['Belum Diperiksa', 'Menunggu pemeriksaan'],
          ['Disetujui', 'Siap dibuat PO'],
          ['Dikembalikan', 'Dikembalikan dengan catatan'],
          ['Ditolak', 'Tidak dilanjutkan'],
          ['Selesai dipesan', 'Seluruh jumlah sudah dipesan'],
          ['Dibatalkan', 'Dibatalkan'],
        ],
      },
      {
        kind: 'table', title: 'Status PO', head: ['Status', 'Arti'],
        rows: [
          ['Dikirim ke supplier', 'PO sudah dikirim'],
          ['Diterima sebagian', 'Sebagian barang diterima'],
          ['Diterima', 'Seluruh barang diterima'],
          ['Dibatalkan', 'Dibatalkan'],
        ],
      },
    ],
  },

  {
    id: 'stok-barang', group: 'inventory', title: 'Stok Barang',
    menu: { to: '/products', label: 'Stok Barang' },
    keywords: ['produk', 'sku', 'barcode', 'harga', 'kartu stok', 'status', 'kedaluwarsa', 'min stok', 'kritis'],
    blocks: [
      {
        kind: 'steps', title: 'Cari dan filter',
        items: [
          'Cari nama, SKU, atau barcode.',
          'Filter Semua kategori dan Semua status.',
          'Klik Stok untuk kartu stok produk.',
          'Klik Ubah untuk mengubah produk.',
        ],
      },
      {
        kind: 'steps', title: 'Produk baru',
        items: [
          'Klik Produk baru.',
          'Isi Nama produk. SKU dan barcode boleh kosong (otomatis).',
          'Pilih Supplier (wajib, boleh lebih dari satu), Kategori, Satuan.',
          'Isi Harga jual dan Harga Modal.',
          'Isi Batas minimum, Batas kritis, Jumlah isi ulang.',
          'Centang Lacak tanggal kadaluarsa bila produk memiliki kedaluwarsa.',
          'Simpan.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'SKU dan barcode tidak dapat diubah setelah dibuat.',
          'Produk dari Kasir berstatus Menunggu harga dan belum bisa dijual. Isi harga, set status Aktif.',
          'Produk yang masih memiliki stok tidak dapat dinonaktifkan.',
          'PPN aktif dan harga termasuk PPN: isi Harga jual + PPN (harga akhir).',
          'Jumlah isi ulang 0: Permintaan otomatis tidak dibuat.',
          'Penjualan memakai FEFO untuk produk berlacak kedaluwarsa.',
          'Harga hanya Admin yang dapat mengubah.',
        ],
      },
      {
        kind: 'table', title: 'Tanda stok', head: ['Tanda', 'Arti'],
        rows: [
          ['Hampir habis', 'Stok ≤ Batas minimum'],
          ['Kritis', 'Stok di bawah Batas kritis'],
          ['Hampir kedaluwarsa', 'Mendekati tanggal kedaluwarsa'],
          ['Fast Moving / Slow Moving', 'Kecepatan perputaran stok'],
          ['Tanpa tanggal / Tidak dilacak', 'Produk tanpa pelacakan kedaluwarsa'],
        ],
      },
    ],
  },
  {
    id: 'retur-barang', group: 'inventory', title: 'Retur Barang',
    menu: { to: '/supplier-returns', label: 'Retur Barang' },
    keywords: ['retur', 'supplier', 'rusak', 'kembali'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Stok Barang: centang produk yang diretur (supplier harus sama).',
          'Klik Retur (jumlah produk terpilih). Form Buat Retur Barang terbuka.',
          'Pilih Supplier.',
          'Isi Jumlah barang (maks. sesuai stok tersedia).',
          'Isi Catatan bila perlu.',
          'Klik Buat Retur.',
          'Detail retur: Cetak atau Tutup.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Retur langsung mengurangi stok.',
          'Retur membuat Permintaan otomatis sesuai jumlah retur.',
          'Supplier tetap dipilih saat membuat PO.',
        ],
      },
    ],
  },
  {
    id: 'stok-eksisting', group: 'inventory', title: 'Stok Eksisting Toko',
    menu: { to: '/inventory/opening', label: 'Stok Eksisting Toko' },
    keywords: ['stok awal', 'opening', 'saldo awal', 'menu inventory'],
    blocks: [
      { kind: 'note', tone: 'info', text: 'Tersembunyi sejak awal. Aktifkan di Pengaturan > Menu stok.' },
      {
        kind: 'steps',
        items: [
          'Klik Tambah baris.',
          'Pilih Produk; isi Qty dan Harga Modal / satuan.',
          'Isi tanggal Kadaluarsa untuk produk berlacak kedaluwarsa.',
          'Isi Catatan dokumen (opsional).',
          'Klik Periksa dan simpan, lalu konfirmasi.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Satu dokumen berisi banyak baris. Satu baris ditolak, tidak ada yang tersimpan.',
          'Produk yang sudah punya pergerakan stok tidak dapat diisi. Gunakan Stok Opname.',
        ],
      },
    ],
  },
  {
    id: 'transfer-stok', group: 'inventory', title: 'Transfer Stok',
    menu: { to: '/inventory/transfers', label: 'Transfer Stok' },
    keywords: ['transfer', 'lokasi', 'gudang', 'rak', 'pindah'],
    blocks: [
      { kind: 'note', tone: 'info', text: 'Tersembunyi sejak awal. Aktifkan di Pengaturan > Menu stok.' },
      {
        kind: 'steps',
        items: [
          'Klik Buat transfer.',
          'Pilih Lokasi asal dan Lokasi tujuan.',
          'Isi produk dan jumlah, simpan sebagai Draft.',
          'Buka Detail, lalu posting.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Draft belum mengubah stok. Stok berubah setelah diposting.',
          'Lokasi Gudang tersedia setelah Gudang diaktifkan di Pengaturan.',
        ],
      },
    ],
  },
  {
    id: 'stok-opname', group: 'inventory', title: 'Stok Opname',
    menu: { to: '/inventory/adjustments', label: 'Stok Opname' },
    keywords: ['opname', 'hitung', 'selisih', 'rekonsiliasi', 'pemutihan', 'koreksi', 'final stok', 'adjustment'],
    blocks: [
      {
        kind: 'table', title: 'Tab', head: ['Tab', 'Isi'],
        rows: [
          ['Hitung Stok', 'Mulai opname, lanjutkan sesi, draft hasil'],
          ['Final Stok', 'Riwayat opname yang sudah disetujui dan perubahan stok per produk'],
        ],
      },
      {
        kind: 'steps', title: 'Hitung',
        items: [
          'Hitung Stok: klik Mulai Opname.',
          'Cari produk atau scan barcode.',
          'Isi hitungan fisik, klik OK (Enter juga menyimpan). Bila tampil kolom Bagus dan Rusak, isi keduanya.',
          'Pantau tab Belum dan Sudah serta progres.',
          'Produk tidak ditemukan dihitung 0.',
          'Semua produk terhitung: klik Lanjutkan, lalu Selesai. Sesi menjadi Draft.',
        ],
      },
      {
        kind: 'steps', title: 'Setujui',
        items: [
          'Hitung Stok: buka sesi Draft dari daftar.',
          'Cetak untuk hasil sementara, atau klik Periksa.',
          'Tiap produk berselisih: pilih Pemutihan atau Koreksi stok, isi alasan.',
          'Klik Lanjutkan.',
          'Persetujuan Owner: isi username dan password (akun Admin pada model Simple).',
          'Klik Setujui. Hasil tercatat di tab Final Stok.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Lanjutkan nonaktif selama masih ada produk belum dihitung.',
          'Tanpa selisih, persetujuan tetap diperlukan tanpa rekonsiliasi stok.',
          'Batal hanya saat menghitung; melepas kunci transaksi produk.',
          'Selisih bernilai besar, Harga Modal tidak tersedia, dan opname pertama membutuhkan persetujuan Admin atau Owner.',
          'Angka stok sistem disembunyikan atau ditampilkan lewat Pengaturan > Opname. Disarankan disembunyikan.',
          'Jangan logout selama hitungan belum tersimpan.',
        ],
      },
      {
        kind: 'table', title: 'Tindakan rekonsiliasi', head: ['Tindakan', 'Dipakai untuk'],
        rows: [
          ['Pemutihan', 'Selisih dicatat sebagai penghapusan (write-off)'],
          ['Koreksi stok', 'Selisih dicatat sebagai koreksi stok'],
        ],
      },
    ],
  },
  {
    id: 'pergerakan-stok', group: 'inventory', title: 'Pergerakan Stok',
    menu: { to: '/inventory/movements', label: 'Pergerakan Stok' },
    keywords: ['riwayat', 'movement', 'masuk', 'keluar', 'hpp', 'kartu stok'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Filter produk, Semua jenis, Dari tanggal, Sampai tanggal.',
          'Baca Waktu (WIB), Jenis, Produk, Kedaluwarsa, Arah, Qty, Oleh.',
          'Dari Stok Barang: Stok > Lihat riwayat pergerakan membuka filter produk.',
        ],
      },
      {
        kind: 'table', title: 'Jenis', head: ['Jenis', 'Sumber'],
        rows: [
          ['Stok eksisting toko', 'Stok Eksisting Toko'],
          ['Penerimaan barang', 'Penerimaan oleh Kasir'],
          ['Penempatan rak, Transfer', 'Transfer Stok'],
          ['Penjualan, Pembatalan penjualan', 'Kasir'],
          ['Retur ke supplier', 'Retur Barang'],
          ['Penggantian supplier', 'Pengganti retur'],
          ['Adjustment, Penghapusan (write-off)', 'Stok Opname'],
        ],
      },
      { kind: 'note', tone: 'info', text: 'Kolom HPP hanya tampil bagi pengguna yang berhak.' },
    ],
  },

  {
    id: 'data-struk', group: 'penjualan', title: 'Data struk penjualan',
    menu: { to: '/sales', label: 'Data struk penjualan' },
    keywords: ['struk', 'penjualan', 'salinan', 'cetak ulang', 'tunai', 'kredit', 'pengecualian'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Isi Nomor struk, Status Pembayaran (Tunai atau Kredit potong gaji), Transaksi dari dan sampai.',
          'Klik Terapkan filter. Bersihkan mengosongkan filter.',
          'Klik transaksi untuk Detail penjualan.',
          'Cetak SALINAN untuk cetak ulang struk.',
        ],
      },
      {
        kind: 'steps', title: 'Pengecualian kredit (di layar Kasir)',
        items: [
          'Dialog Melebihi batas kredit muncul saat kredit melewati batas.',
          'Admin isi Username Admin dan Password Admin.',
          'Isi Catatan pengecualian (wajib).',
          'Klik Setujui dan proses. Transaksi berlabel “melebihi batas”.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Cetak ulang selalu berlabel SALINAN dan tercatat.',
          'Struk tidak memiliki status atau pembatalan.',
          'Penjualan dilakukan Kasir. Admin hanya melihat data struk.',
        ],
      },
    ],
  },

  {
    id: 'laporan-kasir-jaga', group: 'keuangan', title: 'Laporan Kasir Jaga',
    menu: { to: '/shifts', label: 'Laporan Kasir Jaga' },
    keywords: ['shift', 'kasir jaga', 'selisih', 'periksa', 'laci', 'tutup'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Filter Semua status dan Dibuka dari / sampai.',
          'Baca Kasir, Mesin kasir, Dibuka, Diharapkan, Terhitung, Selisih.',
          'Klik Periksa pada kasir jaga berstatus Ditutup — menunggu pemeriksaan.',
          'Baca laporan dan keterangan kasir.',
          'Isi Catatan pemeriksaan (opsional; tercatat di audit log).',
          'Klik Tandai sudah diperiksa.',
        ],
      },
      {
        kind: 'table', title: 'Status', head: ['Status', 'Arti'],
        rows: [
          ['Berjalan', 'Kasir sedang jaga'],
          ['Penghitungan kas', 'Kasir menghitung uang laci'],
          ['Ditutup — menunggu pemeriksaan', 'Menunggu Admin'],
          ['Diperiksa', 'Selesai diperiksa'],
        ],
      },
      { kind: 'note', tone: 'warn', text: 'Ada selisih kas: baca keterangan kasir sebelum menandai diperiksa.' },
    ],
  },
  {
    id: 'setoran-masuk', group: 'keuangan', title: 'Setoran Masuk',
    menu: { to: '/cash-deposits', label: 'Setoran Masuk' },
    keywords: ['setoran', 'deposit', 'kas kecil', 'kas besar', 'endapan', 'selisih', 'koreksi'],
    blocks: [
      {
        kind: 'steps', title: 'Terima setoran',
        items: [
          'Antrean setoran: filter Menunggu penerimaan.',
          'Klik setoran untuk Detail setoran.',
          'Hitung uang fisik, isi Jumlah diterima (Rp).',
          'Isi Catatan penerimaan / selisih (wajib bila jumlah berbeda).',
          'Klik Catat penerimaan; setelah berhasil dialog tertutup dan saldo diperbarui.',
        ],
      },
      {
        kind: 'steps', title: 'Koreksi selisih',
        items: [
          'Filter Menunggu koreksi selisih.',
          'Buka detail, isi Alasan koreksi (wajib).',
          'Klik Periksa koreksi, lalu konfirmasi.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Penerimaan: Kas Kecil dikurangi sebesar setoran, Kas Besar ditambah sebesar jumlah diterima.',
          'Koreksi hanya menutup status selisih. Saldo tidak berubah.',
          'Saldo Kas Kecil dan Kas Besar tampil di atas halaman.',
        ],
      },
      {
        kind: 'table', title: 'Status', head: ['Status', 'Arti'],
        rows: [
          ['Draft — belum diserahkan', 'Kasir belum menyerahkan'],
          ['Diserahkan — menunggu Finance', 'Menunggu penerimaan'],
          ['Diterima Finance', 'Selesai'],
          ['Ada selisih — menunggu koreksi', 'Jumlah diterima berbeda'],
          ['Selisih dikoreksi', 'Selisih ditutup dengan alasan'],
        ],
      },
    ],
  },
  {
    id: 'laporan-piutang', group: 'keuangan', title: 'Laporan Piutang',
    menu: { to: '/billing', label: 'Laporan Piutang' },
    keywords: ['piutang', 'invoice', 'hrd', 'periode', 'tagihan', 'gaji', 'tutup tahun', 'pembayaran'],
    blocks: [
      {
        kind: 'table', title: 'Tab', head: ['Tab', 'Isi'],
        rows: [
          ['Tagihan Bulan Berjalan', 'Periode, rincian transaksi, buat invoice'],
          ['Rekap Data Piutang', 'Invoice, status, pembayaran'],
          ['Tutup Tahun', 'Laporan piutang tahunan'],
        ],
      },
      {
        kind: 'steps', title: 'Periode tagihan',
        items: [
          'Tagihan Bulan Berjalan: bila belum ada periode, isi Nama periode dan Tanggal gaji HRD (opsional), klik Buka periode.',
          'Klik Rincian periode untuk melihat Debitur, Transaksi, Jumlah.',
          'Hari gaji HRD: klik Tutup periode, konfirmasi. Periode berikutnya otomatis terbuka.',
          'Periode berstatus Ditutup: isi Ditagihkan kepada, klik Buat invoice.',
        ],
      },
      {
        kind: 'steps', title: 'Invoice',
        items: [
          'Rekap Data Piutang: pilih invoice di daftar.',
          'Cetak invoice untuk dokumen ke HRD.',
          'Draft: klik Terbitkan, konfirmasi.',
          'Diterbitkan: klik Tandai diserahkan ke HRD, konfirmasi.',
          'Saat HRD membayar: isi Jumlah pembayaran, tanggal diterima, referensi; klik Simpan pembayaran.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Struk kredit yang terikat periode tidak dapat dipindah.',
          'Periode tanpa struk kredit tidak dapat ditagihkan; periode kosong dapat dibatalkan.',
          'Satu invoice gabungan ke HRD dengan rincian per debitur.',
          'Pembayaran boleh sebagian. Sisa tagihan tampil di invoice.',
          'Belanja setelah tanggal tutup masuk periode berikutnya.',
          'Tanggal cetak laporan tahunan diatur di Pengaturan > Laporan piutang tahunan.',
        ],
      },
      {
        kind: 'table', title: 'Status invoice', head: ['Status', 'Arti'],
        rows: [
          ['Draft', 'Belum diterbitkan'],
          ['Diterbitkan', 'Siap diserahkan'],
          ['Diserahkan ke HRD', 'Menunggu pembayaran'],
          ['Dibayar sebagian', 'Sisa tagihan masih ada'],
          ['Lunas', 'Selesai'],
          ['Dibatalkan', 'Dibatalkan'],
        ],
      },
      {
        kind: 'table', title: 'Status periode', head: ['Status', 'Arti'],
        rows: [
          ['Terbuka', 'Menampung transaksi kredit'],
          ['Ditutup', 'Siap dibuatkan invoice'],
          ['Sudah dibuatkan invoice', 'Invoice sudah ada'],
          ['Dibatalkan', 'Periode kosong dibatalkan'],
        ],
      },
    ],
  },
  {
    id: 'laporan-keuangan', group: 'keuangan', title: 'Laporan Keuangan',
    menu: { to: '/financial', label: 'Laporan Keuangan' },
    keywords: ['laba', 'kas besar', 'biaya', 'gaji', 'pembayaran po', 'pdf', 'cetak'],
    blocks: [
      {
        kind: 'steps', title: 'Buat laporan',
        items: [
          'Isi Tanggal awal dan Tanggal akhir.',
          'Klik Buat laporan. Laporan siap dicetak atau disimpan PDF.',
        ],
      },
      {
        kind: 'steps', title: 'Bayar PO',
        items: [
          'Bagian Pembayaran PO: cari PO tertunggak.',
          'Isi jumlah, klik Bayar.',
        ],
      },
      {
        kind: 'steps', title: 'Catat biaya',
        items: [
          'Bagian Catat biaya: pilih Jenis (Biaya operasional atau Gaji karyawan).',
          'Isi Keterangan, Jumlah, Tanggal dibayar.',
          'Gaji: sebut nama karyawan dan periode di Keterangan.',
          'Klik Simpan.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Biaya dan pembayaran PO mengurangi Kas Besar saat dicatat.',
          'Pengeluaran tidak dapat melebihi saldo Kas Besar. Penerimaan barang yang melunasi PO otomatis tetap diposting.',
          'Pembayaran PO dapat dicicil, tidak boleh melebihi sisa PO.',
          'Laba bersih = laba kotor − biaya operasional − gaji − kerugian write-off retur.',
          'Pembayaran PO tampil sebagai kas keluar, tidak mengurangi laba bersih lagi.',
          'Catatan transaksi tidak dapat diedit atau dihapus.',
        ],
      },
    ],
  },

  {
    id: 'kategori', group: 'master', title: 'Kategori',
    menu: { to: '/categories', label: 'Kategori' },
    keywords: ['kategori', 'pohon', 'subkategori'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Klik Kategori baru; isi Nama kategori dan Induk kategori (kosong bila kategori utama).',
          'Klik Ubah untuk mengubah atau menonaktifkan.',
          'Tampilkan yang nonaktif untuk melihat kategori nonaktif.',
        ],
      },
      { kind: 'note', tone: 'info', text: 'Kategori dipakai untuk filter produk dan diskon kategori.' },
    ],
  },
  {
    id: 'supplier', group: 'master', title: 'Supplier',
    menu: { to: '/suppliers', label: 'Supplier' },
    keywords: ['supplier', 'pemasok', 'kontak', 'termin'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Klik Supplier baru; isi Kode, Nama supplier, Nama kontak, Telepon, Alamat.',
          'Cari kode atau nama; Hanya yang aktif menyaring daftar.',
          'Klik Ubah untuk mengubah atau menonaktifkan.',
        ],
      },
      { kind: 'note', tone: 'info', text: 'Supplier harus dihubungkan ke produk agar produk dapat dipesan.' },
    ],
  },
  {
    id: 'data-debitur', group: 'master', title: 'Data Debitur',
    menu: { to: '/customers', label: 'Data Debitur' },
    keywords: ['debitur', 'karyawan', 'kredit', 'batas kredit', 'arsip', 'ktp', 'hrd'],
    blocks: [
      {
        kind: 'steps', title: 'Daftarkan debitur',
        items: [
          'Klik Debitur baru.',
          'Isi Nomor KTP, Nomor Induk Karyawan, Nama Lengkap Sesuai KTP, Nomor Telepon/HP.',
          'Isi Alamat dan Domisili, Perusahaan, Mulai Bekerja, Status Karyawan.',
          'Isi Nama dan telepon HRD, Nama dan telepon Atasan Langsung.',
          'Klik Daftarkan debitur.',
          'Klik Cetak bukti; ditandatangani pemohon, atasan, HRD, dan perusahaan.',
        ],
      },
      {
        kind: 'steps', title: 'Batas kredit dan arsip',
        items: [
          'Klik Detail pada debitur.',
          'Klik Isi batas kredit atau Ubah batas kredit.',
          'Riwayat batas kredit tampil di detail.',
          'Debitur keluar: Arsipkan debitur. Pulihkan dari arsip di tab Arsip.',
        ],
      },
      {
        kind: 'table', title: 'Status kredit', head: ['Status', 'Arti'],
        rows: [
          ['Batas belum diisi', 'Kredit belum dapat dipakai'],
          ['Kredit tersedia', 'Dapat memakai kredit sesuai sisa batas bulan ini'],
          ['Batas habis', 'Tawarkan tunai; pengecualian oleh Admin'],
          ['Diarsipkan', 'Tidak dapat dipilih untuk transaksi baru'],
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Pendaftaran dan perubahan data hanya oleh Admin.',
          'Arsip mempertahankan riwayat transaksi dan tagihan.',
          'Kasir hanya mencari dan memilih debitur terdaftar.',
        ],
      },
    ],
  },

  {
    id: 'pengaturan', group: 'pengaturan', title: 'Layar Pengaturan',
    menu: { to: '/settings', label: 'Pengaturan' },
    keywords: ['pengaturan', 'konfigurasi', 'settings'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Cari bagian lewat kotak Cari pengaturan atau indeks di kiri.',
          'Klik judul bagian untuk membuka. Buka semua dan Tutup semua tersedia.',
          'Ubah, lalu Simpan di dalam bagian itu.',
        ],
      },
      {
        kind: 'table', title: 'Bagian', head: ['Bagian', 'Fungsi'],
        rows: [
          ['Nama toko', 'Nama toko yang tampil'],
          ['Pembagian tugas toko', 'Toko sederhana atau toko dengan pembagian tugas'],
          ['Gudang', 'Aktif atau nonaktif'],
          ['Pemantauan stok', 'Batas stok untuk permintaan pembelian otomatis'],
          ['Pemasok pesanan pembelian', 'Cara memilih pemasok untuk pesanan pembelian'],
          ['Pemilik toko untuk persetujuan pembelian', 'Akun yang menyetujui permintaan pembelian'],
          ['Menu stok', 'Tampilkan menu stok awal dan pemindahan stok'],
          ['Rekening bank', 'Rekening pada pesanan pembelian, maks. 5; saldo tidak disimpan'],
          ['Akses untuk mengelola stok', 'Peran yang boleh melakukan kegiatan stok'],
          ['Penghitungan stok', 'Jumlah stok di sistem, pengingat, dan persetujuan hasil hitung'],
          ['PPN', 'Tarif, status harga, tanggal berlaku'],
          ['Diskon', 'Diskon produk atau kategori'],
          ['Uang yang disisakan di laci', 'Jumlah yang ditinggalkan dan disetorkan saat kasir jaga ditutup'],
          ['Mesin kasir', 'Mesin dan laci kas'],
          ['Pengguna', 'Akun, peran, status, dan sandi'],
          ['Cara mengonfirmasi persetujuan', 'Pilih cara konfirmasi dan kelola kunci pribadi'],
          ['Laporan piutang tahunan', 'Tanggal cetak laporan tahunan'],
        ],
      },
    ],
  },
  {
    id: 'pengguna', group: 'pengaturan', title: 'Pengguna',
    menu: { to: '/settings#users', label: 'Pengaturan > Pengguna' },
    keywords: ['akun', 'user', 'kasir', 'role', 'reset sandi', 'nonaktif', 'username'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Klik Tambah pengguna; isi data, role, sandi.',
          'Cari pengguna berdasarkan nama, nama pengguna, peran, atau status.',
          'Klik Ubah untuk mengubah data, peran, atau status Aktif/Nonaktif.',
          'Klik Atur sandi baru; isi sandi baru (8–255 karakter).',
        ],
      },
      { kind: 'note', tone: 'warn', text: 'Reset sandi mengakhiri semua sesi aktif pengguna itu.' },
    ],
  },
  {
    id: 'model-administrasi', group: 'pengaturan', title: 'Pembagian tugas toko',
    menu: { to: '/settings#admin-model', label: 'Pengaturan > Pembagian tugas toko' },
    keywords: ['simple', 'standar retail', 'owner', 'finance', 'purchasing', 'accounting', 'role'],
    blocks: [
      {
        kind: 'table', head: ['Pembagian tugas', 'Peran'],
        rows: [
          ['Toko sederhana', 'Admin dan Kasir'],
          ['Toko dengan pembagian tugas', 'Kasir, Keuangan (Finance), Pembelian (Purchasing), Pembukuan (Accounting), Pemilik toko (Owner)'],
        ],
      },
      {
        kind: 'steps', title: 'Beralih model',
        items: [
          'Pilih pembagian tugas yang diinginkan dan periksa akun yang perlu disiapkan.',
          'Pastikan setiap peran yang diminta memiliki akun aktif.',
          'Klik Beralih, centang Saya mengerti dampak perubahan ini, lalu konfirmasi.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Saat beralih, akun Admin dan Pemilik toko (Owner) akan saling menggantikan.',
          'Perubahan berlaku seketika. Menu dan akses semua pengguna, termasuk Anda, mengikuti peran baru.',
          'Panduan ini untuk Admin pada toko sederhana.',
        ],
      },
    ],
  },
  {
    id: 'otorisasi', group: 'pengaturan', title: 'Cara mengonfirmasi persetujuan',
    menu: { to: '/settings#approval-auth', label: 'Pengaturan > Cara mengonfirmasi persetujuan' },
    keywords: ['kunci', 'kode', 'passphrase', 'password', 'reauth', 'persetujuan', 'owner'],
    blocks: [
      {
        kind: 'table', title: 'Pilihan cara konfirmasi', head: ['Cara konfirmasi', 'Yang dimasukkan pengguna'],
        rows: [
          ['Kata sandi akun', 'Nama pengguna dan kata sandi akun'],
          ['Kunci pribadi', 'Nama pengguna dan kunci pribadi'],
          ['Kata sandi dan kunci', 'Nama pengguna, kata sandi akun, dan kunci pribadi'],
        ],
      },
      {
        kind: 'steps', title: 'Ubah cara konfirmasi',
        items: [
          'Pastikan semua pengguna yang perlu menyetujui sudah memiliki kunci aktif bila memilih cara yang memakai kunci.',
          'Pilih cara konfirmasi, isi kata sandi akun, lalu simpan.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Kunci bersifat pribadi. Pengelola hanya dapat melihat status atau menonaktifkannya.',
          'Kunci berupa kode atau kalimat sandi rahasia.',
          'Untuk menghapus kunci, masukkan kata sandi akun.',
          'Berlaku untuk persetujuan pembelian, perubahan stok tertentu, dan pengecualian penjualan kredit.',
        ],
      },
    ],
  },
  {
    id: 'kebijakan-endapan', group: 'pengaturan', title: 'Uang yang disisakan di laci',
    menu: { to: '/settings#float-policy', label: 'Pengaturan > Uang yang disisakan di laci' },
    keywords: ['endapan', 'laci', 'setoran', 'pembulatan', 'persen', 'nominal'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Pilih jumlah tetap atau persentase untuk menentukan uang yang disisakan.',
          'Untuk jumlah tetap, isi Jumlah yang disisakan (Rp).',
          'Untuk persentase, pilih apakah perhitungannya berdasarkan penjualan tunai atau uang di laci.',
          'Isi batas minimum dan maksimum jika diperlukan.',
          'Atur kelipatan pembulatan setoran; awalnya Rp1.000.',
          'Klik Simpan aturan.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Berlaku untuk penutupan kasir jaga berikutnya.',
          'Jumlah setoran dibulatkan ke bawah; sisanya tetap di laci.',
          'Uang yang disisakan menjadi saldo awal kasir jaga berikutnya.',
          'Jika aturan belum diisi, semua uang yang dihitung tetap di laci dan tidak ada setoran akhir.',
        ],
      },
    ],
  },
  {
    id: 'mesin-kasir', group: 'pengaturan', title: 'Mesin kasir',
    menu: { to: '/settings#registers', label: 'Pengaturan > Mesin kasir' },
    keywords: ['register', 'laci', 'mesin', 'kasir jaga'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Isi Nama mesin kasir, klik Tambah mesin kasir.',
          'Klik Ubah untuk mengganti nama.',
          'Klik Nonaktifkan atau Aktifkan.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Tiap mesin memiliki saldo Kas Kecil sendiri.',
          'Mesin dengan Shift berjalan harus ditutup dahulu sebelum dinonaktifkan.',
          'Mesin tidak dihapus; riwayat dan saldo tetap tersimpan.',
        ],
      },
    ],
  },
  {
    id: 'pemantauan-stok', group: 'pengaturan', title: 'Pemantauan stok',
    menu: { to: '/settings#stock-monitoring', label: 'Pengaturan > Pemantauan stok' },
    keywords: ['ambang', 'menipis', 'restock', 'permintaan otomatis', 'reset po'],
    blocks: [
      {
        kind: 'steps', title: 'Batas stok',
        items: [
          'Isi Batas stok rendah.',
          'Klik Simpan perubahan, lalu Simpan batas.',
        ],
      },
      {
        kind: 'steps', title: 'Batalkan atau tutup pesanan pembelian',
        items: [
          'Pilih rentang waktu yang ingin diperiksa.',
          'Klik Tinjau pesanan untuk melihat pesanan yang akan dibatalkan atau ditutup.',
          'Periksa rinciannya, lalu klik Konfirmasi pembatalan.',
        ],
      },
      {
        kind: 'list', title: 'Aturan',
        items: [
          'Barang dengan stok sama dengan atau kurang dari batas dan jumlah isi ulang di atas 0 masuk ke permintaan pembelian otomatis.',
          'Mengubah batas akan memperbarui draf permintaan pembelian otomatis.',
          'Pesanan dibatalkan atau ditutup, tetapi catatannya tidak dihapus.',
        ],
      },
    ],
  },
  {
    id: 'kewenangan-stok', group: 'pengaturan', title: 'Akses untuk mengelola stok',
    menu: { to: '/settings#stock-authority', label: 'Pengaturan > Akses untuk mengelola stok' },
    keywords: ['kewenangan', 'wewenang', 'role', 'stok awal', 'penerimaan', 'transfer', 'adjustment'],
    blocks: [
      {
        kind: 'steps',
        items: [
          'Pilih peran yang boleh melakukan setiap kegiatan stok. Pilih setidaknya satu peran untuk tiap kegiatan.',
          'Kembalikan ke awal untuk memakai pengaturan yang disarankan.',
          'Klik Simpan akses stok, lalu Ya, simpan.',
        ],
      },
      { kind: 'note', tone: 'info', text: 'Perubahan langsung berlaku dan tercatat. Pengguna yang tidak lagi memiliki akses tidak akan melihat menu atau tombol terkait.' },
    ],
  },
  {
    id: 'ppn-diskon', group: 'pengaturan', title: 'PPN dan Diskon',
    menu: { to: '/settings#vat', label: 'Pengaturan > PPN' },
    keywords: ['ppn', 'pajak', 'pkp', 'diskon', 'promo', 'potongan'],
    blocks: [
      {
        kind: 'list', title: 'PPN',
        items: [
          'Isi tarif, status harga, dan tanggal berlaku.',
          'Harga jual produk sudah termasuk PPN bila status harga inklusif.',
          'PPN aktif tetapi belum lengkap: transaksi kasir ditolak.',
          'Tidak mengubah harga master dan tidak membulatkan total.',
        ],
      },
      {
        kind: 'steps', title: 'Diskon',
        items: [
          'Klik Diskon baru.',
          'Isi Nama diskon, Berlaku untuk (produk atau kategori), Jenis potongan, nilai.',
          'Isi Mulai dan Berakhir (tanggal WIB); kosong = mulai sekarang.',
          'Simpan.',
        ],
      },
      {
        kind: 'list', title: 'Aturan diskon',
        items: [
          'Hanya Admin yang mengatur diskon.',
          'Di kasir, diskon berlaku terbesar dipilih otomatis.',
          'Target diskon tidak dapat diubah; buat diskon baru.',
        ],
      },
    ],
  },
  {
    id: 'pengaturan-lain', group: 'pengaturan', title: 'Pengaturan lain',
    menu: { to: '/settings', label: 'Pengaturan' },
    keywords: ['gudang', 'rekening', 'bank', 'opname', 'menu inventory', 'owner po', 'supplier po'],
    blocks: [
      {
        kind: 'table', head: ['Bagian', 'Cara'],
        rows: [
          ['Gudang', 'Klik Aktifkan Gudang atau Nonaktifkan Gudang, konfirmasi.'],
          ['Menu stok', 'Centang Stok awal toko dan Pemindahan stok, lalu klik Simpan pengaturan.'],
          ['Rekening bank', 'Isi Nama bank, Nama pemilik rekening, Nomor rekening. Maks. 5 termasuk yang nonaktif. Centang Aktif untuk dipilih pada PO.'],
          ['Akun pemilik toko untuk pembelian', 'Pilih akun pemilik toko yang menyetujui permintaan pembelian.'],
          ['Pemasok pesanan pembelian', 'Pilih pemasok dari daftar atau gunakan pemasok yang tercatat pada barang.'],
          ['Penghitungan stok', 'Atur tampilan jumlah stok di sistem, pengingat, dan batas persetujuan hasil hitung.'],
          ['Nama toko', 'Ubah nama, simpan.'],
          ['Laporan piutang tahunan', 'Isi Bulan dan tanggal cetak, simpan.'],
        ],
      },
    ],
  },

  {
    id: 'rutinitas', group: 'referensi', title: 'Ringkasan alur',
    keywords: ['alur', 'rutinitas', 'harian', 'bulanan', 'checklist'],
    blocks: [
      {
        kind: 'table', head: ['Kapan', 'Kerjakan'],
        rows: [
          ['Kasir jaga ditutup', 'Laporan Kasir Jaga: periksa. Setoran Masuk: terima, koreksi selisih.'],
          ['Permintaan masuk', 'Permintaan Pembelian: Cek, Buat PO, Cetak, konfirmasi kirim.'],
          ['Barang diterima Kasir', 'Pergerakan Stok: pastikan stok bertambah. Retur Barang bila ada barang rusak.'],
          ['Produk baru dari Kasir', 'Stok Barang: isi harga, set Aktif.'],
          ['Opname dijadwalkan', 'Stok Opname: Mulai Opname, hitung, Periksa, Setujui.'],
          ['Hari gaji HRD', 'Laporan Piutang: Tutup periode, Buat invoice, Terbitkan, serahkan ke HRD.'],
          ['HRD membayar', 'Laporan Piutang: Simpan pembayaran.'],
          ['Akhir tahun', 'Laporan Piutang > Tutup Tahun: cetak laporan.'],
        ],
      },
    ],
  },
  {
    id: 'istilah', group: 'referensi', title: 'Istilah',
    keywords: ['istilah', 'glosarium', 'arti', 'fefo', 'endapan', 'hpp'],
    blocks: [
      {
        kind: 'table', head: ['Istilah', 'Arti'],
        rows: [
          ['Permintaan (PR)', 'Permintaan pembelian dari Kasir atau sistem'],
          ['PO', 'Purchase Order ke supplier'],
          ['Kasir Jaga', 'Sesi kerja kasir pada satu mesin kasir (shift)'],
          ['Endapan', 'Uang yang tetap di laci saat kasir jaga ditutup'],
          ['Setoran', 'Uang laci di atas endapan yang diserahkan ke Finance'],
          ['Kas Kecil / Kas Besar', 'Dana laci dan dana pusat'],
          ['Debitur', 'Karyawan pembeli kredit potong gaji'],
          ['Periode', 'Rentang tagihan kredit sampai hari gaji HRD'],
          ['FEFO', 'Barang yang lebih dulu kedaluwarsa dijual lebih dulu'],
          ['Harga Modal', 'Biaya per satuan; diperbarui dengan biaya stok masuk terbaru'],
          ['HPP', 'Harga pokok penjualan'],
          ['Hitung buta', 'Menghitung tanpa melihat angka stok sistem'],
          ['Pemutihan', 'Tindakan rekonsiliasi opname: write-off selisih'],
          ['Koreksi stok', 'Tindakan rekonsiliasi opname: koreksi selisih'],
          ['SALINAN', 'Label cetak ulang struk'],
        ],
      },
    ],
  },
  {
    id: 'masalah', group: 'referensi', title: 'Jika bermasalah',
    keywords: ['masalah', 'error', 'tidak bisa', 'nonaktif', 'ditolak', 'akses', 'troubleshooting'],
    blocks: [
      {
        kind: 'table', head: ['Gejala', 'Periksa'],
        rows: [
          ['Buat PO tidak aktif', 'Nama Owner PO, Rekening, Supplier, item, Jumlah hari TOP.'],
          ['Menu stok awal atau pemindahan stok tidak ada', 'Pengaturan > Menu stok.'],
          ['Kredit ditolak', 'Batas kredit debitur, periode tagihan terbuka, Batas habis.'],
          ['Produk tidak dapat dijual', 'Status Menunggu harga: isi harga, set Aktif.'],
          ['Lanjutkan opname nonaktif', 'Masih ada produk belum dihitung.'],
          ['Mesin kasir tidak dapat dinonaktifkan', 'Tutup Shift berjalan.'],
          ['Tidak ada akses', 'Periksa peran dan pengaturan akses stok pengguna.'],
          ['Menu berubah setelah pembagian tugas diubah', 'Pembagian tugas toko menentukan peran dan menu.'],
          ['Persetujuan pemilik toko ditolak', 'Periksa cara konfirmasi dan status kunci persetujuan.'],
          ['Produk tidak dapat dinonaktifkan', 'Produk masih memiliki stok.'],
        ],
      },
    ],
  },
];

export const GUIDES: Record<string, RoleGuide> = {
  Admin: {
    role: 'Admin',
    title: 'Panduan Admin',
    scope: 'Pembagian tugas toko sederhana',
    sections: ADMIN_SECTIONS,
  },
};

export const GUIDE_ROLES: string[] = Object.keys(GUIDES);

/** Panduan untuk role pertama pengguna yang memilikinya; null bila belum ada panduan untuk role tersebut. */
export function guideForRoles(roles: string[]): RoleGuide | null {
  const role = roles.find((candidate) => candidate in GUIDES);
  return role ? GUIDES[role] ?? null : null;
}

/** Cocokkan bagian dengan kata kunci pencarian (judul, kata kunci, isi blok). */
export function sectionMatches(section: GuideSection, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const texts: string[] = [section.title, ...section.keywords];
  for (const block of section.blocks) {
    if ('title' in block && block.title) texts.push(block.title);
    if (block.kind === 'steps' || block.kind === 'list') texts.push(...block.items);
    else if (block.kind === 'table') texts.push(...block.head, ...block.rows.flat());
    else texts.push(block.text);
  }
  return texts.some((text) => text.toLowerCase().includes(needle));
}

export function groupSections(sections: GuideSection[]): Array<{ id: GuideGroupId; label: string; sections: GuideSection[] }> {
  return GUIDE_GROUPS.flatMap((group) => {
    const inGroup = sections.filter((section) => section.group === group.id);
    return inGroup.length > 0 ? [{ ...group, sections: inGroup }] : [];
  });
}

export function sectionFromHash(hash: string, sections: GuideSection[]): string | null {
  const id = hash.replace(/^#/, '');
  return sections.find((section) => section.id === id)?.id ?? null;
}
