# Panduan Operator Stock Opname

Panduan singkat untuk Admin dan Owner POS Retail SMK.

## Sebelum mulai

1. Jadwalkan pekerjaan saat toko tutup atau transaksi dapat dihentikan. Sesi yang berjalan mengunci produk dalam cakupannya; jangan memulai cakupan yang tumpang tindih.
2. Pastikan produk dan kategori sudah benar, perangkat terisi daya, scanner Bluetooth tersambung, dan koneksi tersedia untuk memulai sesi.
3. Penghitungan dapat diteruskan saat sinyal putus sementara. Jangan logout atau menghapus data situs selama antrean hitungan belum tersinkron.
4. Untuk pairing, uji scanner, akhiran Enter/Tab, dan pemecahan masalah Bluetooth, ikuti [Panduan Scanner Bluetooth](./PANDUAN_SCANNER_BLUETOOTH.md).

## Memulai dan menghitung

1. Buka **Inventory → Adjustment & Opname → Opname**, lalu pilih **Mulai Opname**.
2. Pilih cakupan seluruh toko atau kategori, beri nama bila diperlukan, periksa ringkasan produk, lalu konfirmasi. Transaksi untuk produk dalam cakupan akan dikunci.
3. Pilih kategori/node kerja atau gunakan pencarian. Scan barcode untuk memilih produk; masukkan jumlah fisik yang ditemukan. Gunakan aksi **Ganti jumlah** atau **Tambah jumlah** dengan sengaja.
4. Produk yang tidak ditemukan tetap harus dihitung sebagai **0**. Jangan menyimpulkan jumlah fisik dari stok sistem.
5. Periksa progres dan pastikan semua produk selesai. Scanner bisa digunakan bersama input manual; pastikan fokus kembali ke layar hitung setelah dialog atau panel ditutup.

## Meninjau, mengajukan, dan memposting

1. Setelah hitungan lengkap, buka laporan dan tinjau total, kategori, serta produk berselisih.
2. Bila perlu koreksi, buka produk dan hitung ulang; riwayat hitungan mencatat revisi. Setelah koreksi, periksa kembali laporan.
3. Jika ambang atau aturan opname pertama mengharuskan persetujuan, ajukan sesi. Sesi berstatus **Menunggu persetujuan** dan stok tetap terkunci.
4. Buka kembali detail sesi dari daftar Opname. Tombol **Setujui dan posting** dan **Tolak** tersedia di panel laporan pada halaman detail untuk Admin (model sederhana) atau Owner (model standar). Pemberi persetujuan mengonfirmasi dengan password akunnya sendiri.
5. Sesi yang ditolak kembali untuk dihitung ulang; setelah koreksi, tinjau laporan dan ajukan lagi. Jika tidak ada persetujuan yang diperlukan, Admin atau Owner dapat memposting langsung.
6. Posting memperbarui stok dari hasil beku dan melepas lock. Pastikan layar menunjukkan status selesai sebelum toko kembali bertransaksi.

## Laporan, riwayat, dan ekspor

- Laporan menampilkan jumlah produk, kurang/lebih, dan nilai hanya bagi role yang berhak. Admin pada model sederhana memiliki kewenangan persetujuan serta dapat melihat/mengatur ambang; pada model standar kewenangan itu dipegang Owner. Accounting hanya melihat nilai jika memiliki izin `opname.view_value`.
- Di riwayat, pilih pengelompokan bulan, kuartal, tahun, atau semua. Gunakan filter status, hasil, cakupan, dan tanggal untuk mempersempit daftar.
- Produk sering berselisih dan tren membantu menemukan pola, tetapi bukan pengganti pemeriksaan fisik.
- Pada laporan, **Cetak** membuka dialog cetak peramban (pilih printer atau simpan sebagai PDF). Unduh CSV ringkasan untuk rekap kategori/subkategori atau CSV detail untuk baris selisih. Pilih koma atau titik koma untuk Excel Indonesia.
- Sesi yang sudah diposting adalah arsip baca-saja; gunakan sesi baru untuk opname berikutnya.

## Jika sinyal putus atau sesi macet

1. Biarkan halaman tetap terbuka dan lanjutkan hitung; operasi disimpan pada antrean perangkat dan disinkronkan ketika tersambung kembali.
2. Buka status sinkronisasi untuk melihat operasi tertunda/gagal. Coba ulang kegagalan setelah koneksi pulih; jangan menghapus antrean yang belum dipahami.
3. Posting tidak tersedia sampai perangkat online dan seluruh antrean kosong. Setelah tersinkron, segarkan progres dan pastikan jumlah produk dihitung sesuai.
4. Jika sesi tidak dapat dilanjutkan, pastikan tidak ada antrean tertunda, catat nomor sesi dan pesan yang tampil, lalu minta bantuan administrator. Batalkan sesi hanya bila yakin sesi tersebut tidak akan dilanjutkan; pembatalan melepas lock dan tidak dapat dipakai untuk posting.
