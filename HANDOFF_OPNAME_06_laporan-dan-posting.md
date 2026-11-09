# HANDOFF #6 — Laporan Opname, Persetujuan Owner, dan Posting Opname

Proyek: POS Retail SMK · Seri: Adjustment & Opname (Handoff #6 dari 8) · Dibuat: 9 November 2026 · Status: siap dikerjakan **setelah Handoff #5 selesai dan di-merge**

## 0. Ringkasan untuk agent yang baru bergabung

Handoff #2 sampai #5 membuat opname bisa dibuat, dihitung dengan scanner, dan dipantau, sambil menjaga toko tertutup. **Handoff #6 menutup siklusnya:** meninjau selisih, mengajukan persetujuan Owner bila perlu, memposting opname sehingga stok sistem disesuaikan, dan menghasilkan **satu laporan opname** yang ringkas dan mudah dibaca.

Keputusan desain dari pengguna:
- Hasil opname dicatat sebagai **satu dokumen laporan**, bukan banyak adjustment per produk. Dokumen **hanya memuat produk yang berselisih**. Produk tanpa selisih tidak masuk laporan.
- Bila **semua produk bersih**, laporan **tidak kosong**: tetap menampilkan kategori dan sub-kategori yang diopname dengan keterangan **'0 selisih'**.
- Ambang persetujuan Owner berupa **nominal rupiah** yang disimpan di **konfigurasi pada menu setting admin** (nilai awal Rp25.000 per produk dan Rp200.000 per sesi).

Pemakaian utama kelak di **HP**. Semua UI mobile-first.

## 1. Konteks seri handoff

| # | Isi | Status |
|---|---|---|
| 1 | Kerangka halaman + tab Adjustment | Selesai |
| 2 | Sesi opname: buat, daftar, status, cakupan | Selesai |
| 3 | Kerangka layar opname + peta progres + pengaturan angka stok | Sedang dikerjakan |
| 4 | Input hitungan inti + penguncian transaksi | Berikutnya |
| 5 | Rangkaian hitung berfokus scanner | Prasyarat dokumen ini |
| **6** | **Laporan opname + persetujuan Owner + Posting Opname** | **Dokumen ini** |
| 7 | Penyempurnaan HP: scan kamera, draft lokal + sinkron | |
| 8 | Riwayat per periode + penutup | |

## 2. Prasyarat dan urutan kerja

**Jangan mulai sebelum Handoff #3, #4, dan #5 selesai, lolos test, dan di-merge.** Handoff ini bergantung pada: kolom hitung pada `stock_opname_items`, log hitungan, `OpnameLockService` beserta pengecualian berbasis referensi sesi, kebijakan tampilan opname, header layar dengan ruang tombol Posting, tampilan Ringkasan, bagian 'Opname' di setting admin, dan `selectItem`/`startNode` pada konteks layar.

Urutan: **Bagian A (backend) → Bagian B (frontend)**. Setelah kontrak di 6.6 final, Bagian B boleh jalan paralel memakai data tiruan. Bagian A adalah bagian paling sensitif di seluruh seri (mengubah stok); kerjakan dengan hati-hati dan lengkapi seluruh test sebelum menyentuh frontend.

## 3. Cakupan

**Termasuk:**
- Backend: pembangun laporan, pratinjau selisih (dengan gerbang), pengajuan dan persetujuan, penolakan, eksekusi posting (pergerakan stok), snapshot nilai, pengaturan ambang, izin, notifikasi (bila ada), test.
- Frontend: tampilan laporan (pratinjau, menunggu persetujuan, final), tombol Posting Opname dan alurnya, layar persetujuan Owner, pengaturan ambang di setting admin, penyesuaian halaman sesi untuk status `pending_approval` dan `posted`, gaya cetak sederhana.

**Tidak termasuk (jangan dikerjakan):**
- Riwayat per periode, filter lintas sesi, ekspor CSV/PDF, rekap bulanan (Handoff #8).
- Scan kamera, draft lokal, antrean offline (Handoff #7).
- Perubahan pada aturan hitungan, penguncian, atau hitung buta dari #3 sampai #5.
- Penghapusan kolom atau alasan `opname_result` yang dicadangkan di Handoff #1 (dibiarkan tak terpakai; lihat 5.2).

## 4. Pemeriksaan awal wajib (sebelum menulis kode)

Dokumen ini ditulis tanpa melihat kode terbaru. **Verifikasi dan catat hasilnya.** Bila sebuah asumsi salah dan memengaruhi desain, **hentikan bagian itu dan laporkan ke pengguna**, jangan improvisasi.

1. Handoff #3 sampai #5 selesai dan test hijau. Catat nama dan bentuk akhir: `OpnameDisplayPolicy`, `OpnameLockService`, `OpnameSessionService`, respons `tree`/`items`/`counts`, log hitungan, konteks layar, header (ruang tombol Posting), tampilan Ringkasan.
2. **Harga pokok (HPP).** Bagaimana `InventoryService` menyimpan dan membaca harga pokok rata-rata per produk, apakah tersedia saat pembacaan massal, apa yang terjadi bila belum ada harga pokok (produk baru/stok awal), dan bagaimana pergerakan stok mencatat harga pokoknya.
3. **Pergerakan stok dengan referensi sesi.** Jenis pergerakan yang ada, apakah bisa membawa referensi dokumen sumber (tipe dan id), dan **bagaimana pengecualian penguncian di #4 menerimanya**. Posting memakai jalur ini langsung ke `InventoryService`, **bukan** lewat service adjustment manual dari Handoff #1.
4. **Konfirmasi password Owner** yang sudah ada (dipakai pada penghapusan barang rusak/kedaluwarsa dan sejenisnya): nama mekanisme, cara frontend memicunya, dan cara backend memverifikasinya.
5. **Siapa yang boleh melihat harga modal** di sistem saat ini (peran/izin). Dipakai untuk aturan tampilan nilai rupiah di 5.7.
6. Infrastruktur **notifikasi** (hasil WS-B): apakah ada, cara membuat notifikasi untuk satu peran, dan cara frontend menampilkannya.
7. Konfigurasi dan **audit log** yang dipakai Handoff #3 untuk bagian 'Opname' di setting admin.
8. Daftar sesi opname dan halaman sesi dari Handoff #2 dan #3: titik tempat status `pending_approval` dan `posted` harus ditangani.
9. Baca `docs/ROADMAP_PROGRESS.md` (berkas progres tunggal) dan, bila masih dipakai, `docs/BACKEND_PROGRESS.md`.

## 5. Keputusan yang dipakai di handoff ini

**5.1 Satu dokumen laporan, hanya produk berselisih.** Laporan opname adalah dokumen tunggal per sesi. Daftar produk di dalamnya **hanya berisi produk yang berselisih**. Produk bersih tidak pernah ditampilkan sebagai baris produk.

**5.2 Tidak membuat baris adjustment per produk.** Posting menulis **pergerakan stok per produk yang berselisih** lewat `InventoryService` dengan referensi ke sesi opname, dan **tidak** membuat baris di tabel `stock_adjustments`. Dokumen resminya adalah laporan opname itu sendiri. Dampaknya: daftar di tab Adjustment tetap hanya berisi adjustment manual dan tidak dipenuhi puluhan baris hasil opname. Kolom `source`, `opname_session_id`, dan alasan `opname_result` yang dicadangkan di Handoff #1 **dibiarkan, tidak dipakai**, dan dicatat di berkas progres untuk dievaluasi di Handoff #8. *Catatan ini menggantikan catatan di Handoff #4 yang menyebut adjustment hasil opname dibuat lewat service adjustment.* Riwayat stok per produk tetap lengkap karena setiap pergerakan membawa referensi 'Opname {nomor}'.

**5.3 Struktur laporan.** Laporan selalu berstruktur **kategori → sub-kategori** sesuai cakupan sesi:
- Kategori/sub-kategori **tanpa selisih** tampil sebagai **satu baris ringkas**: nama, jumlah produk dihitung, dan penanda **'✓ 0 selisih'**. Tidak dapat dibuka.
- Kategori/sub-kategori **dengan selisih** tampil dengan jumlah selisihnya dan dapat dibuka untuk melihat **hanya produk yang berselisih**.
- Bila **seluruh sesi bersih**: banner '✓ Tidak ada selisih' dan daftar kategori/sub-kategori semuanya berstatus '0 selisih'. Laporan tidak pernah kosong.
- Struktur ini berlaku sama pada laporan campuran (sebagian bersih, sebagian berselisih), sehingga laporan selalu memperlihatkan **cakupan apa saja yang sudah dihitung**.

**5.4 Gerbang pratinjau selisih (menjaga hitung buta).** Selisih **tidak boleh terlihat sebelum semua produk dalam sesi selesai dihitung.** Laporan pratinjau, daftar selisih, dan tombol Posting hanya tersedia bila `counted_products == total_products`. Sebelum itu endpoint laporan menjawab `409 counting_incomplete` dengan hanya angka progres (tanpa data selisih). Setelah semua dihitung, petugas boleh **menghitung ulang** produk berselisih lewat alur #4/#5 (setiap revisi tercatat di log hitungan dan ditandai '↻ dihitung ulang' di laporan).

**5.5 Posting hanya bila seluruh produk sudah dihitung.** Tidak ada posting dengan produk 'belum dihitung'. Produk yang tidak ditemukan di rak dihitung **0** (sudah ada tombol '0 — tidak ada'). *(Perlu konfirmasi pengguna: bila diperlukan, kelak dapat ditambah opsi khusus Owner untuk memposting dengan produk belum dihitung dianggap tidak berubah.)*

**5.6 Aturan persetujuan Owner.** Saat Admin memposting, sistem menghitung apakah perlu persetujuan. **Perlu persetujuan Owner bila salah satu terpenuhi** (batas **inklusif**, yaitu sama dengan ambang sudah memicu):
- **Per produk:** nilai mutlak selisih sebuah produk (`|diff_qty| × harga pokok`) ≥ ambang per produk.
- **Per sesi:** jumlah nilai mutlak seluruh selisih (kurang dan lebih dijumlahkan sebagai nilai positif, tidak saling meniadakan) ≥ ambang per sesi.
- **Opname pertama:** belum ada sesi `posted` sebelumnya di sistem (selama opname pertama setelah migrasi data selalu disetujui Owner). Dapat dimatikan lewat pengaturan.
- **Harga pokok tidak tersedia atau nol** pada produk yang berselisih (nilai tidak bisa dihitung). Produk ini ditandai `cost_missing`.

Bila tidak ada kriteria terpenuhi, Admin dapat memposting langsung. Bila Owner sendiri yang memposting, tidak ada langkah persetujuan terpisah, tetapi tetap memakai konfirmasi password Owner.

**5.7 Visibilitas nilai rupiah.** Nilai rupiah selisih hanya ditampilkan kepada peran yang **sudah berhak melihat harga modal** (hasil pemeriksaan 4.5; default Owner dan Accounting). Peran lain (mis. Admin) melihat **jumlah** selisih dan sebuah keterangan 'perlu persetujuan Owner' **tanpa angka rupiah dan tanpa nilai ambang**. Bila infrastrukturnya belum ada, buat izin `opname.view_value`.

**5.8 Siklus status.** `in_progress` → (diajukan) `pending_approval` → (disetujui) `posted`; atau `in_progress` → `posted` langsung bila tidak perlu persetujuan. **Ditolak** mengembalikan sesi ke `in_progress` dengan catatan penolakan yang terlihat Admin, sehingga hitungan bisa diperbaiki. Selama `pending_approval` toko tetap terkunci dan hitungan tidak bisa diubah. Kunci dilepas saat `posted` (atau `cancelled`).

**5.9 Integritas stok saat posting.** Selisih diterapkan sebagai `counted_qty − system_qty_at_count`. Sebelum menerapkan, server memastikan stok produk saat ini **sama dengan** `system_qty_at_count` untuk setiap produk yang berselisih. Bila ada yang berbeda (seharusnya mustahil karena penguncian), posting **dibatalkan seluruhnya** dengan galat `stock_changed_during_opname` yang mencantumkan produknya, dan tidak ada stok yang berubah.

**5.10 Snapshot nilai.** Harga pokok yang dipakai untuk menghitung nilai selisih **dibekukan saat pengajuan/posting** (`unit_cost_snapshot`) sehingga angka yang dilihat Owner saat menyetujui **sama persis** dengan yang dicatat saat posting, dan tidak berubah di laporan walau harga pokok berubah kelak.

**5.11 Ambang di konfigurasi.** Kunci (usulan): `opname.approval.per_product_threshold` (rupiah, bilangan bulat ≥ 1, default 25000), `opname.approval.per_session_threshold` (default 200000), dan `opname.approval.require_first_opname` (boolean, default hidup). Ditaruh di bagian **'Opname'** pada setting admin (dibuat Handoff #3). **Hanya Owner yang boleh mengubah** ambang dan pengaturan opname pertama, karena ini kontrol atas persetujuan Owner (Admin boleh melihat bahwa pengaturan ada, tanpa mengubah). Perubahan dicatat di audit log (siapa, kapan, nilai lama dan baru). *(Perlu konfirmasi pengguna bila Admin juga harus boleh mengubah.)*

## 6. Bagian A — Backend

### 6.1 Prinsip
- **Posting adalah satu transaksi database.** Gagal sebagian berarti batal seluruhnya, termasuk seluruh pergerakan stok.
- Posting dan persetujuan **idempotent**: `client_request_id` yang sama tidak mengulang efek.
- Setiap pergerakan stok melewati `InventoryService` dengan referensi sesi (jalur pengecualian #4). **Dilarang** mengubah stok dengan query langsung.
- Perubahan pada kode yang sudah ada bersifat **aditif**.
- Seluruh aturan tampil/sembunyi stok tetap lewat kebijakan tampilan dari #3.

### 6.2 Data (usulan, sesuaikan dengan konvensi)

**Kolom tambahan pada `stock_opname_sessions`:** `submitted_at`, `submitted_by`, `approval_required` (boolean), `approval_reasons` (JSON: jenis alasan dan produk terkait), `approved_at`, `approved_by`, `posted_at`, `posted_by`, `rejected_at`, `rejected_by`, `reject_reason`, serta total beku saat pengajuan/posting: `variance_products`, `short_qty`, `over_qty`, `short_value`, `over_value`, `abs_value`.

**Kolom tambahan pada `stock_opname_items`:** `diff_qty` (nullable), `unit_cost_snapshot` (nullable), `diff_value` (nullable), `stock_movement_id` (nullable), `revision_count` (default 0). Diisi saat pengajuan/posting untuk produk yang berselisih; produk bersih tetap null.

**Tabel `stock_opname_approvals`** (jejak tambah-saja): `id`, `session_id`, `action` (`submitted`, `approved`, `rejected`, `posted`), `by`, `at`, `note`, `client_request_id` (unik).

Indeks sesuai kebutuhan (mis. `status`, `posted_at`).

### 6.3 Pembangun laporan (`OpnameReportBuilder`)
Satu komponen yang menyusun laporan dari item sesi, dipakai oleh pratinjau, menunggu persetujuan, dan posted. Aturan:
- Struktur kategori → sub-kategori mengikuti pohon dari #3 (termasuk simpul 'Lainnya' untuk kategori yang sudah dihapus/dipindah).
- Hanya produk dengan `diff_qty ≠ 0` yang menjadi baris produk. Node tanpa selisih tetap ada dengan `variance_count = 0` dan **tanpa** baris.
- Totals dihitung dengan query berkelompok (tanpa N+1).
- Sebelum pengajuan, nilai dihitung dari harga pokok saat itu dan **ditandai sementara**; setelah pengajuan/posting, memakai `unit_cost_snapshot` dan total beku.
- Bagian nilai rupiah hanya dimasukkan bagi peran berhak (5.7); sisi server menghapus kuncinya (bukan hanya menyembunyikannya di UI).
- `revised` pada baris berasal dari `revision_count` (diturunkan dari log hitungan).

### 6.4 Aturan bisnis ringkas
- Pengajuan/posting hanya dari `in_progress` dengan seluruh produk dihitung (`409 counting_incomplete` bila belum).
- Hasil keputusan 'perlu persetujuan' dibekukan saat pengajuan, beserta alasannya.
- Persetujuan hanya dari `pending_approval` oleh pemilik `opname.approve`, dengan konfirmasi password Owner yang benar.
- Penolakan wajib menyertakan alasan, mengembalikan sesi ke `in_progress`, dan menghapus data beku pengajuan (`unit_cost_snapshot`, total beku) agar dihitung ulang pada pengajuan berikutnya.
- Eksekusi posting: untuk setiap item berselisih, tulis satu pergerakan stok (jenis masuk bila lebih, keluar bila kurang) dengan referensi sesi, simpan `stock_movement_id`, lalu ubah status menjadi `posted`, catat `posted_*`, tulis jejak, dan lepaskan kunci.
- Sesi `posted` **tidak dapat diubah** (hitungan, pembatalan, posting ulang ditolak dengan galat yang jelas).
- Tidak ada penghapusan sesi.

### 6.5 Pengaturan dan notifikasi
- Tambahkan kunci di 5.11 pada mekanisme konfigurasi yang sama dengan `opname.show_system_qty`. Endpoint ubah: hanya Owner. Validasi bilangan bulat ≥ 1 untuk ambang. Audit log.
- Respons pengaturan **tidak** mengirim nilai ambang kepada peran yang bukan Owner/pemilik `opname.view_value`.
- **Notifikasi** (bila infrastruktur ada): saat sesi masuk `pending_approval`, buat notifikasi untuk Owner; saat disetujui atau ditolak, notifikasi untuk pengaju. Bila tidak ada, catat sebagai temuan dan jangan membuat mekanisme baru.

### 6.6 Kontrak API

Ikuti envelope dan format galat yang sudah ada. Bentuk di bawah adalah isi logisnya.

**GET `/api/stock-opname-sessions/{id}/report`** — laporan (izin `opname.view`; pratinjau saat `in_progress` butuh `opname.review`)
```
{
  session: { id, number, name, status, scope_summary, started_at, posted_at?, 
             counted_by: [ {id,name} ], submitted_by?, approved_by?, posted_by?, reject_reason? },
  provisional: boolean,                 // true bila belum dibekukan
  totals: {
    products_total, products_counted, variance_products,
    short_count, over_count, short_qty, over_qty, net_qty,
    short_value?, over_value?, abs_value?          // hanya peran berhak (5.7)
  },
  approval: {
    required: boolean,
    reasons: [ { type: 'per_product'|'per_session'|'first_opname'|'cost_missing', product_id? } ],
    thresholds?: { per_product, per_session }       // hanya peran berhak
  },
  clean: boolean,                       // variance_products == 0
  categories: [
    { id, name, products_counted, variance_count,
      short_qty?, over_qty?,
      lines: [ ...baris produk langsung di kategori ],
      children: [
        { id, name, products_counted, variance_count, lines: [ ... ] }
      ] }
  ]
}
```
Baris produk:
```
{ item_id, product_id, name, barcode,
  system_qty, counted_qty, diff_qty, direction: 'short'|'over',
  value?,                                // hanya peran berhak
  revised: boolean }
```
- Node bersih memiliki `variance_count = 0` dan `lines = []`.
- `system_qty` ditampilkan di laporan karena gerbang 5.4 sudah terpenuhi atau sesi sudah diajukan.
- Bila `in_progress` dan belum semua dihitung: `409 counting_incomplete` dengan `{ products_total, products_counted }` saja.

**POST `/api/stock-opname-sessions/{id}/submit`** — Posting Opname oleh Admin/Owner (izin `opname.post`)
Body: `{ client_request_id, owner_password? }`.
- Membekukan snapshot, memutuskan perlu persetujuan atau tidak.
- Bila **tidak** perlu persetujuan (atau pengaju adalah Owner dengan `owner_password` benar): mengeksekusi posting, mengembalikan `status: posted` + laporan ringkas.
- Bila **perlu** persetujuan: status `pending_approval`, mengembalikan `status` dan `approval`.
- 409 bila belum semua dihitung atau status bukan `in_progress`; 422 untuk password Owner salah (bila diperlukan); 409 `stock_changed_during_opname` bila integritas gagal.

**POST `/api/stock-opname-sessions/{id}/approve`** (izin `opname.approve`)
Body: `{ client_request_id, owner_password }`. Mengeksekusi posting dari `pending_approval`. 422 bila password salah. 409 bila status bukan `pending_approval`.

**POST `/api/stock-opname-sessions/{id}/reject`** (izin `opname.approve`)
Body: `{ client_request_id, reason }` (wajib). Mengembalikan ke `in_progress`.

**Tambahan pada endpoint daftar/detail sesi (aditif):** `variance_products`, `posted_at`, `approval_required`, dan nama pengaju/penyetuju untuk dipakai daftar sesi.

**Pengaturan:** kunci di 5.11 melalui endpoint konfigurasi yang sudah ada (Owner untuk ubah).

### 6.7 Izin akses (usulan, sesuaikan dengan permission matrix yang ada)
- `opname.review` (lihat pratinjau selisih setelah semua dihitung): Owner, Admin.
- `opname.post` (mengajukan/memposting): Owner, Admin.
- `opname.approve` (menyetujui/menolak): **Owner saja**.
- `opname.view_value` (melihat nilai rupiah): peran yang berhak melihat harga modal (default Owner, Accounting).
- Laporan sesi `posted` terlihat oleh pemilik `opname.view`.

### 6.8 Performa
- `report` pada sesi 5.000 item dengan beberapa ratus baris selisih: kurang dari sekitar 1 detik.
- Eksekusi posting 300 baris selisih: selesai dalam beberapa detik dalam satu transaksi. Laporkan angka ukurnya; bila terlalu lambat, jangan menyembunyikannya.

### 6.9 Test backend (wajib lolos)

**Laporan**
1. Sesi **bersih**: `clean = true`, `variance_products = 0`; seluruh kategori dan sub-kategori cakupan tetap ada dengan `variance_count = 0` dan tanpa baris produk.
2. Sesi dengan selisih: **hanya** produk berselisih yang menjadi baris; node bersih tetap ada tanpa baris; total benar.
3. Gerbang: `in_progress` dengan produk belum dihitung → 409 `counting_incomplete` tanpa data selisih apa pun; setelah semua dihitung → laporan tersedia.
4. Peran tanpa hak nilai: kunci nilai, ambang, dan alasan rupiah **tidak ada** di respons.
5. Produk yang dihitung ulang ditandai `revised`.

**Persetujuan**
6. Batas inklusif: nilai tepat sama dengan ambang per produk memicu persetujuan; satu rupiah di bawahnya tidak.
7. Ambang per sesi memakai **jumlah nilai mutlak**: selisih kurang dan lebih yang saling meniadakan tetap memicu.
8. Aturan opname pertama: tanpa sesi `posted` sebelumnya memicu persetujuan; setelah ada, tidak; mati bila pengaturan dimatikan.
9. Produk dengan harga pokok kosong/nol memicu persetujuan (`cost_missing`).
10. Di bawah semua ambang: Admin memposting langsung. Perlu persetujuan: status `pending_approval`.
11. Hanya Owner yang bisa menyetujui/menolak; Admin 403. Password Owner salah ditolak. Owner memposting langsung dengan password benar.
12. Penolakan mengembalikan ke `in_progress`, mewajibkan alasan, mencatat jejak, menghapus snapshot, dan membuka kembali hitungan.
13. Selama `pending_approval`, hitungan ditolak dan toko tetap terkunci.

**Posting**
14. Eksekusi: satu pergerakan stok per produk berselisih dengan referensi sesi (lolos penjaga lewat pengecualian), stok akhir = `counted_qty`; produk bersih tidak mendapat pergerakan.
15. Atomisitas: bila satu pergerakan gagal, **tidak ada** stok yang berubah dan status tetap.
16. Integritas: bila stok berbeda dari `system_qty_at_count`, posting dibatalkan seluruhnya dengan `stock_changed_during_opname`.
17. Idempotensi: `client_request_id` ganda tidak menggandakan pergerakan, jejak, atau perubahan status.
18. Snapshot: `unit_cost_snapshot` yang dipakai saat persetujuan sama dengan yang dipakai saat posting; perubahan harga pokok setelahnya tidak mengubah laporan.
19. Setelah `posted`: kunci dilepas (transaksi stok normal kembali), sesi tidak bisa diubah, dan riwayat stok produk memuat referensi 'Opname {nomor}'.
20. Total beku pada sesi sesuai laporan.

**Pengaturan dan izin**
21. Ambang: validasi bilangan bulat ≥ 1; hanya Owner yang dapat mengubah; perubahan tercatat; nilai ambang tidak terkirim ke peran yang tidak berhak.
22. Matriks izin: 401/403/berhasil untuk setiap endpoint dan peran.
23. Notifikasi pengajuan/keputusan terkirim (bila infrastruktur ada).
24. Seluruh test dari Handoff #1 sampai #5 tetap hijau.
25. Uji performa (6.8) dan laporkan angkanya.

Pengguna menjalankan `php artisan test` di mesinnya. Sertakan perintah yang tepat dan hasil yang diharapkan di laporan serah terima.

## 7. Bagian B — Frontend

Stack: React + Vite + TypeScript. **Ikuti library, struktur folder, dan pola yang sudah ada.** Jangan menambah library UI baru tanpa alasan kuat.

### 7.1 Komponen `OpnameReport` (inti, dipakai di tiga keadaan)
Satu komponen laporan yang dipakai untuk **pratinjau** (`in_progress`, semua dihitung), **menunggu persetujuan**, dan **final** (`posted`). Dirancang **ringkas dan mudah dibaca**:

1. **Kop:** nomor, nama, status (lencana teks), cakupan, tanggal posting/mulai, serta orang: yang menghitung, mengajukan, menyetujui, memposting. Pada pratinjau/menunggu persetujuan tampilkan label **'Sementara'** yang jelas.
2. **Banner hasil** (satu baris, besar):
   - Bersih: **'✓ Tidak ada selisih'** + 'Seluruh {X} produk di {Y} kategori cocok'.
   - Berselisih: **'{N} produk berselisih'** dari {X} dihitung.
3. **Kartu angka** (maksimal 4, kecil): Produk dihitung · Berselisih · Kurang (jumlah) · Lebih (jumlah). Bagi peran berhak, tambahkan satu kartu **Nilai selisih** (total mutlak). Peran lain tidak melihat kartu nilai.
4. **Daftar kategori → sub-kategori** (inti laporan):
   - Baris kategori: nama · jumlah produk dihitung · penanda hasil (**'✓ 0 selisih'** atau **'{n} selisih'**).
   - Kategori/sub-kategori **bersih**: satu baris ringkas, **tidak bisa dibuka**, penanda hijau dengan ikon centang.
   - Kategori/sub-kategori **berselisih**: terbuka secara default, menampilkan hanya **baris produk yang berselisih**.
   - Urutan: ikuti urutan pohon (abjad/`sort_order`). Kategori berselisih **tidak** dipindah ke atas; urutan stabil agar laporan mudah dibandingkan antar-opname.
5. **Baris produk** (sangat ringkas):
   - **HP:** dua baris. Baris 1: nama produk. Baris 2: `Sistem 25 → Hitung 22` dan lencana selisih **'▼ −3'** (kurang) atau **'▲ +2'** (lebih); bila peran berhak, nilai rupiah di kanan; penanda **'↻'** bila dihitung ulang.
   - **Desktop:** tabel dengan kolom Produk · Sistem · Hitung · Selisih · (Nilai) · ↻.
6. **Kontrol:** satu sakelar **'Tampilkan kategori bersih'** (default hidup, agar cakupan selalu terlihat), serta tombol buka/tutup semua.
7. **Cetak:** gaya cetak sederhana (A4) yang memuat kop, banner, kartu angka, dan daftar tanpa elemen navigasi. Ekspor CSV/PDF **bukan** bagian handoff ini.

Penanda status tidak boleh hanya warna: kurang = merah + ▼ + tanda minus; lebih = biru/kuning + ▲ + tanda plus; bersih = hijau + ✓ + teks '0 selisih'. Pastikan kontras cukup dan teks tidak terpotong di 375px.

### 7.2 Perubahan halaman sesi berdasarkan status
- **`in_progress`:** tata letak hitung dari #3 sampai #5. Di tampilan **Ringkasan**: bila belum semua dihitung, tampilkan hanya progres (tanpa selisih) beserta keterangan 'Selisih terlihat setelah semua produk dihitung'. Bila sudah semua dihitung: tampilkan **`OpnameReport` pratinjau** dengan label 'Sementara' dan aksi **'Hitung ulang'** pada baris selisih (memanggil `selectItem`, berpindah ke tampilan Input di HP).
- **`pending_approval`:** halaman **berpusat pada laporan** (bukan tata letak hitung). Admin melihat spanduk 'Menunggu persetujuan Owner' dan, bila ditolak sebelumnya, tidak ada. Owner melihat tombol **Setujui** dan **Tolak** (7.4).
- **`posted`:** halaman berpusat pada laporan final, baca saja. Tidak ada form hitung, tidak ada penangkap scanner.
- **`cancelled`:** seperti #3 (baca saja dengan spanduk).
- Bila sebelumnya **ditolak**, tampilkan spanduk berisi alasan penolakan, siapa, dan kapan, di atas tata letak hitung.

### 7.3 Tombol 'Posting Opname' (ruang di header dari #3)
- Tampil bagi pemilik `opname.post` pada sesi `in_progress`; **nonaktif** (dengan keterangan 'Semua produk harus dihitung dulu') sampai semua dihitung.
- Mengetuk membuka **lembar konfirmasi** (layar penuh di HP): ringkasan hasil (jumlah produk berselisih, kurang/lebih; nilai total bagi peran berhak), kemudian salah satu:
  - Tidak perlu persetujuan: tombol **'Posting'**.
  - Perlu persetujuan (Admin): tombol **'Ajukan ke Owner'** dengan keterangan alasannya secara umum (tanpa angka rupiah dan tanpa ambang bagi peran tak berhak).
  - Pengaju Owner: kolom **konfirmasi password Owner** lalu 'Posting'.
- Tombol nonaktif dan indikator memuat saat mengirim. `client_request_id` dibuat saat lembar dibuka dan dipakai ulang bila pengiriman diulang (galat jaringan tidak boleh menggandakan posting).
- Setelah sukses, arahkan ke tampilan laporan sesuai status baru. Peringatan yang jelas: posting menyesuaikan stok sistem dan tidak bisa dibatalkan.
- Galat `stock_changed_during_opname` tampil dengan daftar produk dan petunjuk menghubungi pengelola sistem.

### 7.4 Layar persetujuan Owner
- Di sesi `pending_approval`, Owner melihat laporan lengkap **dengan nilai rupiah**, **alasan perlu persetujuan** (per produk, per sesi, opname pertama, atau harga pokok kosong beserta produk terkait), dan dua aksi besar:
  - **Setujui:** lembar dengan kolom konfirmasi password Owner, lalu mengeksekusi posting.
  - **Tolak:** lembar dengan alasan wajib; hasilnya sesi kembali ke `in_progress`.
- Nonaktif dan indikator memuat saat mengirim; `client_request_id` seperti di 7.3.
- Bila notifikasi tersedia, Owner dapat membuka sesi dari notifikasi.

### 7.5 Daftar sesi dan pengaturan
- **Daftar sesi (tab Opname):** untuk sesi `posted`, tampilkan **'✓ Bersih'** atau **'{n} selisih'**; untuk `pending_approval`, lencana 'Menunggu persetujuan'. Mengetuk membuka laporan.
- **Pengaturan ambang** pada bagian 'Opname' di setting admin: dua kolom nominal rupiah (dengan pemisah ribuan, awalan 'Rp', nilai bulat ≥ 1), sakelar 'Opname pertama selalu perlu persetujuan Owner', dan penjelasan singkat cara kerja ambang (salah satu ambang terlewati = perlu Owner; ambang per sesi menjumlahkan nilai selisih tanpa saling meniadakan). **Hanya Owner yang dapat mengubah**; peran lain tidak melihat nilai ambang. Simpan dengan konfirmasi dan tampilkan nilai yang baru tersimpan.

### 7.6 Responsivitas (mobile-first)
- Titik patah: ikuti konfigurasi yang ada (HP di bawah 768px, tablet 768–1023px, desktop mulai 1024px). Target sentuh minimal 44px. Tanpa scroll horizontal.
- Lembar konfirmasi dan persetujuan: layar penuh di HP, modal/drawer mulai 768px.
- Daftar berselisih yang panjang tetap lincah (tanpa merender ratusan baris sekaligus bila belum perlu; gunakan buka-tutup per node).

### 7.7 Tipe dan data
- Buat tipe TypeScript untuk kontrak di 6.6 di satu berkas tipe, dan perluas modul API opname.
- Bila Bagian A belum selesai, bangun Bagian B dengan data tiruan yang mengikuti kontrak persis, termasuk satu skenario sesi **bersih** dan satu sesi **berselisih** dengan node bersih di dalamnya.
- Izin di UI: tombol dan layar hanya tampil sesuai izin; kunci nilai yang tidak ada di respons **tidak boleh** dihitung atau dimunculkan dari sumber lain.

## 8. Kriteria selesai (dicek di browser)

Skenario uji manual, semuanya harus lolos. Gunakan data uji lokal dan perintah simulasi dari #3 bila membantu.

1. Sesi belum selesai dihitung: Ringkasan hanya menampilkan progres; endpoint laporan menolak (cek tab Network: tidak ada data selisih). Tombol Posting Opname nonaktif dengan keterangan.
2. Selesaikan semua hitungan (termasuk beberapa yang berselisih): pratinjau laporan muncul berlabel 'Sementara'. Baris selisih menampilkan sistem, hitung, selisih bertanda, dan '↻' bila dihitung ulang.
3. **Hitung ulang** salah satu produk berselisih lewat aksi di baris: berpindah ke Input, simpan nilai baru, pratinjau diperbarui.
4. **Sesi bersih:** hitung semua sesuai stok sistem. Banner '✓ Tidak ada selisih', **seluruh kategori dan sub-kategori tetap terdaftar dengan '✓ 0 selisih'**, tanpa satu pun baris produk, dan laporan tidak tampak kosong.
5. **Sesi campuran:** kategori bersih tampil satu baris '0 selisih' (tidak bisa dibuka), kategori berselisih terbuka dan hanya memuat produk berselisih. Sakelar 'Tampilkan kategori bersih' menyembunyikan/memunculkan baris bersih.
6. **Admin memposting selisih kecil** (di bawah kedua ambang, dan bukan opname pertama): langsung `posted`, stok produk berselisih menjadi sama dengan hitungan, produk bersih tidak berubah, kunci toko dilepas (checkout kasir normal kembali, spanduk hilang).
7. **Riwayat stok** produk yang berselisih memuat pergerakan dengan referensi 'Opname {nomor}'.
8. **Selisih melewati ambang** (per produk, lalu uji terpisah per sesi dengan selisih saling meniadakan): Admin hanya bisa 'Ajukan ke Owner'; Admin **tidak** melihat angka rupiah atau ambang di mana pun (periksa Network). Sesi menjadi `pending_approval`, toko tetap terkunci, hitungan tidak bisa diubah.
9. **Opname pertama:** pada sistem tanpa sesi `posted` sebelumnya, posting tetap memerlukan Owner walau selisihnya kecil.
10. Login sebagai **Owner**: laporan menampilkan nilai rupiah dan alasan perlu persetujuan. **Tolak** dengan alasan: sesi kembali `in_progress`, Admin melihat spanduk alasan penolakan, hitungan bisa diubah. Ajukan lagi lalu **Setujui** dengan password Owner (uji juga password salah): sesi `posted`, stok berubah, kunci dilepas.
11. **Owner memposting langsung** dengan password Owner: tidak ada langkah persetujuan terpisah.
12. Tekan 'Posting'/'Setujui' berkali-kali dengan cepat dan matikan jaringan di tengah: hanya **satu** posting yang berlaku, tidak ada pergerakan ganda.
13. Sesi `posted`: halaman berpusat pada laporan final, tanpa form hitung atau penangkap scanner; aksi hitungan ditolak bila dipaksa lewat API.
14. Ubah ambang di setting sebagai **Owner**: tersimpan dan memengaruhi posting berikutnya; sebagai **Admin**: tidak bisa mengubah dan tidak melihat nilai.
15. Daftar sesi: sesi `posted` menampilkan '✓ Bersih' atau '{n} selisih'; `pending_approval` berlencana; membuka sesi menampilkan laporan.
16. Cetak (pratinjau cetak browser): kop, banner, kartu angka, dan daftar tampil rapi tanpa elemen navigasi.
17. Layout diuji di **375px** (laporan terbaca tanpa terpotong, lembar konfirmasi layar penuh), **768px**, dan **1280px**. Tanpa scroll horizontal.
18. Seluruh fitur Handoff #1 sampai #5 tetap berfungsi normal.
19. `php artisan test` hijau, serta pemeriksaan tipe, lint, dan build frontend bersih.

Setelah pengujian, **batalkan atau selesaikan semua sesi uji** agar produk tidak terkunci untuk pekerjaan berikutnya.

## 9. Antarmuka yang akan dipakai handoff berikutnya (jangan diubah tanpa laporan)

- Endpoint `report`, `submit`, `approve`, `reject` beserta bentuk laporan (dipakai #8 untuk riwayat, filter, dan ekspor).
- `OpnameReportBuilder` dan kolom beku pada sesi dan item (dipakai #8 untuk rekap dan ekspor).
- Komponen `OpnameReport` (dipakai ulang di #8 untuk tampilan riwayat dan cetak).
- Tabel `stock_opname_approvals` (jejak audit).
- Kunci konfigurasi ambang di 5.11.

**Catatan untuk Handoff #8 (jangan dikerjakan sekarang):** daftar riwayat per periode, filter, dan ekspor memakai laporan beku dari handoff ini. Kolom `source`, `opname_session_id`, dan alasan `opname_result` di `stock_adjustments` (Handoff #1) tidak terpakai oleh desain ini; evaluasi apakah dihapus atau dibiarkan. **Catatan untuk Handoff #7:** scan kamera dan antrean offline hanya memengaruhi tahap hitung; posting tidak boleh dilakukan dari antrean offline.

## 10. Dokumentasi dan serah terima

- Perbarui **satu berkas progres tunggal untuk agent frontend: `docs/ROADMAP_PROGRESS.md`**. Tambahkan bagian 'Adjustment & Opname — Handoff #6' berisi: apa yang baru selesai, daftar endpoint beserta bentuk laporan, siklus status, aturan persetujuan dan kunci pengaturan, izin yang dipakai, nama service/komponen, **keputusan 5.2 (tidak ada baris adjustment per produk) beserta dampaknya**, hasil pemeriksaan awal di bagian 4 beserta asumsi yang ternyata berbeda, hasil uji performa, serta fitur UI apa yang kini bisa dibangun. Jangan membuat berkas progres baru.
- Bila `docs/BACKEND_PROGRESS.md` masih dipakai, cukup tambahkan satu baris rujukan. Jangan menduplikasi isi.
- Gunakan commit kecil dan terarah, misalnya: (1) migration + izin + pengaturan ambang, (2) `OpnameReportBuilder` + test, (3) endpoint `report` + gerbang + test, (4) aturan persetujuan + test, (5) eksekusi posting + integritas + test, (6) `submit`/`approve`/`reject` + jejak + notifikasi, (7) `OpnameReport` (komponen) + gaya cetak, (8) halaman sesi per status, (9) tombol Posting + lembar konfirmasi, (10) layar persetujuan Owner, (11) daftar sesi + pengaturan ambang, (12) dokumentasi.
- Di akhir pekerjaan, tulis **ringkasan serah terima maksimal 10 baris** yang bisa diteruskan ke agent lain: apa yang selesai, apa yang belum, temuan atau asumsi yang berbeda, perintah untuk menjalankan test, dan langkah berikutnya (Handoff #7).

## 11. Larangan

- Jangan membuat baris `stock_adjustments` per produk dari opname, dan jangan mengubah stok dengan query langsung. Seluruh perubahan lewat `InventoryService` dengan referensi sesi.
- Jangan menampilkan baris produk yang tidak berselisih di laporan, dan jangan membuat laporan kosong bila sesi bersih (kategori dan sub-kategori tetap tampil dengan '0 selisih').
- Jangan menampilkan atau mengirim selisih sebelum semua produk dihitung.
- Jangan mengirim nilai rupiah, ambang, atau alasan berbasis rupiah kepada peran yang tidak berhak (hapus di server, bukan hanya di UI).
- Jangan membiarkan Admin menyetujui, atau mengubah ambang.
- Jangan memposting dengan produk belum dihitung, atau bila stok berbeda dari `system_qty_at_count`.
- Jangan membuat posting non-idempotent atau tanpa transaksi tunggal.
- Jangan membuat ekspor CSV/PDF, riwayat per periode, scan kamera, atau antrean offline.
- Jangan menghapus kolom atau alasan yang dicadangkan di Handoff #1.
- Jangan mengubah perilaku `InventoryService`, `OpnameLockService` (selain pemakaian pengecualian yang sudah ada), tab Adjustment, atau respons endpoint yang dipakai fitur lain (hanya penambahan aditif).
- Jangan menambah library UI baru tanpa alasan yang dicatat.
- Jangan melakukan refactor di luar cakupan dokumen ini.
- Jangan menyimpan data sungguhan, kredensial, atau berkas `.env` ke repositori.
