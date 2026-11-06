# HANDOFF #1 — Halaman Adjustment & Opname: Kerangka Halaman + Tab Adjustment

Proyek: POS Retail SMK · Seri: Adjustment & Opname (Handoff #1 dari 8) · Dibuat: 6 November 2026 · Status: siap dikerjakan

## 0. Ringkasan untuk agent yang baru bergabung

Kita membangun satu halaman bernama **Adjustment & Opname** dengan dua tab. Tab **Adjustment** berisi daftar penyesuaian stok manual dan tombol untuk membuat penyesuaian di luar opname. Tab **Opname** berisi fitur stock opname. Fitur ini dibangun bertahap dalam 8 handoff. **Handoff #1 hanya membangun: kerangka halaman (dua tab, responsif, mobile-first) + tab Adjustment yang lengkap dan berfungsi (backend + frontend). Tab Opname hanya placeholder.**

Penggunaan utama halaman ini kelak adalah di **HP** (admin keliling rak toko), jadi seluruh UI dibuat mobile-first.

## 1. Konteks seri handoff

| # | Isi | Sifat |
| --- | --- | --- |
| 1 | Kerangka halaman + tab Adjustment lengkap | Backend + frontend (dokumen ini) |
| 2 | Sesi opname: buat, daftar, status, cakupan | Backend + frontend |
| 3 | Kerangka layar opname + peta progres (baca saja), pengaturan tampil/sembunyi angka stok | Hampir murni frontend |
| 4 | Input hitungan inti: form kosong, scan/cari, autosave, progres berwarna | Backend kecil + frontend |
| 5 | Form rekomendasi + alur terpandu per sub-kategori | Frontend |
| 6 | Ringkasan selisih + Posting Opname + persetujuan Owner + adjustment otomatis | Backend sensitif + frontend |
| 7 | Penyempurnaan HP: scan kamera, draft lokal + sinkron | Frontend |
| 8 | Riwayat per periode + penutup | Backend kecil + frontend |

Handoff #1 harus berdiri sendiri: setelah selesai, fitur Adjustment sudah dipakai sungguhan dan tidak perlu diubah oleh handoff berikutnya (hanya dipakai ulang, lihat bagian 8).

## 2. Cakupan

**Termasuk:**

- Halaman gabungan dengan dua tab, entri menu, routing bersarang, izin akses.
- Tab Adjustment: daftar (dengan filter dan paginasi), detail ringkas, form pembuatan adjustment.
- Backend adjustment: tabel, service, endpoint, izin, test.
- Komponen bersama `ProductPicker` (pencarian produk by nama/barcode) yang akan dipakai ulang di Handoff #4.
- Tab Opname: **hanya halaman placeholder**.

**Tidak termasuk (jangan dikerjakan):** tabel/endpoint/UI opname apa pun, scan kamera, mode offline, tampilan nilai rupiah, edit/hapus adjustment, approval Owner.

## 3. Pemeriksaan awal wajib (sebelum menulis kode)

Dokumen ini ditulis tanpa melihat kode terbaru. Sebelum mulai, **verifikasi hal-hal berikut dan catat hasilnya**. Jika sebuah asumsi salah dan memengaruhi desain, **hentikan bagian itu dan laporkan ke pengguna**, jangan improvisasi.

1. `InventoryService` (hasil WS-A): bagaimana cara mencatat pergerakan stok, jenis pergerakan apa saja yang ada (mis. `opening_balance`), apakah sudah ada jenis untuk adjustment masuk/keluar, bagaimana penguncian baris stok, dan apakah stok disimpan per lokasi (gudang/toko).
2. Apakah tabel pergerakan stok sudah menyimpan alasan, catatan, dan referensi dokumen sumber.
3. Konvensi yang sudah ada: format respons API (envelope, error), penomoran dokumen, penamaan permission di RBAC, pola paginasi, penanganan validasi (422).
4. Endpoint pencarian produk yang sudah ada: apakah mendukung pencarian nama + barcode dan mengembalikan stok saat ini.
5. Frontend: struktur routing, layout aplikasi (sidebar/menu), library UI, library data-fetching (mis. React Query), API client, dan cara pengecekan permission di UI.
6. Apakah ada konsep batch/tanggal kedaluwarsa di stok. Jika **sudah ada**, ikuti. Jika **belum**, jangan menambahkannya di handoff ini; catat sebagai temuan.
7. Baca `docs/ROADMAP_PROGRESS.md` (berkas progres tunggal) dan, bila masih dipakai, `docs/BACKEND_PROGRESS.md`.

## 4. Keputusan yang dipakai di handoff ini

- Stok **tidak boleh menjadi negatif**: adjustment 'kurang' yang melebihi stok ditolak.
- Jumlah adalah **bilangan bulat** dalam satuan terkecil (pcs).
- Adjustment **tidak bisa diedit atau dihapus**. Koreksi dilakukan dengan adjustment baru yang berlawanan.
- **Tidak ada persetujuan Owner** di handoff ini (bisa ditambahkan nanti tanpa mengubah kontrak).
- **Tidak menampilkan nilai rupiah** di UI. Jika `InventoryService` menyimpan harga pokok pada pergerakan, biarkan service yang mengurusnya.
- Lokasi stok: ikuti default toko yang sudah ada. **Jangan** menambah pilihan lokasi di form.
- Zona waktu tampilan mengikuti konfigurasi sistem (default WIB). Bahasa UI: Indonesia.

## 5. Bagian A — Backend

Kerjakan Bagian A lebih dulu. Setelah kontrak di 5.5 final, Bagian B boleh jalan paralel memakai data tiruan.

### 5.1 Prinsip

- **Seluruh perubahan stok wajib lewat `InventoryService`**. Jangan pernah mengubah angka stok dengan query langsung.
- Pembuatan adjustment dilakukan dalam **satu transaksi database**: kunci baris stok, validasi, catat pergerakan lewat `InventoryService`, simpan dokumen adjustment. Jika salah satu gagal, semuanya dibatalkan.
- Perubahan pada kode yang sudah ada bersifat **aditif** (tambah, bukan ubah perilaku). Jangan mengubah respons endpoint yang dipakai fitur lain.

### 5.2 Data: tabel `stock_adjustments` (usulan, sesuaikan dengan konvensi)

| Kolom | Keterangan |
| --- | --- |
| id | PK |
| number | Kode dokumen unik, mis. `ADJ-261106-0001`. Ikuti penomoran yang sudah ada bila ada. Dibuat di dalam transaksi |
| product\_id | FK ke produk |
| type | `increase` atau `decrease` |
| quantity | Bilangan bulat tak negatif, minimal 1 |
| reason\_code | Lihat 5.3 |
| notes | Teks, boleh kosong kecuali alasan yang mewajibkan |
| stock\_before, stock\_after | Snapshot stok saat adjustment dibuat |
| stock\_movement\_id | Tautan ke pergerakan stok yang dihasilkan |
| source | `manual` (default) atau `opname`. Dipakai Handoff #6 |
| opname\_session\_id | Nullable, **tanpa foreign key** dulu. FK ditambahkan oleh migration handoff #2 |
| client\_request\_id | UUID nullable, **unik**. Kunci idempotensi |
| created\_by | FK ke user |
| created\_at, updated\_at | Timestamp |

Indeks: `created_at`, `product_id`, `reason_code`, `type`.

Bila tabel pergerakan stok yang ada sudah menyimpan sebagian besar kolom ini, tetap buat dokumen adjustment terpisah, tetapi jangan menduplikasi data yang sebenarnya cukup dirujuk lewat `stock_movement_id`. Catat keputusanmu di berkas progres.

### 5.3 Alasan (reason code)

Backend menjadi sumber kebenaran daftar alasan. Disediakan lewat endpoint meta (5.5).

| code | Label | Wajib catatan | Bisa dipilih manual |
| --- | --- | --- | --- |
| damaged | Barang rusak | Tidak | Ya |
| expired | Kedaluwarsa | Tidak | Ya |
| lost | Hilang | Tidak | Ya |
| found | Barang ditemukan | Tidak | Ya |
| input\_correction | Koreksi kesalahan input | Tidak | Ya |
| own\_use | Dipakai sendiri | Tidak | Ya |
| sample | Sampel | Tidak | Ya |
| other | Lainnya | **Ya** | Ya |
| opname\_result | Hasil stock opname | Tidak | **Tidak** (khusus sistem, dipakai Handoff #6) |

Endpoint pembuatan manual harus **menolak** `opname_result`.

### 5.4 Aturan bisnis

- `quantity` bulat, minimal 1.
- `decrease` dengan `quantity` lebih besar dari stok saat ini ditolak dengan kode galat `insufficient_stock`.
- Produk harus ada dan aktif.
- `notes` wajib bila alasan yang dipilih mewajibkannya.
- **Idempotensi:** bila `client_request_id` yang sama dikirim lagi, kembalikan dokumen yang sudah ada (HTTP 200) dan **jangan** membuat dokumen baru. Ini mencegah dobel akibat tap ganda atau sinyal buruk di HP.
- Tidak ada endpoint ubah atau hapus.

### 5.5 Kontrak API

Ikuti envelope dan format galat yang sudah ada. Bentuk di bawah adalah isi logisnya.

**GET `/api/stock-adjustments/meta`** Mengembalikan daftar jenis dan alasan: `[{ code, label, requires_notes, selectable }]`.

**GET `/api/stock-adjustments`** (daftar) Query: `page`, `per_page` (default 20, maks 100), `q` (nomor, nama produk, atau barcode), `type`, `reason_code`, `source`, `date_from`, `date_to`, `sort` (default terbaru dulu). Item: `id, number, product { id, name, barcode }, type, quantity, reason_code, reason_label, notes, stock_before, stock_after, source, created_by { id, name }, created_at`.

**GET `/api/stock-adjustments/{id}`** — satu dokumen, bentuk sama dengan item daftar.

**POST `/api/stock-adjustments`** (buat) Body: `{ product_id, type, quantity, reason_code, notes?, client_request_id }`.

- 201 + dokumen bila baru dibuat. 200 + dokumen yang sudah ada bila `client_request_id` berulang.
- 422 untuk validasi, termasuk kode `insufficient_stock` dan alasan yang tidak boleh dipilih manual.
- 401/403 untuk autentikasi dan izin.

**Pencarian produk untuk form:** pakai endpoint pencarian produk yang sudah ada. Syaratnya: cari berdasarkan nama dan barcode (kecocokan barcode persis didahulukan), hanya produk aktif, dan mengembalikan `id, name, barcode, kategori, satuan, stok saat ini`. Bila belum memenuhi, tambahkan parameter/field secara aditif dan catat di berkas progres.

### 5.6 Service internal (dipakai ulang di Handoff #6)

Buat satu method service (mis. `StockAdjustmentService::record(...)`) yang menjadi satu-satunya tempat membuat adjustment. Controller hanya memanggilnya. Method ini menerima `source` dan `opname_session_id` sehingga Handoff #6 bisa memanggilnya dengan `source = opname` dan `reason_code = opname_result` tanpa mengubah logika. Nama method boleh disesuaikan, tetapi catat nama akhirnya di berkas progres.

### 5.7 Izin akses (usulan, sesuaikan dengan permission matrix yang ada)

- `adjustment.view`: Owner, Admin, Accounting.
- `adjustment.create`: Owner, Admin.
- Kasir, Purchasing, Finance: tidak punya akses di mode minimalis maupun penuh.

Bila penamaan atau pembagian peran di matrix berbeda, ikuti matrix dan catat perbedaannya.

### 5.8 Test backend (wajib lolos)

1. Buat `increase`: stok bertambah, pergerakan tercatat, dokumen tersimpan dengan `stock_before`/`stock_after` benar.
2. Buat `decrease`: stok berkurang.
3. `decrease` melebihi stok: 422 `insufficient_stock`, stok dan dokumen tidak berubah.
4. Alasan `other` tanpa catatan: 422.
5. Alasan `opname_result` lewat endpoint manual: ditolak.
6. Idempotensi: dua POST dengan `client_request_id` sama menghasilkan satu dokumen dan satu pergerakan.
7. Atomisitas: bila pencatatan pergerakan gagal, tidak ada dokumen tersisa.
8. Izin: tanpa login 401, role tanpa izin 403, role berizin berhasil.
9. Daftar: filter, pencarian, paginasi, dan urutan berfungsi.
10. Tidak ada rute ubah/hapus.
11. Method service dapat dipanggil dengan `source = opname` dan menyimpan `opname_session_id`.

Pengguna menjalankan `php artisan test` di mesinnya. Sertakan perintah yang tepat dan hasil yang diharapkan di laporan serah terima.

## 6. Bagian B — Frontend

Stack: React + Vite + TypeScript. **Ikuti library, struktur folder, dan pola yang sudah ada.** Jangan menambah library UI baru tanpa alasan kuat.

### 6.1 Routing dan kerangka halaman

- Tambah entri menu **Adjustment & Opname**, tampil sesuai izin `adjustment.view`.
- Gunakan **rute bersarang** agar handoff berikutnya cukup menambah isi tab tanpa menyentuh kerangka:
  - halaman induk (kerangka + bar tab),
  - anak `adjustment` (default; rute induk mengarahkan ke sini),
  - anak `opname` (placeholder).
- Tab berbentuk tautan rute (bisa di-deep-link dan tahan refresh) dengan atribut aksesibilitas tab yang benar.
- Halaman placeholder Opname: pesan singkat bahwa fitur opname sedang dibangun. **Jangan membuat apa pun selain itu.**

### 6.2 Aturan responsif (mobile-first)

- Titik patah: ikuti konfigurasi yang ada. Acuan: HP di bawah 768px, tablet 768–1023px, desktop mulai 1024px.
- Target sentuh minimal 44px. Tidak boleh ada scroll horizontal di semua lebar.
- Bar tab: lengket di bagian atas konten, lebar penuh di HP.
- Tombol utama **Adjustment**: di desktop/tablet ada di kanan header daftar. Di HP berupa tombol lebar penuh yang menempel di bawah layar dengan memperhitungkan safe-area.
- Status tidak boleh hanya bergantung pada warna (selalu ada teks atau ikon pendamping).

### 6.3 Tab Adjustment: daftar

- **HP:** daftar berupa kartu (produk, tipe + jumlah, alasan, waktu, pembuat). **Mulai 768px:** tabel dengan kolom tanggal, nomor, produk, tipe, jumlah, alasan, oleh. Pada tablet boleh meringkas kolom.
- Pencarian selalu terlihat. Di HP, filter (tipe, alasan, rentang tanggal) ada di panel geser dari bawah, dengan chip penanda filter aktif. Di desktop filter tampil sebaris.
- Paginasi: tombol sebelumnya/berikutnya di desktop, tombol 'Muat lagi' di HP (tanpa infinite scroll).
- Wajib ada keadaan: memuat (skeleton), kosong (dengan ajakan membuat adjustment), galat (dengan tombol coba lagi).
- Mengetuk satu baris/kartu membuka detail ringkas (panel atau layar penuh di HP) berisi seluruh field, termasuk catatan serta stok sebelum dan sesudah.
- Tanggal ditampilkan dalam zona waktu sistem, misalnya `06 Nov 2026, 14.32`.

### 6.4 Tab Adjustment: form pembuatan

Komponen terpisah, mis. `AdjustmentForm`. **HP: layar penuh. Mulai 768px: modal/drawer sekitar 480px.**

Urutan field:

1. **Produk** — memakai `ProductPicker`, autofocus.
2. Info **stok saat ini** produk terpilih (di form adjustment, stok boleh selalu terlihat; pengaturan sembunyikan stok hanya untuk opname di Handoff #3).
3. **Tipe** — kontrol segmen dua pilihan: Tambah / Kurang.
4. **Jumlah** — `inputmode=numeric`, dengan tombol + dan − yang besar.
5. **Alasan** — pilihan dari endpoint meta (hanya yang `selectable`). Di HP tampil sebagai daftar pilihan besar.
6. **Catatan** — wajib bila alasan mewajibkan, dengan penanda jelas.
7. Ringkasan satu baris: 'Stok akan menjadi X' (hitungan klien hanya sebagai petunjuk; backend yang berwenang).

Perilaku:

- Tombol Simpan nonaktif sampai valid, dan **nonaktif + indikator memuat saat mengirim** (mencegah tap ganda).
- `client_request_id` (UUID) dibuat saat form dibuka dan **dipakai ulang bila pengiriman diulang** dalam pembukaan form yang sama. Dibuat baru setiap form dibuka kembali atau setelah sukses.
- 'Kurang' melebihi stok: tampilkan pesan jelas dan nonaktifkan Simpan.
- Galat 422 dari server ditampilkan di field terkait. Galat jaringan menampilkan pesan dengan opsi coba lagi (tanpa kehilangan isian).
- Setelah sukses: notifikasi singkat berisi nomor dokumen, form ditutup, daftar disegarkan. Sediakan aksi **'Tambah lagi'** yang mengosongkan form dengan id baru dan fokus kembali ke pemilih produk.

### 6.5 Komponen bersama `ProductPicker`

Letakkan di lokasi komponen bersama (bukan di dalam folder fitur adjustment) karena akan dipakai ulang di Handoff #4.

Spesifikasi:

- Pencarian tertunda ±250 ms, minimal 2 karakter.
- **Input dari scanner barcode** (scanner bertindak seperti keyboard): bila teks yang diakhiri Enter cocok persis dengan satu barcode, langsung pilih produk tanpa menampilkan daftar.
- Hasil menampilkan nama, barcode, dan kategori. Navigasi dengan panah dan Enter, tombol hapus pilihan, dan keadaan memuat/kosong/galat.
- Props minimal: `onSelect`, `autoFocus`, `disabled`, `placeholder`.
- **Default TIDAK menampilkan stok di daftar hasil** (prop opsional `showStock`, default `false`). Alasannya: pada opname buta, stok tidak boleh terlihat. Form adjustment menampilkan stok sendiri setelah produk dipilih.

### 6.6 Tipe dan data

- Buat tipe TypeScript untuk kontrak di 5.5 di satu berkas tipe, dan satu modul API untuk adjustment.
- Ikuti library data-fetching yang sudah dipakai. Setelah POST sukses, invalidasi/segarkan daftar.
- Bila Bagian A belum selesai, bangun Bagian B dengan data tiruan yang mengikuti kontrak persis, lalu ganti ke API asli saat Bagian A siap.

## 7. Kriteria selesai (dicek di browser)

Skenario uji manual, semuanya harus lolos:

1. Login sebagai Admin, menu **Adjustment & Opname** muncul dan halaman terbuka dengan dua tab; tab Adjustment aktif secara default.
2. Daftar kosong menampilkan keadaan kosong yang ramah.
3. Buat adjustment **Kurang 3** dengan alasan Rusak: muncul di urutan teratas daftar, dan stok produk itu benar-benar berkurang 3 (cek di halaman stok/produk yang sudah ada).
4. Buat adjustment **Tambah**: stok bertambah sesuai.
5. 'Kurang' melebihi stok: pesan jelas muncul dan Simpan nonaktif.
6. Alasan **Lainnya** tanpa catatan: tidak bisa disimpan.
7. Tekan Simpan berkali-kali dengan cepat: hanya satu dokumen terbentuk.
8. Scan/ketik barcode produk lalu Enter di pemilih produk: produk langsung terpilih.
9. Filter dan pencarian di daftar bekerja; paginasi bekerja.
10. Buka `/opname` langsung (refresh): placeholder tampil; tautan langsung ke kedua tab bekerja.
11. Login sebagai Kasir: tidak ada akses (menu tidak muncul, akses langsung ditolak).
12. Tampilan diuji di lebar **375px**, **768px**, dan **1280px**: kartu di HP, tabel di lebar lebih besar, tombol bawah di HP, form layar penuh di HP, tanpa scroll horizontal.
13. `php artisan test` hijau, serta pemeriksaan tipe, lint, dan build frontend bersih.

## 8. Antarmuka yang akan dipakai handoff berikutnya (jangan diubah tanpa laporan)

- Kerangka halaman + rute bersarang dengan slot tab Opname (dipakai #2 sampai #8).
- Komponen `ProductPicker` dengan perilaku scanner dan default tanpa stok (dipakai #4).
- Kolom `source` dan `opname_session_id` pada `stock_adjustments`, serta alasan `opname_result` (dipakai #6).
- Method service pembuat adjustment yang menerima `source` dan `opname_session_id` (dipakai #6).
- Endpoint meta alasan (dipakai di filter dan di #6).

## 9. Dokumentasi dan serah terima

- Perbarui **satu berkas progres tunggal untuk agent frontend: `docs/ROADMAP_PROGRESS.md`**. Tambahkan bagian 'Adjustment & Opname — Handoff #1' berisi: apa yang baru selesai, daftar endpoint beserta bentuknya, izin yang dipakai, nama method service dan komponen bersama, hasil pemeriksaan awal di bagian 3 beserta asumsi yang ternyata berbeda, serta fitur UI apa yang kini bisa dibangun. Jangan membuat berkas progres baru.
- Bila `docs/BACKEND_PROGRESS.md` masih dipakai, cukup tambahkan satu baris rujukan ke bagian di atas. Jangan menduplikasi isi.
- Gunakan commit kecil dan terarah, misalnya: (1) migration + service, (2) endpoint + test, (3) kerangka halaman + rute, (4) daftar, (5) form + `ProductPicker`, (6) dokumentasi.
- Di akhir pekerjaan, tulis **ringkasan serah terima maksimal 10 baris** yang bisa diteruskan ke agent lain: apa yang selesai, apa yang belum, temuan atau asumsi yang berbeda, perintah untuk menjalankan test, dan langkah berikutnya (Handoff #2).

## 10. Larangan

- Jangan membuat tabel, endpoint, atau UI opname apa pun.
- Jangan mengubah stok dengan query langsung; selalu lewat `InventoryService`.
- Jangan mengubah perilaku `InventoryService` yang sudah ada atau respons endpoint yang dipakai fitur lain (hanya penambahan aditif).
- Jangan menambah fitur edit/hapus adjustment.
- Jangan menampilkan atau menghitung nilai rupiah di UI.
- Jangan menambah library UI baru tanpa alasan yang dicatat.
- Jangan melakukan refactor di luar cakupan dokumen ini.
- Jangan menyimpan data sungguhan, kredensial, atau berkas `.env` ke repositori.
