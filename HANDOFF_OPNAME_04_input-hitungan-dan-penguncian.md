# HANDOFF #4 — Input Hitungan Inti + Penguncian Transaksi Selama Opname

Proyek: POS Retail SMK · Seri: Adjustment & Opname (Handoff #4 dari 8) · Dibuat: 7 November 2026 · Status: siap dikerjakan **setelah Handoff #3 selesai dan di-merge**

## 0. Ringkasan untuk agent yang baru bergabung

Handoff #2 membuat sesi opname. Handoff #3 membangun layar kerja opname yang hanya baca (peta progres, kebijakan tampilan stok, konteks aktif, placeholder panel input). **Handoff #4 membuat opname bisa benar-benar dikerjakan:**

1. **Input hitungan:** form kosong dengan scan barcode atau pencarian cepat, input jumlah, simpan, lalu form kosong muncul lagi. Setiap simpan langsung tersimpan di server (itulah 'draft'-nya) dan peta progres di Daftar berubah seketika.
2. **Penguncian transaksi:** pengguna memutuskan opname dilakukan dengan toko **ditutup rapat**: tidak ada penjualan dan tidak ada barang masuk selama sesi berjalan. Karena itu handoff ini juga membangun penjaga di `InventoryService` yang menolak perubahan stok untuk produk yang sedang diopname, plus spanduk dan pesan galat yang jelas di layar kasir dan layar transaksi lain.

Pemakaian utama kelak di **HP** (admin keliling rak). Semua UI mobile-first.

## 1. Konteks seri handoff

| # | Isi | Status |
|---|---|---|
| 1 | Kerangka halaman + tab Adjustment | Selesai |
| 2 | Sesi opname: buat, daftar, status, cakupan | Selesai (lolos test) |
| 3 | Kerangka layar opname + peta progres (baca saja) + pengaturan angka stok | Sedang dikerjakan |
| **4** | **Input hitungan inti + penguncian transaksi** | **Dokumen ini** |
| 5 | Form rekomendasi + alur terpandu per sub-kategori | Berikutnya |
| 6 | Ringkasan selisih + Posting Opname + persetujuan Owner + adjustment otomatis | |
| 7 | Penyempurnaan HP: scan kamera, draft lokal + sinkron | |
| 8 | Riwayat per periode + penutup | |

## 2. Prasyarat dan urutan kerja

**Jangan mulai sebelum Handoff #3 selesai, lolos test, dan di-merge.** Handoff ini bertumpu langsung pada hasil #3 (kebijakan tampilan opname, endpoint `tree` dan `items`, `OpnameWorkspaceContext`, slot `OpnameInputPanel`, pengaturan angka stok) dan mengubah file yang sama. Mengerjakan keduanya bersamaan akan menimbulkan konflik.

Urutan di dalam handoff ini: **Bagian A (backend: penguncian dan hitungan) → Bagian B (frontend: input hitungan) → Bagian C (frontend: dampak penguncian di POS dan layar lain)**. Setelah kontrak di 5.4 final, Bagian B boleh jalan paralel memakai data tiruan.

## 3. Cakupan

**Termasuk:**
- Backend: tabel log hitungan, endpoint simpan/ganti/hapus hitungan, pencarian item dalam sesi, daftar hitungan terbaru, penjaga penguncian di `InventoryService`, endpoint status penguncian, izin `opname.count`, test.
- Frontend: panel Input (form kosong, simpan, riwayat terbaru), pembaruan peta progres secara langsung, perluasan `ProductPicker`; spanduk dan penanganan galat penguncian di POS dan layar transaksi lain; teks peringatan sebelum memulai sesi.

**Tidak termasuk (jangan dikerjakan):**
- 4 form rekomendasi dan alur terpandu (Handoff #5).
- Ringkasan selisih, Posting Opname, persetujuan Owner, pembuatan adjustment otomatis, pengaturan ambang rupiah (Handoff #6).
- Scan kamera, antrean offline, sinkronisasi draft lokal (Handoff #7).
- Menambah produk baru ke sesi yang sedang berjalan (diputuskan: tidak, dihitung di opname berikutnya).
- Penanda 'terkunci' per produk di hasil pencarian POS (di luar cakupan; cukup spanduk dan galat saat transaksi).

## 4. Pemeriksaan awal wajib (sebelum menulis kode)

Dokumen ini ditulis tanpa melihat kode terbaru. **Verifikasi dan catat hasilnya.** Bila sebuah asumsi salah dan memengaruhi desain, **hentikan bagian itu dan laporkan ke pengguna**, jangan improvisasi.

1. Handoff #3 selesai dan test hijau. Catat nama dan bentuk akhir: kebijakan tampilan opname, respons `tree` dan `items`, `OpnameWorkspaceContext`, slot `OpnameInputPanel`, kunci pengaturan, dan perintah simulasi.
2. **Semua jalur yang mengubah stok.** Telusuri seluruh kode (cari penulisan ke tabel stok/pergerakan dan pemanggilan `InventoryService`) dan buat daftarnya: penjualan kasir, penerimaan barang, retur penjualan, retur ke pemasok, penghapusan barang rusak/kedaluwarsa, adjustment manual, saldo awal, dan lainnya. Pastikan **tidak ada jalur yang mengubah stok tanpa melewati `InventoryService`**. Bila ada, laporkan sebelum melanjutkan.
3. Bagaimana `InventoryService` mengunci baris stok dalam transaksi (harus `SELECT ... FOR UPDATE` atau setara di InnoDB), dan titik tunggal tempat penjaga bisa dipasang.
4. Bagaimana referensi dokumen sumber dicatat pada pergerakan stok (dipakai untuk aturan pengecualian di 5.2).
5. Konvensi galat yang sudah ada dan cara API client frontend menanganinya; di mana layar kasir menampilkan galat saat checkout.
6. Letak layar kasir, penerimaan barang, retur, dan form adjustment (Handoff #1) di frontend, serta mekanisme polling ringan yang sudah ada (bila ada).
7. Baca `docs/ROADMAP_PROGRESS.md` (berkas progres tunggal) dan, bila masih dipakai, `docs/BACKEND_PROGRESS.md`.

## 5. Keputusan yang dipakai di handoff ini

**5.0.1 Toko ditutup rapat selama opname (menggantikan keputusan sementara di Handoff #2 bahwa penjualan tidak dikunci).**
- Selama sebuah sesi berstatus `in_progress` **atau** `pending_approval`, perubahan stok ditolak untuk produk yang terkunci.
- Produk terkunci bila: (a) ada sesi aktif dengan cakupan `all` (seluruh produk terkunci, **termasuk produk yang dibuat setelah sesi dimulai**), atau (b) produk ada di item sebuah sesi aktif bercakupan `categories`.
- Dengan demikian opname seluruh toko menutup seluruh toko, sedangkan opname sebagian hanya menutup produk dalam cakupannya. *(Perlu konfirmasi pengguna: bila toko harus tertutup total walau opname hanya satu kategori, aturan (b) diganti menjadi penguncian global. Perubahannya terpusat di `OpnameLockService`.)*
- Yang ditolak: **semua** jenis perubahan stok (penjualan, retur, penerimaan barang, adjustment manual, penghapusan barang, dan sejenisnya). Perubahan data non-stok (harga, nama, kategori) tetap diizinkan.
- Kunci dilepas saat sesi `cancelled` atau `posted`. Tidak ada tombol 'paksa' atau pengecualian manual. Satu-satunya pengecualian adalah adjustment hasil posting opname (lihat 5.2).

**5.0.2 Produk baru yang muncul selama opname tidak ditambahkan ke sesi berjalan.** Dihitung di opname berikutnya. Tampilkan satu kalimat informasi di tampilan Ringkasan.

**5.0.3 Aturan simpan hitungan.**
- Jumlah adalah **bilangan bulat ≥ 0** (satuan terkecil). Nilai `0` sah ('ada di daftar tetapi tidak ditemukan di rak'), tetapi field jumlah **tidak boleh terisi nol secara otomatis**; petugas harus mengisinya.
- Batas atas tetap dan generik (mis. 1.000.000) untuk menolak salah ketik ekstrem. **Dilarang memberi peringatan yang bergantung pada stok sistem** (mis. 'jumlah jauh lebih besar dari stok'), karena itu membocorkan stok pada mode buta.
- Produk yang **belum pernah dihitung**: satu tombol **Simpan**.
- Produk yang **sudah pernah dihitung**: form menampilkan 'Sudah dihitung: N' dan **dua tombol eksplisit**: **'Ganti jadi X'** (menimpa hitungan) dan **'Tambah X (jadi N+X)'** (menjumlahkan, untuk produk yang tersebar di beberapa tempat seperti rak, display, dan gudang). Tidak ada default tersembunyi; petugas memilih satu.
- Setiap simpan **langsung tersimpan di server** (tidak ada konsep draft terpisah). Menutup aplikasi lalu membukanya kembali melanjutkan dari kondisi terakhir.
- Hanya sesi `in_progress` yang boleh dihitung. Peringatan: hitungan bisa dikoreksi kapan pun selama sesi `in_progress`.
- Hitungan boleh dilakukan beberapa perangkat sekaligus (penguncian baris menjaga jumlah tetap benar).

**5.0.4 Stok sistem saat dihitung.** Saat menyimpan hitungan, server membaca stok sistem saat itu **di bawah penguncian baris stok** dan menyimpannya di `system_qty_at_count`. Karena toko ditutup, nilainya normalnya sama dengan `system_qty_at_start`, tetapi pembacaan di bawah kunci menutup celah transaksi yang sedang berjalan saat sesi dimulai.

**5.0.5 Kebijakan tampilan (hitung buta) tetap dari Handoff #3.** Semua respons memakai kebijakan tampilan yang sama. Saat mode buta, tidak ada `system_qty`, tidak ada status `matched`/`variance`, dan pesan galat tidak boleh memuat angka stok. Saat pengaturan hidup, form menampilkan stok sistem dan pratinjau selisih.

## 6. Bagian A — Backend

### 6.1 Prinsip
- Perubahan pada `InventoryService` bersifat **aditif**: tambahkan penjaga, jangan mengubah perilaku yang ada untuk produk yang tidak terkunci.
- Penyimpanan hitungan dan penulisan log berada dalam **satu transaksi**.
- Handoff ini **tidak mengubah stok produk** sama sekali dan tidak membuat adjustment. Hitungan hanya mencatat apa yang ditemukan; stok baru berubah saat posting (Handoff #6).
- Seluruh respons opname memakai kebijakan tampilan dari Handoff #3.

### 6.2 `OpnameLockService` dan penjaga di `InventoryService`
Buat `OpnameLockService` dengan method seperti:
- `lockedProducts(array $productIds): array` — mengembalikan peta `product_id => nomor sesi` untuk produk yang terkunci, dengan **satu query berkumpulan** (bukan satu per produk).
- `hasStoreWideLock(): ?Session` — apakah ada sesi aktif berstatus `all`.
- `activeSessionsSummary(): array` — untuk endpoint status (6.4).

Aturan penjaga:
- Pasang di **satu titik** `InventoryService` yang dilewati seluruh perubahan stok. Penjaga dijalankan **di dalam transaksi, setelah baris stok dikunci**, supaya tidak ada celah antara pengecekan dan penulisan.
- Bila ada produk terkunci, lempar `StockLockedByOpnameException`. Dipetakan ke HTTP **409** dengan kode galat `stock_locked_by_opname` dan muatan `locked_products: [{ product_id, name, session_number }]`. Muatan tidak boleh memuat angka stok.
- **Transaksi multi-baris bersifat semua-atau-tidak:** bila satu baris terkunci, seluruh transaksi ditolak dan semua produk terkunci dilaporkan sekaligus.
- **Pengecualian tunggal:** pergerakan yang membawa referensi dokumen sumber berupa **sesi opname yang aktif dan memuat produk itu**. Pengecualian ini disiapkan sekarang (mekanisme dan test) untuk dipakai posting di Handoff #6. Tidak ada parameter bebas semacam `bypass=true`; kecocokan sesi dan produk selalu diperiksa.

### 6.3 Data: tabel `stock_opname_count_logs` (usulan, sesuaikan dengan konvensi)

| Kolom | Keterangan |
|---|---|
| id | PK |
| session_id, item_id | FK |
| product_id | Untuk kemudahan penelusuran |
| action | `set`, `add`, atau `clear` |
| input_qty | Angka yang diketik petugas (null untuk `clear`) |
| counted_before, counted_after | Nilai `counted_qty` sebelum dan sesudah (nullable) |
| client_request_id | UUID **unik**, kunci idempotensi |
| created_by | FK user |
| created_at | Timestamp |

Indeks: (`session_id`, `created_at`), `item_id`. Log bersifat tambah-saja (tidak diubah atau dihapus).

Kolom hitung pada `stock_opname_items` (`counted_qty`, `system_qty_at_count`, `counted_at`, `counted_by`) kini diisi oleh service hitungan, bukan lagi hanya oleh perintah simulasi.

### 6.4 Kontrak API

Ikuti envelope dan format galat yang sudah ada. Bentuk di bawah adalah isi logisnya.

**POST `/api/stock-opname-sessions/{id}/counts`** — simpan hitungan (izin `opname.count`)
Body: `{ item_id, mode: 'set' | 'add', quantity, client_request_id }`.
- `quantity`: bulat ≥ 0 dan ≤ batas atas. Untuk `add`, minimal 1.
- `mode = add` pada item yang belum dihitung berperilaku sama seperti `set`.
- Proses dalam satu transaksi: kunci baris item dan baris stok produk, baca stok saat ini, hitung nilai baru (`set` menimpa, `add` menjumlahkan), simpan `counted_qty`, `system_qty_at_count`, `counted_at`, `counted_by`, tulis log.
- 200/201 + isi:
```
{
  item: { ...bentuk item dari Handoff #3, sesuai kebijakan tampilan },
  summary: { total_products, counted_products },
  nodes: [ { id, counted_count, product_count, status, variance_count? } ]  // rantai induk dari node item sampai akar
}
```
  `nodes` dipakai frontend memperbarui peta progres langsung tanpa menunggu polling.
- Idempotensi: `client_request_id` yang sama mengembalikan hasil yang sama (HTTP 200) tanpa menulis log atau mengubah nilai lagi.
- 422 untuk validasi; 409 bila sesi bukan `in_progress` (kode galat jelas); 404 bila item bukan bagian sesi; 401/403 untuk autentikasi dan izin.

**POST `/api/stock-opname-sessions/{id}/counts/{itemId}/clear`** — hapus hitungan produk (izin `opname.count`)
Body: `{ client_request_id }`. Mengembalikan item ke `uncounted`, menulis log `clear`. Isi respons sama seperti di atas. Hanya untuk sesi `in_progress`.

**GET `/api/stock-opname-sessions/{id}/lookup?q=`** — cari item dalam sesi untuk form input (izin `opname.count`)
- Kecocokan **barcode persis** mengembalikan tepat satu item. Pencarian nama mengembalikan maksimal 10 item (minimal 2 karakter), urut abjad.
- Bentuk item sama seperti `items` di Handoff #3 (kebijakan tampilan berlaku), ditambah `category_path`.
- Bila barcode tidak ada di sesi, kembalikan 404 dengan kode galat yang **membedakan**: `not_in_session` (barcode dikenali di master produk tetapi tidak ada di sesi ini; sertakan nama produk, tanpa data stok) dan `unknown_barcode` (barcode tidak dikenal sama sekali).

**GET `/api/stock-opname-sessions/{id}/counts?limit=10`** — hitungan terbaru (izin `opname.count`)
Daftar log terbaru (maksimal 10, default 10) milik sesi: `{ log_id, item (ringkas: id, name, barcode), action, input_qty, counted_after, created_at, created_by }`. `counted_after` boleh tampil karena itu data hitungan petugas, bukan stok sistem.

**GET `/api/stock-opname/lock-status`** — status penguncian (cukup login, **tanpa** izin opname, karena kasir perlu tahu)
```
{ locked: boolean, store_wide: boolean, sessions: [ { number, scope_summary } ] }
```
Tidak memuat data stok atau produk. Dipakai spanduk di POS.

### 6.5 Izin akses (usulan, sesuaikan dengan permission matrix yang ada)
- `opname.count`: Owner, Admin.
- `lock-status`: semua pengguna yang login.
- Izin `opname.view`, `opname.create`, `opname.cancel` tidak berubah.

### 6.6 Performa
- `counts` (satu simpan): kurang dari sekitar 200 ms pada data uji 5.000 item.
- Penjaga penguncian: **satu query** per transaksi (batched), bukan satu per baris. Ukur dampaknya pada checkout kasir dengan 20 baris dan laporkan angkanya.
- `lookup`: kurang dari sekitar 150 ms. Bila target tidak tercapai, laporkan angka ukurnya dan usulan perbaikan.

### 6.7 Test backend (wajib lolos)

**Hitungan**
1. `set` pada item belum dihitung: `counted_qty`, `system_qty_at_count` (sama dengan stok saat itu), `counted_at`, `counted_by` terisi, log `set` tertulis.
2. `set` kedua menimpa. `add` menjumlahkan. `add` pada item belum dihitung sama dengan `set`.
3. Nilai `0` diterima. Negatif, pecahan, bukan angka, dan di atas batas atas: 422.
4. Item bukan bagian sesi: 404. Sesi bukan `in_progress` (dibatalkan, `pending_approval`, `posted`): 409.
5. Idempotensi: dua POST dengan `client_request_id` sama menghasilkan satu log dan satu perubahan nilai.
6. Dua permintaan `add` bersamaan pada item yang sama menghasilkan jumlah yang tepat (tidak ada nilai hilang).
7. `clear` mengembalikan ke `uncounted` dan menulis log; `counted_products` turun.
8. Respons `counts`: `nodes` berisi rantai induk dengan angka dan status benar; status agregasi sesuai aturan di Handoff #3.
9. **Hitung buta:** dengan pengaturan mati, respons `counts`, `lookup`, dan daftar hitungan terbaru **tidak memuat** `system_qty`, `variance_count`, maupun status `matched`/`variance` (kunci tidak ada), dan **pesan galat apa pun tidak memuat angka stok**. Dengan pengaturan hidup, semuanya muncul.
10. `lookup`: barcode persis, pencarian nama terbatas pada item sesi, `not_in_session` vs `unknown_barcode`.
11. Izin: 401, 403 untuk role tanpa `opname.count`, berhasil untuk role berizin.
12. Stok produk **tidak berubah** oleh operasi hitungan apa pun, dan tidak ada adjustment yang terbentuk.

**Penguncian**
13. Selama sesi `all` aktif: penjualan, penerimaan barang, retur penjualan, retur ke pemasok, penghapusan barang, dan adjustment manual (Handoff #1) semuanya ditolak dengan 409 `stock_locked_by_opname`, termasuk untuk produk yang dibuat **setelah** sesi dimulai.
14. Selama sesi `categories` aktif: hanya produk dalam cakupannya yang ditolak; produk di luar cakupan tetap bisa bertransaksi.
15. Transaksi multi-baris dengan satu baris terkunci: ditolak seluruhnya, semua produk terkunci dilaporkan, stok tidak berubah.
16. `pending_approval` tetap mengunci. `cancelled` dan `posted` melepas kunci.
17. Pengecualian: pergerakan yang membawa referensi sesi aktif yang memuat produk itu **lolos**; referensi sesi yang salah, sesi tidak aktif, atau produk di luar sesi **ditolak**.
18. Muatan galat `locked_products` tidak memuat angka stok.
19. `lock-status` bisa diakses semua pengguna login dan tidak memuat data stok.
20. Penjaga tidak mengubah perilaku untuk transaksi tanpa sesi aktif (seluruh test stok yang sudah ada tetap hijau).
21. Uji performa sederhana (lihat 6.6) dan laporkan angkanya.

Pengguna menjalankan `php artisan test` di mesinnya. Sertakan perintah yang tepat dan hasil yang diharapkan di laporan serah terima.

## 7. Bagian B — Frontend: input hitungan

Stack: React + Vite + TypeScript. **Ikuti library, struktur folder, dan pola yang sudah ada.** Jangan menambah library UI baru tanpa alasan kuat.

### 7.1 Panel Input (menggantikan placeholder di `OpnameInputPanel`)
Isi panel dari atas ke bawah:
1. **Form hitungan** (`CountEntryForm`).
2. **Terakhir diinput:** daftar hingga 10 hitungan terbaru dari sesi ini (nama produk, jumlah hasil hitung, waktu). Mengetuk satu baris memuat produk itu ke form untuk dikoreksi.

Di HP panel ini adalah tampilan **Input** (tampilan utama). Di tablet dan desktop berada di panel kanan.

### 7.2 Perilaku `CountEntryForm`
- **Keadaan kosong:** `ProductPicker` dengan **autofocus**. Scanner barcode fisik (bertindak seperti keyboard) berfungsi seketika. Barcode yang cocok persis langsung memilih produk dan memindahkan fokus ke field jumlah. Pencarian nama menampilkan hingga 10 hasil dalam sesi.
- **Setelah produk dipilih:** tampilkan nama, barcode, `category_path`, dan status. Bila produk sudah dihitung: tampilkan 'Sudah dihitung: N'. Jika pengaturan angka stok hidup, tampilkan juga stok sistem dan **pratinjau selisih** sebelum simpan; jika mati, **tidak ada petunjuk stok atau selisih sama sekali**.
- **Field jumlah:** `inputmode=numeric`, kosong secara default (bukan 0), dengan tombol + dan − yang besar serta satu tombol cepat **'0 — tidak ada'**. Enter menyimpan.
- **Tombol simpan** sesuai 5.0.3: produk belum dihitung → satu tombol **Simpan**; produk sudah dihitung → **'Ganti jadi X'** dan **'Tambah X (jadi N+X)'**.
- Selama mengirim: tombol **nonaktif + indikator memuat** (mencegah tap ganda).
- **Sukses:** notifikasi singkat, sorotan sesaat pada baris produk di Daftar, form **dikosongkan dan fokus kembali ke pemilih produk**, daftar 'Terakhir diinput' diperbarui. Node aktif (`activeNodeId`) diatur ke kategori produk yang baru dihitung.
- `client_request_id` (UUID) dibuat saat sebuah produk dipilih dan **dipakai ulang bila pengiriman diulang**; dibuat baru setelah sukses atau saat produk berganti.
- **Gagal jaringan:** tampilkan pesan dengan opsi coba lagi dan **jangan kosongkan isian**. Pengulangan memakai `client_request_id` yang sama (tidak membuat hitungan ganda). Tanpa antrean offline (Handoff #7).
- **Galat dari server:** 422 tampil di field terkait; 409 sesi tidak aktif menampilkan pesan jelas dan menonaktifkan form.
- **Barcode tidak ditemukan:** `not_in_session` menampilkan 'Produk **{nama}** tidak termasuk dalam sesi ini (produk baru dihitung di opname berikutnya)'; `unknown_barcode` menampilkan 'Barcode tidak dikenal'. Keduanya tidak mengosongkan form, dan fokus tetap di pemilih.
- **Memuat dari Daftar:** mengetuk baris produk di panel Daftar memuat produk itu ke form (di HP, berpindah ke tampilan Input). Untuk produk yang sudah dihitung, tersedia aksi **'Hapus hitungan'** dengan konfirmasi singkat.
- Hanya sesi `in_progress` yang menampilkan form aktif; sesi lain menampilkan keterangan mode baca.
- Aksesibilitas: label dan urutan tab yang benar, pengumuman hasil simpan lewat `aria-live`, target sentuh minimal 44px.

### 7.3 Aturan khusus HP
- Saat keyboard layar muncul, field jumlah dan tombol simpan **harus tetap terlihat** (gulirkan ke tampilan; gunakan satuan tinggi viewport dinamis).
- Tombol simpan besar dan mudah dijangkau ibu jari.
- Header progres tipis menampilkan konteks aktif dan berubah setelah setiap simpan (mis. 'Mi Instan 13/30 · Makanan 4/11').

### 7.4 Perluasan `ProductPicker` (dari Handoff #1)
Tambahkan **adaptor sumber data** sebagai prop opsional (mis. `searchAdapter`) sehingga picker bisa mencari lewat `lookup` sesi alih-alih endpoint produk umum. Tanpa prop itu perilaku lama (form adjustment) harus **tetap persis sama**. Default tetap tanpa tampilan stok. Uji bahwa form adjustment Handoff #1 tidak berubah.

### 7.5 Pembaruan peta progres langsung
- Gunakan hook bersama, mis. `useCountMutation`, yang akan dipakai ulang di Handoff #5.
- Setelah simpan sukses, **perbarui cache pohon dari `nodes` dan `summary` pada respons** sehingga Daftar berubah seketika, lalu invalidasi item node terkait. Polling dari Handoff #3 tetap berjalan sebagai rekonsiliasi.
- Pertahankan status buka/tutup node dan posisi gulir (tidak boleh melompat).
- Status produk yang tampil mengikuti kebijakan tampilan: mode buta menampilkan 'Sudah dihitung' (dan 'Hitungan: N'), mode terbuka menampilkan cocok atau selisih.

### 7.6 Tipe dan data
- Buat tipe TypeScript untuk kontrak di 6.4 di satu berkas tipe, dan perluas modul API opname dari Handoff #3.
- Bila Bagian A belum selesai, bangun Bagian B dengan data tiruan yang mengikuti kontrak persis, lalu ganti ke API asli saat Bagian A siap.
- Izin di UI: form dan aksi hitungan hanya tampil bagi pemilik `opname.count`.

## 8. Bagian C — Frontend: dampak penguncian di POS dan layar lain

1. **Spanduk status opname di layar kasir.** Panggil `lock-status` saat layar kasir dibuka dan secara berkala (mis. tiap 30 detik, hanya saat layar terlihat). Bila `locked`, tampilkan spanduk yang jelas dan tidak bisa terlewat: 'Opname sedang berjalan. Penjualan {seluruh toko | produk tertentu} sedang ditutup.' Untuk cakupan kategori, sebutkan ringkasan cakupan dari `scope_summary`. Spanduk hilang otomatis saat kunci dilepas.
2. **Penanganan galat `stock_locked_by_opname` secara terpusat.** Buat satu utilitas/handler yang memetakan galat itu menjadi pesan jelas berbahasa Indonesia yang menyebut nama produk terkunci dan nomor sesinya, dan pasang di: checkout kasir, penerimaan barang, retur, form adjustment (Handoff #1), dan layar lain yang berasal dari daftar jalur di bagian 4 poin 2. Catat layar mana saja yang dipasangi di berkas progres. Isian transaksi tidak boleh hilang saat galat ini muncul.
3. **Peringatan sebelum memulai sesi.** Pada alur 'Mulai Opname' (Handoff #2) tambahkan langkah konfirmasi dengan teks yang jelas: selama sesi berjalan, penjualan dan penerimaan barang untuk produk dalam cakupan **akan ditolak**, dan sesi bisa dibatalkan untuk membuka kembali. Tombol akhir bertuliskan jelas (mis. 'Mulai dan tutup transaksi'). Perubahan ini aditif; alur lain di form tidak berubah.
4. **Informasi di Ringkasan:** tambahkan satu kalimat bahwa produk baru yang muncul setelah sesi dimulai tidak ikut dihitung dan baru masuk di opname berikutnya.

## 9. Kriteria selesai (dicek di browser)

Skenario uji manual, semuanya harus lolos. Jalankan di lingkungan lokal.

1. Mulai sesi cakupan **seluruh toko**: langkah konfirmasi menampilkan peringatan penguncian; setelah dimulai, sesi berjalan.
2. **Kasir:** spanduk opname muncul. Mencoba checkout produk apa pun ditolak dengan pesan jelas yang menyebut produk dan nomor sesi; isian keranjang tidak hilang.
3. **Penerimaan barang** dan **adjustment manual** (Handoff #1) untuk produk apa pun ditolak dengan pesan yang sama.
4. Buat produk baru saat sesi `all` berjalan, lalu coba beri stok awal atau barang masuk: ditolak.
5. Di layar opname, scan atau ketik barcode produk, ketik **17**, tekan Enter: tersimpan, form kosong dan fokus kembali ke pemilih. Di Daftar, baris produk berubah menjadi 'Sudah dihitung', angka progres sub-kategori dan kategori bertambah, dan header progres ikut berubah.
6. Hitung produk yang sama lagi: tampil 'Sudah dihitung: 17' dengan dua tombol. **Tambah 3** → hitungan menjadi 20. **Ganti jadi 5** → menjadi 5. Pastikan keduanya tercatat di 'Terakhir diinput'.
7. Cari produk lewat nama: maksimal 10 hasil dari item sesi, memilih salah satunya berfungsi.
8. Scan barcode produk yang ada di master tetapi tidak di sesi (gunakan sesi cakupan kategori): pesan 'tidak termasuk dalam sesi ini'. Scan barcode acak: 'Barcode tidak dikenal'.
9. **Mode buta (default):** periksa tab Network pada semua respons opname: tidak ada `system_qty`, `variance_count`, atau status cocok/selisih, dan tidak ada petunjuk selisih di form. Nyalakan pengaturan angka stok: stok dan pratinjau selisih muncul, status cocok/selisih tampil di Daftar. Matikan lagi: semuanya hilang.
10. Ketuk produk yang sudah dihitung di Daftar: dimuat ke form; **Hapus hitungan** mengembalikannya ke 'Belum' dan progres turun.
11. Matikan jaringan di devtools lalu simpan: pesan galat, isian tetap ada. Nyalakan lagi dan coba lagi: hanya **satu** hitungan tercatat. Tekan Enter dua kali dengan cepat: hanya satu hitungan.
12. Muat ulang halaman di tengah opname: seluruh progres dan 'Terakhir diinput' tetap ada.
13. **Batalkan sesi:** spanduk di kasir hilang dan checkout normal kembali. Mulai sesi `categories` untuk satu kategori: produk di luar kategori itu tetap bisa dijual, produk di dalamnya ditolak.
14. Di HP (375px): tampilan Input terbuka lebih dulu, keyboard numerik muncul, field dan tombol simpan tetap terlihat saat keyboard terbuka, tombol besar, header progres tipis berubah setelah simpan. Uji juga 768px dan 1280px. Tanpa scroll horizontal.
15. Form adjustment (Handoff #1), daftar dan pembuatan sesi (Handoff #2), serta peta progres (Handoff #3) tetap berfungsi normal.
16. `php artisan test` hijau, serta pemeriksaan tipe, lint, dan build frontend bersih.

Setelah pengujian, **batalkan semua sesi uji** agar produk tidak terkunci untuk pekerjaan berikutnya.

## 10. Antarmuka yang akan dipakai handoff berikutnya (jangan diubah tanpa laporan)

- Endpoint `counts`, `clear`, `lookup`, dan bentuk respons (`item`, `summary`, `nodes`) (dipakai #5 dan #6).
- Tabel `stock_opname_count_logs` (dipakai #6 dan #8 untuk jejak audit).
- `OpnameLockService` beserta aturan pengecualian berbasis referensi sesi (dipakai posting di #6).
- Hook `useCountMutation` dan komponen `CountEntryForm` (dipakai ulang di form rekomendasi #5).
- Adaptor sumber data pada `ProductPicker`.
- Nilai `activeNodeId` yang diatur otomatis setelah produk dipilih/dihitung (dipakai #5 untuk mengisi form rekomendasi).

**Catatan untuk Handoff #6 (jangan dikerjakan sekarang):** posting harus berjalan saat sesi masih mengunci toko. Adjustment hasil opname dibuat lewat service adjustment dari Handoff #1 dengan `source = opname`, `reason_code = opname_result`, dan referensi sesi, dan **lolos** penjaga lewat pengecualian di 6.2. Jumlah adjustment per produk dihitung dari `counted_qty − system_qty_at_count`. Kunci dilepas setelah sesi menjadi `posted`.

## 11. Dokumentasi dan serah terima

- Perbarui **satu berkas progres tunggal untuk agent frontend: `docs/ROADMAP_PROGRESS.md`**. Tambahkan bagian 'Adjustment & Opname — Handoff #4' berisi: apa yang baru selesai, daftar endpoint beserta bentuknya, izin yang dipakai, nama service/hook/komponen, **daftar jalur perubahan stok beserta layar yang kini menangani galat penguncian**, hasil pemeriksaan awal di bagian 4 beserta asumsi yang ternyata berbeda, hasil uji performa, serta fitur UI apa yang kini bisa dibangun. Jangan membuat berkas progres baru.
- Bila `docs/BACKEND_PROGRESS.md` masih dipakai, cukup tambahkan satu baris rujukan. Jangan menduplikasi isi.
- Gunakan commit kecil dan terarah, misalnya: (1) `OpnameLockService` + penjaga + test, (2) tabel log + service hitungan, (3) endpoint hitungan/lookup/riwayat + test, (4) endpoint `lock-status`, (5) perluasan `ProductPicker`, (6) `CountEntryForm` + `useCountMutation`, (7) panel Input + 'Terakhir diinput', (8) spanduk dan penanganan galat penguncian, (9) peringatan sebelum mulai, (10) dokumentasi.
- Di akhir pekerjaan, tulis **ringkasan serah terima maksimal 10 baris** yang bisa diteruskan ke agent lain: apa yang selesai, apa yang belum, temuan atau asumsi yang berbeda, perintah untuk menjalankan test, dan langkah berikutnya (Handoff #5).

## 12. Larangan

- Jangan mengubah stok produk atau membuat adjustment dari operasi hitungan.
- Jangan membuat 4 form rekomendasi, alur terpandu, ringkasan selisih, tombol Posting Opname, atau pengaturan ambang rupiah.
- Jangan membuat antrean offline atau scan kamera.
- Jangan memberi peringatan, pesan galat, atau petunjuk apa pun yang bergantung pada stok sistem saat pengaturan angka stok mati.
- Jangan menambahkan parameter bebas untuk melewati penguncian; satu-satunya pengecualian adalah referensi sesi aktif yang memuat produk terkait.
- Jangan menambah produk baru ke sesi yang berjalan.
- Jangan mengubah perilaku `InventoryService` untuk transaksi tanpa sesi aktif, atau perilaku form adjustment dan `ProductPicker` tanpa prop adaptor.
- Jangan menambah library UI baru tanpa alasan yang dicatat.
- Jangan melakukan refactor di luar cakupan dokumen ini.
- Jangan menyimpan data sungguhan, kredensial, atau berkas `.env` ke repositori.
