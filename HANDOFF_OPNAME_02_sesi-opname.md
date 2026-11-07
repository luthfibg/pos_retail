# HANDOFF #2 — Sesi Opname: Buat, Daftar, Status, Cakupan

Proyek: POS Retail SMK · Seri: Adjustment & Opname (Handoff #2 dari 8) · Dibuat: 6 November 2026 · Status: siap dikerjakan setelah Handoff #1 selesai

## 0. Ringkasan untuk agent yang baru bergabung

Halaman **Adjustment & Opname** punya dua tab. Handoff #1 membangun kerangka halaman dan tab Adjustment. **Handoff #2 membangun fondasi tab Opname: sesi opname.** Pengguna bisa memilih cakupan (seluruh toko atau kategori tertentu), memulai sesi, melihat daftar sesi beserta statusnya, membuka ringkasan sesi, dan membatalkan sesi.

Layar menghitung barang (peta progres, form input) **belum** dibangun di sini. Itu Handoff #3 sampai #5. Handoff ini hanya menyiapkan data dan alur sesi agar handoff berikutnya punya fondasi yang stabil.

Pemakaian utama fitur ini kelak di **HP** (admin keliling rak), jadi semua UI mobile-first.

## 1. Konteks seri handoff

| # | Isi | Status |
|---|---|---|
| 1 | Kerangka halaman + tab Adjustment | Selesai (prasyarat) |
| **2** | **Sesi opname: buat, daftar, status, cakupan** | **Dokumen ini** |
| 3 | Kerangka layar opname + peta progres (baca saja), pengaturan tampil/sembunyi angka stok | Berikutnya |
| 4 | Input hitungan inti: form kosong, scan/cari, autosave, progres berwarna | |
| 5 | Form rekomendasi + alur terpandu per sub-kategori | |
| 6 | Ringkasan selisih + Posting Opname + persetujuan Owner + adjustment otomatis | |
| 7 | Penyempurnaan HP: scan kamera, draft lokal + sinkron | |
| 8 | Riwayat per periode + penutup | |

## 2. Cakupan

**Termasuk:**
- Backend: tabel sesi, cakupan, dan item opname; service untuk memulai dan membatalkan sesi; endpoint; izin; test; FK yang dijanjikan di Handoff #1.
- Frontend: tab Opname berisi daftar sesi, alur 'Mulai Opname' (pilih cakupan), halaman ringkasan sesi (`/opname/:id`) beserta aksi batalkan.

**Tidak termasuk (jangan dikerjakan):**
- Layar menghitung, peta progres, form input hitungan, endpoint simpan hasil hitung (Handoff #3 sampai #5).
- Posting, persetujuan Owner, pembuatan adjustment otomatis (Handoff #6).
- Pengaturan 'tampilkan angka stok saat opname' (Handoff #3).
- Penguncian penjualan selama opname, penambahan produk baru ke sesi yang sudah berjalan.
- Riwayat per periode dan ekspor (Handoff #8).

## 3. Pemeriksaan awal wajib (sebelum menulis kode)

Dokumen ini ditulis tanpa melihat kode terbaru. **Verifikasi dan catat hasilnya.** Bila sebuah asumsi salah dan memengaruhi desain, **hentikan bagian itu dan laporkan ke pengguna**, jangan improvisasi.

1. Handoff #1 sudah selesai dan lolos test: kerangka halaman dengan rute bersarang, placeholder tab Opname, `ProductPicker`, tabel `stock_adjustments` (dengan `opname_session_id` tanpa foreign key), service pembuat adjustment.
2. **Struktur kategori produk di master data:** apakah hierarkis (kategori dan sub-kategori, kedalaman berapa), bagaimana produk terkait ke kategori (hanya ke daun atau ke level mana pun), dan apakah ada endpoint daftar kategori beserta jumlah produk.
3. `InventoryService`: bagaimana membaca stok saat ini per produk secara massal (bukan satu per satu), dan apakah stok disimpan per lokasi.
4. Konvensi yang sudah ada: penomoran dokumen, format respons, penamaan permission, paginasi, penanganan validasi.
5. Definisi 'produk aktif' dan apakah ada produk nonaktif yang masih punya stok.
6. Baca `docs/ROADMAP_PROGRESS.md` (berkas progres tunggal) dan, bila masih dipakai, `docs/BACKEND_PROGRESS.md`.

## 4. Keputusan yang dipakai di handoff ini

- **Status sesi** (backend menjadi sumber kebenaran):
  - `in_progress`: sesi berjalan (status awal saat dibuat).
  - `pending_approval`: **dicadangkan** untuk Handoff #6. Belum ada transisi menuju status ini di handoff ini.
  - `posted`: **dicadangkan** untuk Handoff #6.
  - `cancelled`: dibatalkan.
- **Cakupan:** `all` (seluruh toko) atau `categories` (satu atau lebih kategori pada level mana pun; semua turunannya ikut).
- **Satu produk hanya boleh berada di satu sesi aktif** (`in_progress` atau `pending_approval`) pada satu waktu. Membuat sesi yang cakupannya beririsan dengan sesi aktif ditolak dengan galat yang menyebut nomor sesi penyebabnya. Opname sebagian oleh kategori berbeda pada hari berbeda tetap bisa berjalan paralel selama tidak beririsan.
- **Item dibuat di muka:** saat sesi dimulai, sistem membuat satu baris item untuk setiap produk aktif dalam cakupan (termasuk produk bersaldo nol), lengkap dengan snapshot stok sistem saat itu.
- **Penjualan tidak dikunci** selama opname (keputusan sementara, belum final dari pengguna). Skema sudah disiapkan agar selisih nanti dihitung dari `system_qty_at_count` (stok sistem saat produk dihitung, diisi di Handoff #4), sehingga penjualan yang terjadi selama opname tidak merusak hasil. Bila pengguna memutuskan mengunci penjualan, itu penambahan terpisah tanpa mengubah skema ini.
- **Penjagaan hitung buta:** endpoint di handoff ini **tidak boleh mengembalikan stok sistem per item** sama sekali. Hanya ringkasan jumlah. Aturan tampil/sembunyi stok diatur di Handoff #3 dan #4.
- Produk yang dibuat setelah sesi dimulai **tidak** masuk otomatis. Penanganannya diputuskan di Handoff #4. Jangan dibuat sekarang.
- Pembatalan: boleh oleh Owner dan Admin selama status `in_progress`, wajib menyertakan alasan, **tidak mengubah stok** (belum ada yang diposting). Setelah dibatalkan, produk dalam cakupan bebas untuk sesi lain.
- Zona waktu tampilan mengikuti konfigurasi sistem (default WIB). Bahasa UI: Indonesia.

## 5. Bagian A — Backend

Kerjakan Bagian A lebih dulu. Setelah kontrak di 5.5 final, Bagian B boleh jalan paralel memakai data tiruan.

### 5.1 Prinsip
- Pembuatan sesi (sesi + cakupan + seluruh item) dilakukan dalam **satu transaksi database**. Gagal sebagian berarti batal seluruhnya.
- Snapshot stok sistem dibaca dalam transaksi yang sama sehingga konsisten pada satu titik waktu.
- Perubahan pada kode yang sudah ada bersifat **aditif**. Jangan mengubah respons endpoint yang dipakai fitur lain.
- Handoff ini **tidak mengubah stok sama sekali**.

### 5.2 Data (usulan, sesuaikan dengan konvensi)

**Tabel `stock_opname_sessions`**

| Kolom | Keterangan |
|---|---|
| id | PK |
| number | Kode unik, mis. `OPN-261106-0001`. Ikuti penomoran yang ada. Dibuat di dalam transaksi |
| name | Nullable, nama bebas dari pengguna (mis. 'Opname Bulanan November') |
| scope_type | `all` atau `categories` |
| status | Lihat bagian 4 |
| notes | Nullable |
| started_at | Waktu sesi dimulai |
| created_by | FK user |
| cancelled_at, cancelled_by, cancel_reason | Nullable, terisi saat dibatalkan |
| client_request_id | UUID nullable, **unik**, kunci idempotensi |
| created_at, updated_at | Timestamp |

**Tabel `stock_opname_session_categories`** (hanya bila `scope_type = categories`): `session_id`, `category_id`. Menyimpan kategori yang dipilih pengguna, bukan hasil perluasan.

**Tabel `stock_opname_items`**

| Kolom | Keterangan |
|---|---|
| id | PK |
| session_id | FK, `ON DELETE` mengikuti konvensi proyek |
| product_id | FK |
| category_id | Kategori produk saat sesi dimulai |
| product_name_snapshot, barcode_snapshot, category_name_snapshot | Snapshot teks agar riwayat tetap utuh walau master berubah. Bila ada hierarki, simpan juga nama kategori induknya |
| system_qty_at_start | Snapshot stok saat sesi dimulai (diisi sekarang) |
| counted_qty | Nullable, diisi Handoff #4 |
| system_qty_at_count | Nullable, diisi Handoff #4 |
| counted_at, counted_by | Nullable, diisi Handoff #4 |
| created_at, updated_at | Timestamp |

Unik: (`session_id`, `product_id`). Indeks: (`session_id`, `category_id`), `product_id`, dan indeks `status` serta `started_at` pada tabel sesi.

Kolom `counted_qty`, `system_qty_at_count`, `counted_at`, `counted_by` dibuat sekarang (nullable) agar Handoff #4 tidak perlu migration yang menyentuh tabel besar. **Jangan diisi atau diekspos** di handoff ini.

**Migration tambahan:** tambahkan foreign key `stock_adjustments.opname_session_id` ke `stock_opname_sessions.id` (kolom sudah dibuat nullable di Handoff #1). Pastikan data yang ada aman: seluruh nilai saat ini `NULL`.

### 5.3 Aturan bisnis
- Cakupan `categories` wajib memuat minimal satu kategori yang valid dan aktif. Cakupan `all` tidak boleh disertai `category_ids`.
- Perluasan cakupan: setiap kategori yang dipilih menyertakan seluruh turunannya. Produk yang masuk adalah produk aktif yang terkait ke kategori-kategori itu. Hindari duplikat bila pengguna memilih induk dan anak sekaligus.
- Cakupan yang menghasilkan **nol produk** ditolak dengan pesan jelas.
- Cek irisan dengan sesi aktif (lihat bagian 4) dilakukan dalam transaksi yang sama dengan pembuatan, dengan penguncian yang memadai agar dua permintaan bersamaan tidak lolos keduanya.
- **Idempotensi:** `client_request_id` yang sama mengembalikan sesi yang sudah ada (HTTP 200) tanpa membuat sesi baru.
- Pembatalan hanya valid dari `in_progress`. Percobaan pembatalan dari status lain ditolak dengan galat yang jelas.
- Tidak ada endpoint ubah isi cakupan atau hapus sesi.

### 5.4 Performa
Target: memulai sesi `all` pada kira-kira 5.000 produk selesai dalam beberapa detik. Gunakan penyisipan massal (chunked `insert ... select` atau setara) dan baca stok secara massal, **bukan** perulangan satu produk per satu query. Bila target tidak tercapai pada data uji, laporkan angka ukurnya, jangan menyembunyikannya.

### 5.5 Kontrak API

Ikuti envelope dan format galat yang sudah ada. Bentuk di bawah adalah isi logisnya.

**GET `/api/stock-opname-sessions`** (daftar)
Query: `page`, `per_page` (default 20, maks 100), `status`, `q` (nomor atau nama), `date_from`, `date_to`, `sort` (default terbaru dulu).
Item: `id, number, name, scope_type, scope_summary, status, total_products, counted_products, started_at, created_by { id, name }`.
`scope_summary` berupa teks ringkas, mis. 'Seluruh toko' atau 'Makanan, Minuman (+2)'. `counted_products` selalu 0 sampai Handoff #4.

**GET `/api/stock-opname-sessions/{id}`** (ringkasan)
Seluruh field item daftar, ditambah: `notes`, `scope_categories [{ id, name }]`, `cancelled_at`, `cancelled_by`, `cancel_reason`. **Tidak ada data per produk.**

**POST `/api/stock-opname-sessions`** (mulai)
Body: `{ scope_type, category_ids?, name?, notes?, client_request_id }`.
- 201 + ringkasan bila baru dibuat. 200 + sesi yang ada bila `client_request_id` berulang.
- 422 untuk validasi, cakupan kosong, dan irisan. Galat irisan memuat `conflicting_sessions: [{ id, number }]`.
- 401/403 untuk autentikasi dan izin.

**POST `/api/stock-opname-sessions/{id}/cancel`**
Body: `{ reason }` (wajib). 200 + ringkasan terbaru. 422 bila status bukan `in_progress`.

**GET `/api/stock-opname/scope-options`** (untuk pemilih cakupan)
Pohon kategori beserta `product_count` (jumlah **jenis** produk aktif, termasuk turunan) dan penanda kategori yang sedang berada dalam sesi aktif (`locked_by: { id, number } | null`). Jika endpoint kategori yang sudah ada bisa dipakai dengan tambahan parameter secara aditif, lebih baik begitu. Catat keputusanmu di berkas progres.

### 5.6 Service internal (dipakai ulang di handoff berikutnya)
Buat service (mis. `OpnameSessionService`) dengan method `start(...)` dan `cancel(...)`. Controller hanya memanggilnya. Method yang menghitung produk dalam cakupan (`resolveScopeProducts` atau setara) harus dapat dipanggil terpisah karena akan dipakai Handoff #3 dan #4. Catat nama akhirnya di berkas progres.

### 5.7 Izin akses (usulan, sesuaikan dengan permission matrix yang ada)
- `opname.view`: Owner, Admin, Accounting.
- `opname.create` dan `opname.cancel`: Owner, Admin.
- Izin lain (`opname.count`, `opname.post`, `opname.approve`) **belum** dibuat; akan ditambahkan handoff terkait.
- Kasir, Purchasing, Finance: tanpa akses.

### 5.8 Test backend (wajib lolos)
1. Mulai sesi `all`: item terbentuk untuk setiap produk aktif (termasuk stok nol), `system_qty_at_start` sesuai stok saat itu, `total_products` benar.
2. Mulai sesi `categories` dengan kategori induk: seluruh produk turunan ikut, tanpa duplikat.
3. Pilih induk dan anak sekaligus: tetap tanpa duplikat.
4. Cakupan nol produk: 422.
5. Irisan dengan sesi aktif: 422 dengan `conflicting_sessions`; tanpa irisan: berhasil paralel.
6. Idempotensi: dua POST dengan `client_request_id` sama menghasilkan satu sesi dan satu set item.
7. Atomisitas: bila penyisipan item gagal di tengah, tidak ada sesi atau item tersisa.
8. Batalkan dari `in_progress`: berhasil, stok **tidak** berubah, produk bebas untuk sesi baru. Batalkan dari status lain: 422. Alasan kosong: 422.
9. Respons detail dan daftar **tidak memuat** `system_qty_at_start` maupun data per produk.
10. Izin: 401, 403 untuk role tanpa izin, berhasil untuk role berizin.
11. Daftar: filter status, pencarian, rentang tanggal, paginasi, urutan.
12. Foreign key `stock_adjustments.opname_session_id` terpasang dan adjustment manual lama tetap valid.
13. Uji beban sederhana pada data buatan (lihat 5.4) dan laporkan waktunya.

Pengguna menjalankan `php artisan test` di mesinnya. Sertakan perintah yang tepat dan hasil yang diharapkan di laporan serah terima.

## 6. Bagian B — Frontend

Stack: React + Vite + TypeScript. **Ikuti library, struktur folder, dan pola yang sudah ada.** Jangan menambah library UI baru tanpa alasan kuat.

### 6.1 Routing
Pakai rute bersarang yang sudah dibuat di Handoff #1. Tambahkan di bawah tab Opname:
- `opname` (indeks): daftar sesi.
- `opname/:sessionId`: ringkasan sesi. Rute ini menjadi **slot** yang akan diisi layar menghitung di Handoff #3. Buat sebagai rute anak tersendiri agar handoff berikutnya tidak perlu menyentuh daftar.

### 6.2 Aturan responsif (mobile-first)
- Titik patah: ikuti konfigurasi yang ada. Acuan: HP di bawah 768px, tablet 768–1023px, desktop mulai 1024px.
- Target sentuh minimal 44px. Tidak boleh ada scroll horizontal di semua lebar.
- Status tidak boleh hanya bergantung pada warna (selalu ada teks atau ikon pendamping).

### 6.3 Daftar sesi (tab Opname)
- **HP:** kartu berisi nomor, nama (bila ada), cakupan ringkas, status (lencana teks), progres 'X/Y produk dihitung', waktu mulai, dan pembuat. **Mulai 768px:** tabel dengan kolom yang setara.
- Filter status berupa chip (Semua, Berjalan, Dibatalkan; status `pending_approval` dan `posted` ikut tampil bila datanya ada). Pencarian nomor/nama selalu terlihat.
- Paginasi: tombol sebelumnya/berikutnya di desktop, tombol 'Muat lagi' di HP.
- Keadaan wajib: memuat (skeleton), kosong (dengan ajakan 'Mulai Opname'), galat (dengan tombol coba lagi).
- Tombol utama **Mulai Opname**: kanan header di desktop/tablet; tombol lebar penuh yang menempel di bawah layar di HP (dengan safe-area), konsisten dengan tab Adjustment.
- Mengetuk satu sesi membuka `opname/:sessionId`.

### 6.4 Alur 'Mulai Opname'
Komponen terpisah, mis. `StartOpnameForm`. **HP: layar penuh. Mulai 768px: modal/drawer lebar.**

1. Pilihan cakupan berupa dua opsi besar: **Seluruh toko** atau **Pilih kategori**.
2. Bila 'Pilih kategori': pohon kategori dengan kotak centang. Setiap baris menampilkan nama dan **jumlah jenis produk** (mis. 'Makanan (235)'). Kategori yang sedang dipakai sesi aktif tampil nonaktif dengan keterangan nomor sesinya. Memilih induk menandai seluruh turunannya. Pohon dapat dilipat per induk dan bisa dicari.
3. Ringkasan langsung: 'Total X jenis produk akan dihitung' (hitungan klien dari data pohon hanya sebagai petunjuk; backend yang berwenang).
4. Field opsional: nama sesi dan catatan.
5. Tombol **Mulai** nonaktif sampai valid, dan **nonaktif + indikator memuat saat mengirim**.

Perilaku:
- `client_request_id` (UUID) dibuat saat form dibuka dan dipakai ulang bila pengiriman diulang dalam pembukaan yang sama. Dibuat baru setiap form dibuka kembali atau setelah sukses.
- Galat irisan dari server ditampilkan jelas beserta nomor sesi penyebab (bisa diketuk untuk membuka sesi itu).
- Galat jaringan menampilkan pesan dengan opsi coba lagi **tanpa kehilangan pilihan**.
- Pembuatan sesi besar bisa memakan beberapa detik; tampilkan indikator yang jelas dan jangan biarkan layar tampak macet.
- Setelah sukses: arahkan ke `opname/:sessionId` sesi baru.

### 6.5 Halaman ringkasan sesi (`opname/:sessionId`)
- Kartu ringkasan: nomor, nama, status (lencana teks), cakupan (daftar kategori atau 'Seluruh toko'), total produk, progres 'X/Y dihitung' (selalu 0 sekarang), waktu mulai, pembuat, catatan. Bila dibatalkan: waktu, pembatal, alasan.
- Tombol **Batalkan sesi** (hanya bila `in_progress` dan pengguna punya izin): dialog konfirmasi dengan kolom alasan wajib, tanpa menampilkan peringatan palsu soal stok (pembatalan tidak mengubah stok).
- Area di bawah ringkasan berupa kartu keterangan: 'Layar menghitung dibangun di tahap berikutnya'. **Jangan membuat apa pun selain itu.** Area ini menjadi tempat Handoff #3.
- Tautan kembali ke daftar sesi yang jelas, terutama di HP.

### 6.6 Tipe dan data
- Buat tipe TypeScript untuk kontrak di 5.5 di satu berkas tipe, dan satu modul API untuk sesi opname.
- Ikuti library data-fetching yang sudah dipakai. Setelah mulai/batalkan, segarkan daftar dan ringkasan.
- Bila Bagian A belum selesai, bangun Bagian B dengan data tiruan yang mengikuti kontrak persis, lalu ganti ke API asli saat Bagian A siap.
- Izin di UI: tombol Mulai dan Batalkan hanya tampil bila pengguna berizin; akses langsung ke rute tanpa izin ditolak dengan halaman yang sesuai.

## 7. Kriteria selesai (dicek di browser)

Skenario uji manual, semuanya harus lolos:

1. Login sebagai Admin, buka tab **Opname**: daftar kosong menampilkan keadaan kosong yang ramah.
2. **Mulai Opname → Seluruh toko**: sesi terbentuk, muncul di daftar dengan status Berjalan dan total produk sesuai jumlah produk aktif.
3. Buka ringkasan sesi: semua kartu informasi tampil, progres 0/Y, **tidak ada angka stok per produk di mana pun** (cek juga tab Network).
4. Coba **Mulai Opname** lagi (apa pun cakupannya): ditolak karena beririsan, pesan menyebut nomor sesi pertama dan tautannya bisa dibuka.
5. **Batalkan** sesi pertama dengan alasan: status menjadi Dibatalkan, stok produk tidak berubah (cek di halaman stok yang sudah ada).
6. **Mulai Opname → Pilih kategori**: pilih satu kategori induk. Anak-anaknya ikut terpilih, jumlah produk di ringkasan sesuai. Sesi terbentuk.
7. Sementara sesi itu berjalan, mulai sesi kedua dengan **kategori lain yang tidak beririsan**: berhasil. Dengan kategori yang beririsan: ditolak, dan kategori yang terkunci tampil nonaktif di pohon.
8. Tekan **Mulai** berkali-kali dengan cepat: hanya satu sesi terbentuk.
9. Refresh di halaman `opname/:sessionId`: halaman tetap terbuka (deep link bekerja).
10. Login sebagai Kasir: tidak ada akses (menu tidak muncul, akses langsung ditolak).
11. Tampilan diuji di lebar **375px**, **768px**, dan **1280px**: kartu di HP, tabel di lebar lebih besar, tombol bawah di HP, form mulai layar penuh di HP, tanpa scroll horizontal.
12. Tab **Adjustment** dari Handoff #1 tetap berfungsi normal (tidak ada regresi), termasuk membuat adjustment manual.
13. `php artisan test` hijau, serta pemeriksaan tipe, lint, dan build frontend bersih.

Setelah pengujian, **batalkan semua sesi uji** agar produk tidak terkunci untuk pekerjaan berikutnya.

## 8. Antarmuka yang akan dipakai handoff berikutnya (jangan diubah tanpa laporan)

- Tabel `stock_opname_sessions` dan `stock_opname_items` beserta kolom hitung yang sudah disiapkan (dipakai #4 dan #6).
- `OpnameSessionService` dan method penghitung produk dalam cakupan (dipakai #3, #4, #6).
- Rute `opname/:sessionId` sebagai slot layar menghitung (dipakai #3).
- Endpoint `scope-options` dan komponen pohon kategori (dipakai ulang sebagai dasar panel Daftar di #3, **tetapi** panel Daftar akan memakai endpoint pohon sesi tersendiri; jangan memperluas endpoint ini untuk kebutuhan itu).
- Status `pending_approval` dan `posted` yang sudah dicadangkan (dipakai #6).
- FK `stock_adjustments.opname_session_id` (dipakai #6).

## 9. Dokumentasi dan serah terima

- Perbarui **satu berkas progres tunggal untuk agent frontend: `docs/ROADMAP_PROGRESS.md`**. Tambahkan bagian 'Adjustment & Opname — Handoff #2' berisi: apa yang baru selesai, daftar endpoint beserta bentuknya, izin yang dipakai, nama service dan method, hasil pemeriksaan awal di bagian 3 beserta asumsi yang ternyata berbeda, hasil uji performa, serta fitur UI apa yang kini bisa dibangun. Jangan membuat berkas progres baru.
- Bila `docs/BACKEND_PROGRESS.md` masih dipakai, cukup tambahkan satu baris rujukan. Jangan menduplikasi isi.
- Gunakan commit kecil dan terarah, misalnya: (1) migration + FK adjustment, (2) service + test, (3) endpoint + test, (4) rute + daftar sesi, (5) form mulai opname, (6) ringkasan sesi + batalkan, (7) dokumentasi.
- Di akhir pekerjaan, tulis **ringkasan serah terima maksimal 10 baris** yang bisa diteruskan ke agent lain: apa yang selesai, apa yang belum, temuan atau asumsi yang berbeda, perintah untuk menjalankan test, dan langkah berikutnya (Handoff #3).

## 10. Larangan

- Jangan membuat layar menghitung, endpoint hasil hitung, atau logika posting.
- Jangan mengubah stok produk dengan cara apa pun di handoff ini.
- Jangan mengembalikan stok sistem per produk di endpoint mana pun (hitung buta).
- Jangan mengisi atau mengekspos kolom `counted_qty`, `system_qty_at_count`, `counted_at`, `counted_by`.
- Jangan menambah fitur edit cakupan atau hapus sesi.
- Jangan mengubah perilaku `InventoryService`, tab Adjustment, atau respons endpoint yang dipakai fitur lain (hanya penambahan aditif).
- Jangan menambah library UI baru tanpa alasan yang dicatat.
- Jangan melakukan refactor di luar cakupan dokumen ini.
- Jangan menyimpan data sungguhan, kredensial, atau berkas `.env` ke repositori.
