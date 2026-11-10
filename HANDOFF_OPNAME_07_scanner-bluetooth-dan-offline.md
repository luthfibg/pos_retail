# HANDOFF #7 — Penyempurnaan HP: Scanner Bluetooth, Kalibrasi, dan Hitungan Tahan Sinyal Buruk

Proyek: POS Retail SMK · Seri: Adjustment & Opname (Handoff #7 dari 8) · Dibuat: 10 November 2026 · Status: siap dikerjakan **setelah Handoff #6 selesai dan di-merge**

## 0. Ringkasan untuk agent yang baru bergabung

Handoff #2 sampai #6 membuat opname bisa dibuat, dihitung dengan scanner, dikunci, ditinjau, dan diposting. **Handoff #7 membuat pengalaman di HP andal untuk dipakai keliling rak**, dengan asumsi pengguna **memasangkan scanner Bluetooth ke HP**:

1. **Scanner Bluetooth andal di browser HP:** penangkap scan diperkuat, ada layar **'Uji scanner'** dengan **kalibrasi** per perangkat, dan layar tetap menyala selama menghitung.
2. **Hitungan tahan sinyal buruk:** toko berada di dalam pabrik dan jaringan bisa putus. Hitungan yang gagal terkirim **disimpan lokal dan disinkronkan otomatis** saat jaringan kembali, tanpa menggandakan hitungan.
3. **Ergonomi HP:** pencegahan gerakan tak sengaja (tarik-untuk-muat-ulang, zoom ganda), penanda status koneksi, dan pengaman agar hitungan yang belum tersinkron tidak hilang.

**Scan lewat kamera HP tidak termasuk handoff ini** (pengguna lebih memilih scanner Bluetooth). Hook penangkap scan dari Handoff #5 sudah menyiapkan `source: 'camera'` sehingga kamera dapat ditambahkan nanti tanpa mengubah rangkaian.

## 1. Konteks seri handoff

| # | Isi | Status |
|---|---|---|
| 1 | Kerangka halaman + tab Adjustment | Selesai |
| 2 | Sesi opname: buat, daftar, status, cakupan | Selesai |
| 3 | Kerangka layar opname + peta progres + pengaturan angka stok | Sedang dikerjakan |
| 4 | Input hitungan inti + penguncian transaksi | Berikutnya |
| 5 | Rangkaian hitung berfokus scanner | |
| 6 | Laporan opname + persetujuan Owner + Posting Opname | Prasyarat dokumen ini |
| **7** | **Scanner Bluetooth, kalibrasi, dan hitungan tahan sinyal buruk** | **Dokumen ini** |
| 8 | Riwayat per periode + penutup | |

## 2. Prasyarat dan urutan kerja

**Jangan mulai sebelum Handoff #3 sampai #6 selesai, lolos test, dan di-merge.** Handoff ini mengubah `useScannerCapture` (#5), `useCountMutation` dan alur simpan hitungan (#4), serta menyentuh layar sesi dan alur posting (#6).

Urutan: **Bagian A (backend, kecil) → Bagian B (scanner) dan Bagian C (antrean offline)**, lalu **Bagian D (ergonomi HP)**. Bagian B tidak bergantung pada Bagian A dan boleh dikerjakan lebih dulu atau paralel. Bagian C bergantung pada kontrak di 6.3.

## 3. Cakupan

**Termasuk:**
- Backend (kecil, aditif): endpoint indeks offline, endpoint hitungan massal (batch), kolom waktu klien pada log hitungan, pencocokan barcode tidak peka huruf besar-kecil.
- Frontend: penguatan penangkap scanner, layar 'Uji scanner' beserta kalibrasi dan pengaturan perangkat, penahan layar menyala, antrean hitungan lokal dengan sinkronisasi otomatis, indeks sesi lokal untuk pencarian saat offline, penanda koneksi dan sinkron, pengaman keluar/keluar akun, ergonomi HP.
- Dokumentasi: panduan penggunaan scanner Bluetooth untuk operator.

**Tidak termasuk (jangan dikerjakan):**
- Scan lewat kamera (ditunda; tidak ada library pemindai di handoff ini).
- Service worker, cache aplikasi, atau PWA penuh. Halaman yang **sudah terbuka** tetap bekerja saat jaringan putus; **memuat ulang halaman saat offline tidak didukung** (dicatat sebagai batasan).
- Posting, persetujuan, atau pembuatan sesi dari kondisi offline. Semuanya wajib online.
- Perubahan pada aturan hitungan, penguncian, hitung buta, atau posting dari #3 sampai #6.
- Riwayat per periode dan ekspor (Handoff #8).

## 4. Pemeriksaan awal wajib (sebelum menulis kode)

Dokumen ini ditulis tanpa melihat kode terbaru. **Verifikasi dan catat hasilnya.** Bila sebuah asumsi salah dan memengaruhi desain, **hentikan bagian itu dan laporkan ke pengguna**, jangan improvisasi.

1. Handoff #3 sampai #6 selesai dan test hijau. Catat nama dan bentuk akhir: `useScannerCapture` (ambang jeda dan panjang minimal, aturan scan kembar), `useCountMutation`, `CountEntryForm`/`ActiveCountCard`, endpoint `counts`, `lookup`, `items`, `tree`, kebijakan tampilan, alur Posting Opname.
2. **Perangkat uji yang tersedia:** minimal satu HP Android (Chrome) dan, bila ada, satu iPhone (Safari), masing-masing dengan **scanner Bluetooth** yang akan dipakai sungguhan (merek dan modelnya). Catat model scanner dan mode yang dipakai.
3. Format barcode di master produk: apakah ada barcode **bukan angka murni** (huruf, tanda hubung). Menentukan perlu tidaknya pencocokan tak peka huruf besar-kecil (6.4).
4. Ukuran sesi terbesar yang realistis (jumlah produk) untuk menetapkan batas ukuran indeks offline.
5. Apakah proyek sudah memakai pustaka IndexedDB/penyimpanan lokal. Bila tidak, gunakan pembungkus IndexedDB kecil buatan sendiri; **menambah pustaka baru wajib dengan alasan tertulis di berkas progres**.
6. Infrastruktur test frontend (unit/komponen). Antrean offline dan hook scanner **wajib diuji otomatis** bila infrastruktur ada.
7. Baca `docs/ROADMAP_PROGRESS.md` (berkas progres tunggal) dan, bila masih dipakai, `docs/BACKEND_PROGRESS.md`.

## 5. Keputusan yang dipakai di handoff ini

**5.1 Scanner harus berjenis keyboard (HID / 'keyboard wedge').** Browser hanya menerima scanner yang bertindak sebagai keyboard. Scanner mode serial (SPP) **tidak didukung**. Scanner harus mengirim **Enter** di akhir kode dan **tanpa awalan**. Ini dicatat di panduan operator (bagian 10) dan dicek oleh layar 'Uji scanner'.

**5.2 Ambang penangkap scan bisa dikalibrasi per perangkat.** Nilai bawaan dari #5 (jeda ≤ 40 ms, panjang minimal 6 karakter) dibuat bisa diubah dan disimpan **lokal per perangkat** (bukan di server). Scanner Bluetooth sering lebih lambat dan tidak rata dibanding scanner USB; kalibrasi mencegah scan terbaca sebagai ketikan manusia.

**5.3 Kamera ditunda.** Tidak ada pemindai kamera di handoff ini. *(Perlu konfirmasi pengguna bila kelak ingin kamera sebagai cadangan saat baterai scanner habis; itu handoff terpisah.)*

**5.4 Antrean hitungan lokal: berurutan, idempotent, optimistis.**
- Setiap simpan/hapus hitungan dibuat sebagai **operasi** dengan `client_request_id` (UUID dari #4) dan waktu klien, disimpan di **IndexedDB**, lalu dikirim berurutan (FIFO).
- Bila antrean **tidak kosong**, operasi baru **harus ikut antri** (tidak boleh menyalip) agar urutan per produk terjaga.
- Tampilan **optimistis**: produk langsung tampil 'Sudah dihitung' dengan penanda **'belum tersinkron'** sampai server mengonfirmasi.
- Pengiriman memakai endpoint **batch** (6.3) dengan percobaan ulang bertahap (backoff) saat gagal jaringan.
- Hitungan selalu aman diulang karena idempotensi server dari #4.

**5.5 Pencarian saat offline memakai indeks sesi lokal yang tidak pernah memuat stok sistem.** Indeks berisi id item, id produk, nama, barcode, kategori, dan hitungan milik petugas. **Tidak ada stok sistem, selisih, atau status cocok/selisih.** Akibatnya, **saat offline tampilan selalu buta** walau pengaturan angka stok hidup (tidak ada pratinjau selisih). Saat kembali online, tampilan mengikuti pengaturan seperti biasa.

**5.6 Posting wajib online dan antrean kosong.** Tombol Posting Opname (#6) nonaktif bila perangkat offline atau antrean berisi operasi yang belum tersinkron, dengan keterangan yang jelas. Lembar konfirmasi posting menambahkan satu kalimat: pastikan semua perangkat yang ikut menghitung sudah tersinkron.

**5.7 Konflik antar-perangkat: yang tiba lebih dulu di server dihitung lebih dulu.** Dua perangkat yang menghitung produk yang sama saat offline keduanya tercatat di log; nilai akhir mengikuti urutan tiba. Tidak ada penyelesaian konflik otomatis yang lebih rumit di handoff ini; dicatat sebagai batasan.

**5.8 Operasi yang ditolak server tidak dibuang diam-diam.** Operasi yang ditolak (mis. sesi sudah dibatalkan atau diposting dari perangkat lain) dipindahkan ke daftar **'Gagal tersinkron'** beserta alasannya, dan tetap disimpan sampai petugas memutuskan. Petugas dapat **menyalin daftar** (nama produk dan jumlah) agar pekerjaannya tidak hilang.

**5.9 Hitungan yang belum tersinkron tidak boleh hilang tanpa sepengetahuan petugas.** Ada pengaman saat menutup tab/keluar akun/berpindah halaman (11.8).

## 6. Bagian A — Backend (kecil, aditif)

### 6.1 Prinsip
- Semua perubahan bersifat **aditif**. Aturan hitungan dari #4 (nilai, mode `set`/`add`, penguncian, hitung buta, idempotensi) **tidak berubah**; batch hanya memanggil service yang sama.
- Seluruh respons tetap melewati kebijakan tampilan opname: **tanpa** `system_qty`, `variance_count`, atau status `matched`/`variance` saat pengaturan mati. **Indeks offline tidak pernah memuat stok sistem dalam kondisi apa pun.**

### 6.2 Data
- Tambahkan kolom `client_created_at` (nullable) dan `via_batch` (boolean, default false) pada `stock_opname_count_logs`. Hanya untuk jejak audit; tidak memengaruhi nilai hitungan.

### 6.3 Kontrak API

Ikuti envelope dan format galat yang sudah ada. Semua endpoint di bawah butuh `opname.count`.

**GET `/api/stock-opname-sessions/{id}/offline-index`** — indeks sesi untuk pencarian offline
Query: `page`, `per_page` (default 5.000, maks 5.000).
```
{
  session: { id, number, status },
  version: "string",                    // penanda versi, dasar ETag
  categories: [ { id, name, parent_id } ],
  items: [ { item_id, product_id, name, barcode, category_id, counted_qty } ],  // counted_qty null bila belum
  page, total_pages
}
```
- Mendukung `ETag`/`If-None-Match` (balas 304 bila tidak berubah).
- **Tanpa** stok sistem, selisih, atau status cocok/selisih. `counted_qty` boleh ada (itu data hitungan petugas).
- Hanya untuk sesi `in_progress` (sesi lain: 409 dengan kode yang jelas).

**POST `/api/stock-opname-sessions/{id}/counts/batch`** — kirim banyak operasi sekaligus
Body:
```
{ operations: [
    { client_request_id, action: "count", item_id, mode: "set"|"add", quantity, client_created_at },
    { client_request_id, action: "clear", item_id, client_created_at }
] }
```
- Maksimal **100** operasi per permintaan (lebih dari itu: 422).
- Operasi diproses **berurutan sesuai urutan kirim**, masing-masing dalam transaksinya sendiri dengan service yang sama dengan endpoint `counts`/`clear` dari #4 (aturan nilai, penguncian baris, `system_qty_at_count`, log).
- Respons 200:
```
{
  results: [
    { client_request_id, status: "ok"|"duplicate"|"rejected",
      error?: { code, message },
      item?: { ...bentuk item #3, sesuai kebijakan tampilan } }
  ],
  summary: { total_products, counted_products }
}
```
- `duplicate` bila `client_request_id` sudah pernah diproses (hasil sebelumnya dikembalikan, tidak menulis ulang).
- Satu operasi yang ditolak (validasi, item bukan bagian sesi) **tidak menghentikan** operasi lain. Bila sesi **bukan `in_progress`**, seluruh operasi yang belum diproses ditolak dengan kode `session_not_in_progress`.
- `message` pada galat **tidak boleh memuat angka stok**.

### 6.4 Pencocokan barcode
Bila hasil pemeriksaan 4.3 menunjukkan ada barcode berhuruf, perbarui pencarian barcode pada `lookup` (#4) dan indeks offline agar **tidak peka huruf besar-kecil** (aditif; kecocokan angka tidak berubah). Bila semua barcode numerik, lewati dan catat.

### 6.5 Performa
- `offline-index` pada sesi 5.000 item: kurang dari sekitar 1 detik, dan ukuran terkompresi dilaporkan.
- `batch` 100 operasi: kurang dari sekitar 3 detik. Laporkan angka ukurnya bila tidak tercapai.

### 6.6 Test backend (wajib lolos)
1. `batch` memproses operasi **berurutan** (`set` lalu `add` pada item yang sama menghasilkan nilai yang benar) dan hasil per operasi sesuai urutan.
2. Idempotensi: mengirim ulang batch yang sama menghasilkan semua `duplicate` tanpa perubahan nilai dan tanpa log baru; campuran operasi baru dan lama diproses benar.
3. Satu operasi tidak valid (mis. jumlah negatif, item bukan bagian sesi) menghasilkan `rejected` tanpa menghentikan yang lain.
4. Sesi bukan `in_progress`: semua operasi `rejected` dengan `session_not_in_progress`, tidak ada perubahan.
5. Lebih dari 100 operasi: 422.
6. `client_created_at` dan `via_batch` tersimpan di log; nilai hitungan memakai aturan #4 (waktu server untuk `counted_at`).
7. **Hitung buta:** dengan pengaturan mati, respons `batch` dan `offline-index` tidak memuat `system_qty`, `variance_count`, atau status `matched`/`variance`. **`offline-index` tidak memuatnya bahkan saat pengaturan hidup.** Pesan galat tidak memuat angka stok.
8. `offline-index`: struktur benar, `counted_qty` mencerminkan hitungan, ETag/304 berfungsi, paginasi benar, sesi non-`in_progress` ditolak.
9. Izin: 401, 403 untuk role tanpa `opname.count`, berhasil untuk role berizin.
10. Pencocokan barcode tak peka huruf (bila diterapkan).
11. Seluruh test Handoff #1 sampai #6 tetap hijau.
12. Uji performa (6.5) dan laporkan angkanya.

Pengguna menjalankan `php artisan test` di mesinnya. Sertakan perintah yang tepat dan hasil yang diharapkan di laporan serah terima.

## 7. Bagian B — Frontend: scanner Bluetooth

Stack: React + Vite + TypeScript. **Ikuti library, struktur folder, dan pola yang sudah ada.** Jangan menambah library UI baru tanpa alasan kuat.

### 7.1 Penguatan `useScannerCapture`
Tetap mempertahankan seluruh aturan dari Handoff #5 (semburan cepat, minimal panjang, akhiran Enter/Tab, scan kembar 800 ms, penolakan saat jumlah diketik, pemisahan dari ketikan manusia). Tambahan:
- **Ambang dapat dikonfigurasi** dari pengaturan perangkat (7.3): jeda maksimal antar-karakter dan panjang minimal. Nilai bawaan tetap 40 ms dan 6 karakter. Rentang yang diizinkan: jeda 20–150 ms, panjang minimal 3–10.
- **Penanganan `key === 'Unidentified'`** dan kejadian dari IME (kode tombol 229) yang muncul pada sebagian perangkat Android: sediakan **kolom tangkap tersembunyi** di luar layar (`inputmode="none"`, tidak memunculkan keyboard layar) yang menerima kejadian `input`/`beforeinput` sebagai jalur cadangan, dengan aturan semburan yang sama. Jalur cadangan hanya aktif bila jalur `keydown` terbukti tidak menghasilkan karakter yang dapat dibaca.
- **Pemulihan fokus dan visibilitas:** saat tab kembali terlihat atau jendela kembali fokus, penangkap aktif lagi tanpa perlu mengetuk layar. Layar yang terkunci lalu dibuka lagi tidak boleh membuat scan berikutnya hilang.
- **Statistik diagnostik di memori** (tidak dikirim ke server): untuk setiap semburan, catat string mentah, panjang, jeda rata-rata dan maksimal antar-karakter, jenis akhiran (Enter/Tab/tidak ada), dan apakah diterima sebagai scan. Dipakai layar 'Uji scanner'.
- Keluaran tetap `onScan(code, { source: 'keyboard' })`.
- **Uji otomatis** (bila ada infrastruktur): jeda 10 ms dan 70 ms dengan ambang bawaan dan hasil kalibrasi; semburan tanpa akhiran; kejadian `Unidentified` lewat jalur cadangan; scan kembar; penolakan saat jumlah diketik.

### 7.2 Layar 'Uji scanner' dan kalibrasi
Lembar (`ScannerTestSheet`) yang dibuka dari menu ⋯ pada layar opname (dan tombol 'Uji scanner' di peringatan awal). Layar penuh di HP.
- **Area uji:** petunjuk 'Scan barcode apa saja'. Setelah setiap scan menampilkan: kode yang terbaca, panjang, jeda rata-rata dan maksimal (ms), akhiran terdeteksi, dan hasil (diterima/ditolak beserta alasan).
- **Diagnosis ramah:** pesan jelas bila terdeteksi masalah, mis. 'Akhiran Enter tidak terdeteksi, atur scanner agar mengirim Enter', 'Jeda antar-karakter melebihi ambang saat ini, jalankan kalibrasi', 'Ada awalan tambahan pada kode', 'Karakter tidak terbaca (periksa mode keyboard scanner)'.
- **Kalibrasi otomatis:** tombol 'Kalibrasi' meminta **3 kali scan** (barcode berbeda). Ambil jeda maksimal dari ketiganya, tetapkan ambang = jeda maksimal × 1,5 (dibulatkan, dibatasi pada rentang 7.1), tampilkan hasilnya, dan simpan setelah petugas mengonfirmasi. Tombol 'Kembalikan ke bawaan'.
- **Pengaturan manual** (lanjutan, dilipat): jeda maksimal dan panjang minimal.
- **Penyimpanan lokal per perangkat** (mis. `localStorage`), bukan di server. Dibaca oleh `useScannerCapture`.
- **Ajakan awal:** pada pemakaian pertama di sebuah perangkat, tampilkan spanduk ringan yang bisa ditutup: 'Uji scanner dulu agar akurat'. Tidak memblokir penggunaan.
- Tampilkan juga di lembar ini: pengaturan 'Suara dan getar' (dari #5), sakelar 'Jaga layar tetap menyala' (7.4), dan status penyimpanan offline (9.5).

### 7.3 Penanda scan terakhir
Chip kecil di header layar opname: 'Scan terakhir: 12 dtk lalu' (atau 'Belum ada scan'). Fungsinya memberi petunjuk bila scanner tertidur atau terputus (tidak ada cara pasti mendeteksi koneksi HID dari browser). Bila lebih dari 3 menit tanpa scan padahal petugas menyimpan hitungan lewat jalur manual, **jangan** menampilkan peringatan agresif; cukup chip berwarna redup.

### 7.4 Jaga layar tetap menyala
- Gunakan Screen Wake Lock API selama layar opname **`in_progress`** terbuka dan tab terlihat. Dapatkan ulang saat tab kembali terlihat. Lepas saat keluar dari layar atau sesi bukan `in_progress`.
- Sakelar 'Jaga layar tetap menyala' di pengaturan perangkat (bawaan hidup, disimpan lokal). **Gagal dengan tenang** bila API tidak tersedia.

### 7.5 Panduan operator
Bagian 10 mewajibkan satu berkas panduan singkat; tautkan dari lembar 'Uji scanner'.

## 8. Bagian C — Frontend: hitungan tahan sinyal buruk

### 8.1 Komponen dan hook (usulan nama)
- `CountSyncQueue` — antrean operasi di IndexedDB (tambah, baca berurutan, tandai berhasil/gagal, hitung jumlah).
- `useCountSync` — pengirim antrean: mengirim lewat endpoint batch, backoff, pemulihan saat kembali online.
- `OfflineSessionIndex` — penyimpan dan pembaruan indeks sesi lokal (6.3).
- `useOfflineLookup` — pencarian barcode/nama pada indeks lokal.
- `usePendingOverlay` / `useLocalProgress` — menggabungkan operasi tertunda ke tampilan (kartu rangkaian, Daftar, progres).
- `useConnectionStatus` — status koneksi.
- `SyncStatusChip`, `PendingBadge`, `SyncFailedSheet`.
- Ubah `useCountMutation` (#4) sehingga **seluruh simpan/hapus hitungan melewati `CountSyncQueue`** (satu jalur tunggal), dengan perilaku #4 tetap (aturan Ganti/Tambah, `client_request_id`, penolakan jumlah, penguncian).

### 8.2 Jalur simpan
1. Petugas menyimpan hitungan. Operasi ditulis ke antrean (IndexedDB) **lebih dulu**, lalu tampilan diperbarui secara optimistis.
2. `useCountSync` mengirim. Bila antrean sebelumnya kosong dan jaringan baik, dikirim langsung (satu operasi pun dikirim lewat jalur yang sama agar urutan terjaga; boleh memakai endpoint `counts` tunggal dari #4 untuk satu operasi atau batch untuk banyak).
3. Hasil `ok` atau `duplicate`: operasi dihapus dari antrean dan tampilan disamakan dengan data server (nilai, status, progres dari respons).
4. Gagal jaringan/timeout: tetap di antrean, jadwalkan ulang dengan backoff (mis. 2, 5, 15, 30 detik, lalu tiap 30 detik), tampilkan status offline atau menyinkronkan.
5. `rejected`: pindahkan ke daftar 'Gagal tersinkron' (5.8).
- Pengiriman berurutan; **satu pengirim saja yang berjalan** (hindari kirim ganda antar-tab; gunakan kunci lintas-tab atau satu pemilik antrean, dan uji dua tab terbuka).
- Setelah antrean habis, lakukan **rekonsiliasi**: ambil ulang `tree` dan data item yang terlihat agar tampilan sama dengan server.

### 8.3 Pencarian saat offline
- **Online:** pencarian tetap lewat `lookup` server (otoritatif).
- **Offline** (atau permintaan `lookup` gagal jaringan): pakai indeks lokal. Barcode cocok persis → item; nama → maksimal 10 hasil. Barcode tidak ada di indeks tetapi mungkin ada di master: tampilkan 'Tidak ada di indeks sesi' secara jujur (tidak menyimpulkan `not_in_session` vs `unknown_barcode` tanpa server).
- Tampilan offline **selalu buta** (5.5); form tidak menampilkan stok atau pratinjau selisih.
- **Unduh indeks:** otomatis saat layar opname `in_progress` dibuka, lalu diperbarui di latar (cek `ETag`) tiap beberapa menit saat online dan setelah sinkron. Tampilkan status indeks (terakhir diperbarui) di lembar 'Uji scanner'. Bila indeks belum ada dan perangkat offline, tampilkan pesan jelas bahwa pencarian offline belum siap.
- Indeks disimpan per sesi di IndexedDB dan dihapus saat sesi selesai/dibatalkan (setelah antrean terkait kosong).

### 8.4 Tampilan optimistis dan progres lokal
- Produk yang antri tampil 'Sudah dihitung' dengan **`PendingBadge`** ('belum tersinkron') di kartu atas, Daftar, dan lembar Riwayat.
- Progres (header, node Daftar, kartu rekomendasi, kartu 'sub-kategori selesai') memperhitungkan operasi tertunda. Saat offline, progres dihitung lokal dari **indeks + antrean** dengan rantai induk dari data kategori indeks. Saat online dengan antrean singkat, cukup menyesuaikan angka cache pohon.
- Kartu rekomendasi dan kartu 'selesai' tetap berfungsi offline (memakai indeks lokal).
- Setelah rekonsiliasi, angka server menjadi sumber kebenaran.

### 8.5 Penanda status
- `SyncStatusChip` di header: tersembunyi saat online dan antrean kosong; **'Offline · {n} menunggu'** (kuning) saat offline; **'Menyinkronkan {n}…'** saat mengirim; **'Gagal {n}'** (merah, dapat diketuk) bila ada yang ditolak. Sertakan ikon dan teks, bukan hanya warna.
- Mengetuk chip membuka lembar status: jumlah menunggu, tombol **'Sinkronkan sekarang'**, dan daftar 'Gagal tersinkron' (`SyncFailedSheet`).
- Deteksi koneksi: jangan hanya bergantung pada `navigator.onLine`. Anggap offline bila permintaan sungguhan gagal jaringan; saat offline atau antrean berisi, lakukan **pengecekan ringan berkala** (mis. endpoint `lock-status` dari #4) tiap ±15 detik untuk mendeteksi kembalinya jaringan.

### 8.6 Daftar 'Gagal tersinkron'
- Setiap entri: nama produk, jumlah, waktu, alasan penolakan dalam bahasa jelas (mis. 'Sesi sudah dibatalkan', 'Produk bukan bagian sesi').
- Aksi: **'Coba lagi'** (untuk kegagalan sementara), **'Hapus dari antrean'** (dengan konfirmasi), dan **'Salin daftar'** (teks rapi berisi nama produk dan jumlah) agar pekerjaan tidak hilang.
- Bila alasan `session_not_in_progress`, tampilkan penjelasan bahwa sesi sudah ditutup dan hitungan ini tidak berlaku.

### 8.7 Posting
- Pada alur Posting Opname (#6): tombol **nonaktif** bila offline atau antrean tidak kosong, dengan keterangan 'Sinkronkan semua hitungan dulu'.
- Lembar konfirmasi posting menambahkan kalimat: 'Pastikan semua perangkat yang ikut menghitung sudah tersinkron.'

### 8.8 Pengaman penutupan
- **Menutup tab, memuat ulang, atau berpindah rute** saat antrean tidak kosong: tampilkan peringatan bawaan browser dan pencegat rute.
- **Keluar akun** saat antrean tidak kosong: dialog konfirmasi yang menjelaskan hitungan belum tersinkron dan menawarkan 'Sinkronkan dulu'. Bila petugas tetap keluar, data antrean **tetap disimpan** untuk akun/perangkat itu dan tidak dikirim oleh pengguna lain; saat pengguna yang sama masuk lagi, antrean dilanjutkan. Antrean dan indeks milik pengguna berbeda tidak boleh bercampur.
- Saat antrean kosong, keluar akun menghapus indeks lokal.

### 8.9 Penyimpanan
- Panggil `navigator.storage.persist()` (bila ada) agar penyimpanan lokal tidak mudah dihapus peramban. Tampilkan statusnya di lembar 'Uji scanner'. Catat di panduan bahwa Safari di iPhone dapat menghapus data situs yang lama tidak dibuka dan bahwa menambahkan aplikasi ke Layar Utama membantu.
- Beri peringatan lembut bila antrean melebihi sekitar 200 operasi ('Segera sambungkan jaringan untuk sinkron').

### 8.10 Uji otomatis (wajib bila ada infrastruktur)
Antrean: urutan FIFO, tidak menyalip, idempotensi pada pengiriman ulang, backoff, pemulihan setelah muat ulang, penanganan `duplicate` dan `rejected`, pemisahan antrean antar-pengguna. Jaringan dapat disimulasikan dengan tiruan. Bila tidak ada infrastruktur, catat uji manual di bagian 12.

## 9. Bagian D — Frontend: ergonomi HP

- Cegah **tarik-untuk-muat-ulang** dan gulir berantai pada layar kerja opname (`overscroll-behavior` yang sesuai), serta **zoom dua ketukan** pada keypad dan tombol (`touch-action: manipulation`). Pastikan zoom cubit untuk aksesibilitas pada konten lain tidak dimatikan secara global.
- Nonaktifkan pemilihan teks dan sorotan ketuk pada keypad dan kartu.
- Header tipis menampung: nama sesi/progres, `SyncStatusChip`, chip scan terakhir. Tidak boleh penuh sesak di 375px; prioritaskan progres dan status sinkron, chip scan terakhir boleh disingkat.
- Posisi portrait menjadi acuan; tampilan landscape tetap dapat dipakai tanpa terkunci.
- Hormati `prefers-reduced-motion` dan kontras yang cukup di bawah lampu toko.
- Kurangi pemakaian daya: polling melambat saat tab tersembunyi (sudah dari #3) dan saat offline.

## 10. Dokumentasi dan serah terima

- Perbarui **satu berkas progres tunggal untuk agent frontend: `docs/ROADMAP_PROGRESS.md`**. Tambahkan bagian 'Adjustment & Opname — Handoff #7' berisi: apa yang baru selesai, endpoint baru dan bentuknya, nama hook/komponen, aturan antrean, batasan yang diketahui (tidak ada service worker; memuat ulang saat offline tidak didukung; konflik antar-perangkat berdasarkan urutan tiba), **model scanner dan perangkat yang diuji beserta hasilnya**, hasil pemeriksaan awal di bagian 4 beserta asumsi yang berbeda, hasil uji performa, dan fitur UI apa yang kini bisa dibangun. Jangan membuat berkas progres baru.
- Tulis **satu berkas panduan operator singkat** `docs/PANDUAN_SCANNER_BLUETOOTH.md` (bahasa Indonesia, halaman pendek, untuk admin toko). Isi minimal: (1) syarat scanner (mode keyboard/HID, bukan serial/SPP, akhiran Enter, tanpa awalan); (2) langkah memasangkan ke HP Android dan iPhone secara umum; (3) cara memakai 'Uji scanner' dan kalibrasi; (4) tips baterai dan mode tidur scanner serta cara menyambung ulang; (5) apa yang terjadi saat sinyal putus (antrean, penanda 'belum tersinkron') dan **wajib menyinkronkan semua perangkat sebelum Posting Opname**; (6) catatan penyimpanan lokal di iPhone. Berkas ini **bukan** berkas progres.
- Bila `docs/BACKEND_PROGRESS.md` masih dipakai, cukup tambahkan satu baris rujukan. Jangan menduplikasi isi.
- Gunakan commit kecil dan terarah, misalnya: (1) kolom log + batch + test, (2) `offline-index` + test, (3) pencocokan barcode, (4) penguatan `useScannerCapture` + uji, (5) 'Uji scanner' dan kalibrasi, (6) wake lock dan chip scan terakhir, (7) `CountSyncQueue` + uji, (8) `useCountSync` + `useCountMutation` lewat antrean, (9) indeks offline + `useOfflineLookup`, (10) overlay/progres lokal + `PendingBadge`, (11) `SyncStatusChip` + `SyncFailedSheet`, (12) pengaman penutupan dan keluar akun, (13) ergonomi HP, (14) panduan operator dan dokumentasi.
- Di akhir pekerjaan, tulis **ringkasan serah terima maksimal 10 baris** yang bisa diteruskan ke agent lain: apa yang selesai, apa yang belum, temuan atau asumsi yang berbeda, perintah untuk menjalankan test, dan langkah berikutnya (Handoff #8).

## 11. Kriteria selesai (dicek di perangkat nyata)

Skenario uji manual, semuanya harus lolos. Gunakan **HP sungguhan dengan scanner Bluetooth** yang akan dipakai. Jalankan di lingkungan lokal atau staging.

**Scanner**
1. Pasangkan scanner (mode HID) ke HP Android, buka sesi `in_progress`. Scan produk: **keyboard layar tidak muncul**, produk terpilih tanpa mengetuk kolom apa pun. Ulangi di iPhone bila tersedia.
2. Buka **'Uji scanner'**: kode, panjang, jeda rata-rata/maksimal, dan akhiran tampil benar. Jalankan **kalibrasi 3 scan**: ambang tersimpan, bertahan setelah muat ulang, dan scan berikutnya lebih andal. 'Kembalikan ke bawaan' bekerja.
3. Atur scanner tanpa akhiran Enter (atau dengan awalan): lembar uji menampilkan diagnosis yang jelas, dan layar opname tidak salah menyimpan apa pun.
4. Kunci layar HP lalu buka lagi di tengah menghitung: scan berikutnya tetap diterima. Biarkan scanner tertidur lalu bangunkan: scan setelah tersambung ulang diterima.
5. **Jaga layar tetap menyala** bekerja saat menghitung, dilepas saat keluar dari layar, dan sakelarnya berfungsi.
6. Ketik jumlah dengan keypad lalu scan: perilaku #5 tetap (scan ditolak dengan peringatan, isian utuh, tidak ada digit scan di jumlah).

**Offline dan sinkron**
7. Hitung beberapa produk online, lalu aktifkan mode pesawat di tengah menghitung: chip menjadi **'Offline · n menunggu'**, scan tetap menemukan produk lewat indeks lokal, hitungan tersimpan dengan **'belum tersinkron'**, kartu atas, rekomendasi, Daftar, dan progres tetap bergerak. Tidak ada stok sistem atau pratinjau selisih tampil saat offline, termasuk bila pengaturan angka stok hidup.
8. Hitung 20 produk offline, termasuk satu produk dua kali (`set` lalu `add`) dan satu `clear`. Matikan mode pesawat: sinkron **otomatis**, chip hilang, nilai di server dan urutan operasi benar, tidak ada hitungan ganda.
9. Putuskan jaringan di tengah pengiriman batch: setelah tersambung lagi, tidak ada duplikasi dan tidak ada operasi yang hilang (periksa log hitungan: `via_batch` dan `client_created_at` terisi).
10. Muat ulang halaman **setelah** kembali online dengan antrean masih berisi: antrean tetap ada dan dilanjutkan. Dua tab terbuka: hanya satu yang mengirim, tidak ada pengiriman ganda.
11. Dari perangkat lain, batalkan sesi saat HP offline dengan hitungan tertunda: saat HP sinkron, operasi ditolak dan muncul di **'Gagal tersinkron'** dengan alasan jelas; **'Salin daftar'** berisi nama dan jumlah; **'Hapus dari antrean'** meminta konfirmasi.
12. Tombol **Posting Opname** nonaktif saat offline atau antrean tidak kosong, dengan keterangan; aktif lagi setelah sinkron selesai. Lembar konfirmasi memuat kalimat tentang sinkron semua perangkat.
13. Tutup tab atau keluar akun saat antrean berisi: ada peringatan. Keluar lalu masuk lagi dengan pengguna yang sama: antrean dilanjutkan; masuk dengan pengguna lain: antrean tidak bercampur.
14. Periksa payload `offline-index` di tab Network: **tidak ada** `system_qty`, selisih, atau status cocok/selisih (dalam mode pengaturan hidup maupun mati).
15. Hitungan dari perangkat lain muncul setelah rekonsiliasi di perangkat ini (indeks dan tampilan diperbarui saat online).

**Ergonomi dan regresi**
16. Di HP 375px: header tidak penuh sesak, tarik-untuk-muat-ulang tidak terpicu saat menggulir, keypad tidak memicu zoom dua ketukan.
17. Seluruh fitur Handoff #1 sampai #6 tetap berfungsi normal, termasuk laporan dan Posting Opname pada sesi yang dihitung sebagian lewat jalur offline.
18. `php artisan test` hijau, serta pemeriksaan tipe, lint, uji otomatis frontend (bila ada), dan build bersih.

Setelah pengujian, **batalkan atau selesaikan semua sesi uji** agar produk tidak terkunci untuk pekerjaan berikutnya.

## 12. Antarmuka yang akan dipakai handoff berikutnya (jangan diubah tanpa laporan)

- Endpoint `offline-index` dan `batch`, serta kolom `client_created_at` dan `via_batch` di log hitungan (dipakai #8 untuk jejak audit dan ekspor).
- `CountSyncQueue` dan jalur tunggal simpan hitungan lewat antrean (dipakai bila kelak ada sumber scan baru).
- `useScannerCapture` dengan `onScan(code, { source })` dan ambang yang dapat dikonfigurasi (siap bila kamera ditambahkan kelak).

**Catatan untuk Handoff #8 (jangan dikerjakan sekarang):** riwayat dan ekspor dapat menampilkan penanda 'dihitung lewat antrean offline' dari `via_batch` bila diperlukan. Evaluasi juga penghapusan kolom `stock_adjustments.source`/`opname_session_id` dan alasan `opname_result` yang tidak terpakai (lihat catatan Handoff #6).

## 13. Larangan

- Jangan membuat scan kamera, service worker, atau PWA penuh.
- Jangan mengirim, menyimpan lokal, atau menampilkan stok sistem, selisih, atau status cocok/selisih di indeks offline, antrean, atau tampilan offline.
- Jangan membiarkan operasi menyalip antrean atau menghilangkan operasi yang ditolak tanpa sepengetahuan petugas.
- Jangan membuat posting, persetujuan, atau pembuatan sesi berjalan dari kondisi offline.
- Jangan mengubah aturan hitungan, idempotensi, penguncian transaksi, hitung buta, atau posting dari #3 sampai #6.
- Jangan menyimpan pengaturan ambang scanner di server (hanya lokal per perangkat).
- Jangan mencampur antrean atau indeks antar-pengguna.
- Jangan mematikan zoom cubit secara global.
- Jangan menambah library baru (termasuk pustaka IndexedDB) tanpa alasan yang dicatat.
- Jangan melakukan refactor di luar cakupan dokumen ini.
- Jangan menyimpan data sungguhan, kredensial, atau berkas `.env` ke repositori.
