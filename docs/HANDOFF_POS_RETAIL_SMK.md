# POS Retail SMK — Ringkasan Perkembangan dan Handoff

**Tanggal:** 22 Oktober 2026 · **Tujuan:** onboarding agent lain agar proyek dapat berjalan **lokal dalam < 1 bulan**.
Dokumen ini berdiri sendiri; dokumen kebutuhan lengkap (Claude Doc "POS Retail SMK — Dokumen Kebutuhan Teknis Tahap Awal", Bagian 1–15) menjadi rujukan detail. Jika agent lain tidak dapat membuka Claude Doc, ekspor ke Markdown/Word dan sertakan bersama berkas ini.

---

## 1. Ringkasan satu paragraf

Aplikasi web POS retail untuk **satu toko, satu kasir, satu laci** di dalam pabrik. Pembeli adalah karyawan pabrik: penjualan utama **kredit karyawan** (struk keluar, tidak bayar saat itu; akhir periode dibuat **satu invoice gabungan ke HRD**, dibayar lewat potong gaji), plus opsi **tunai langsung**. Ada dua role: **Admin/Owner** dan **Kasir**, tetapi arsitektur izin mengikuti standar retail (Kasir, Finance, Purchasing, Accounting, Owner) lewat permission yang dapat didelegasikan. Sistem **tidak terhubung ke bank**; uang tetap di bank dan sistem hanya mencatat (kas kecil, kas besar, saldo pembelian, rekening bank, rekonsiliasi manual).

**Stack:** Laravel (REST API, Sanctum, modular monolith, 11+) · MySQL 8.0.16+ · React + TypeScript (**belum dimulai**). Pengguna mengembangkan di **Windows + PowerShell**; proyek di `D:\LUTHFI\Codecentral\post_retail`; database `pos_retail` (dev) dan `pos_retail_test` (test, via `.env.testing`).

---

## 2. Status saat ini

| Area | Status | Verifikasi |
|---|---|---|
| Dokumen kebutuhan (ERD, matrix permission, state diagram, pertanyaan bisnis) | Selesai, v0.5 + Bagian 15 | — |
| Skema database Paket 1 (55 tabel) + ERD | Selesai | **Lolos** `migrate:fresh` di mesin pengguna |
| Migration Laravel (55 file, urut FK) | Selesai | **Lolos** di mesin pengguna |
| Seeder (toko, role, 46 permission, register, akun dana, setting, akun admin) | Selesai | **Lolos** test |
| Auth: login/logout/me (Sanctum, throttle, audit) | Selesai | **Lolos** test |
| RBAC: role + override per pengguna, `Gate::before`, `can:<permission>` | Selesai | **Lolos** test |
| Re-auth persetujuan (`ReauthService`, lockout 5x, penanda self-approval) | Selesai | **Lolos** test |
| Master data: kategori, supplier, produk (+price_history, barcode otomatis, status stok) | Selesai | **Lolos** test di mesin pengguna |
| Frontend React + Vite + TypeScript | **Sudah dimulai** oleh pengguna (sedang menyusun CRUD produk) | Belum ditinjau agent ini |
| Customers (karyawan), verifikasi, batas kredit, notifikasi `customer.limit_needed` | Selesai | **Lolos** test (24 Okt 2026) |
| Denah rak | Belum | — |
| Inventory inti: `InventoryService` (saldo/pergerakan/batch/FEFO/anti-negatif/HPP), stok awal, lihat stok, riwayat pergerakan | Selesai | **Lolos** test (24 Okt 2026) |
| Penerimaan barang dari PO (posting menambah stok, selisih/rusak, verifikasi dokumen) | Selesai | **Lolos** test (24 Okt 2026) |
| Transfer antar posisi, adjustment, opname | Belum (tabel ada) | — |
| Shift kasir (buka/hitung/tutup/tinjau) dan posting penjualan (tunai, kredit, FEFO, diskon, PPN opsional, pengecualian kredit, idempotensi, riwayat, cetak ulang) | Selesai | **Lolos** test (24 Okt 2026) |
| PR → pemeriksaan Finance → persetujuan Owner (re-auth) → PO (otomatis/konfirmasi) | Selesai | **Lolos** test (24 Okt 2026) |
| Setoran kasir + kebijakan endapan (parsial/final, penerimaan Finance, selisih/koreksi, saldo dana) dan void penjualan | Selesai | **Lolos** test (24 Okt 2026) |
| POS (shift, penjualan, struk, void), setoran/endapan | Belum (tabel ada) | — |
| Periode tagihan + invoice HRD + pembayaran HRD | Selesai | **Lolos** test (25 Okt 2026) |
| Paket 2 dan 3 (lihat 6) | Belum dirancang | — |

**Penting:** kode backend ditulis tanpa dapat dijalankan di lingkungan penyusun (tidak ada PHP). Yang bertanda "Lolos" sudah dijalankan pengguna (terakhir 24 Okt 2026: 174 test lulus). Kode baru berikutnya harus diperlakukan sama: tandai "belum dijalankan" sampai pengguna menjalankan `php artisan test`.

---

## 3. Menjalankan secara lokal

```powershell
composer install
copy .env.example .env ; php artisan key:generate    # isi DB_* ke database pos_retail
php artisan install:api                              # Sanctum (jika belum)
php artisan migrate:fresh                            # tabel
php artisan db:seed                                  # data awal; password admin acak ditampilkan SEKALI
php artisan serve                                    # API di http://127.0.0.1:8000/api
php artisan test                                     # butuh .env.testing -> DB_DATABASE=pos_retail_test
```
- `tests/TestCase.php` **menolak** berjalan bila nama database tidak berakhiran `_test` (pelindung `migrate:fresh`).
- Test memakai MySQL, bukan SQLite (kolom generated, CHECK, ENUM).
- Di PowerShell `curl` = `Invoke-WebRequest`; gunakan `Invoke-RestMethod` (contoh di `PANDUAN_MASTER_DATA.md`).

---

## 4. Arsitektur dan konvensi (WAJIB diikuti agent lain)

**Struktur backend yang sudah ada** (`app/`):
`Http/Controllers` (tipis) · `Http/Requests` (validasi) · `Services` (logika bisnis) · `Support` (utilitas murni) · `Models/User.php` (satu-satunya model Eloquent).
`config/pos.php`, `database/seeders`, `tests/Feature`, `tests/Unit`, `tests/SeededTestCase.php`.

**Aturan:**
1. **Logika bisnis hanya di `Services`**, memakai **Query Builder** (`DB::table`), bukan Eloquent. Controller hanya validasi, panggil service, bentuk respons.
2. **Semua perubahan saldo/status keuangan/stok dalam `DB::transaction`**, dengan `lockForUpdate()` pada baris yang diubah. Validasi dilakukan di backend, bukan hanya di frontend.
3. **Uang = `DECIMAL(18,2)`, qty = `DECIMAL(18,3)`**; API mengembalikan **string desimal** (`"3500.00"`), jangan float. Waktu disimpan **UTC**, tampil WIB.
4. **Otorisasi:** route memakai `->middleware(['auth:sanctum', 'can:<kode.permission>'])`. Kode permission dan deskripsi hanya didefinisikan di `app/Support/PermissionCatalog.php` (satu sumber). Subset Kasir ada di `PermissionCatalog::cashier()`.
5. **Persetujuan (PR Owner, pengecualian kredit, write-off, adjustment):** pakai `ReauthService::confirm($username, $password, $permission, $requester)`. Pemberi persetujuan mengetik password akunnya sendiri; tidak ada password bersama.
6. **Audit:** setiap aksi penting memanggil `AuditLogger::log('<entitas>.<kata_kerja>', ...)` dengan before/after. Yang sudah ada: `auth.login|login_failed|logout|reauth_ok|reauth_failed`, `category.create|update`, `supplier.create|update`, `product.create|update|price_change|status_change`, `customer.create|update|status_change|verify|set_limit`, `inventory.opening_balance`, `shift.open|start_count|close|review`, `sale.post`, `sale.credit_exception`, `receipt.reprint`, `purchase_requisition.create|update|submit|finance_check|return|approve|reject|cancel|convert|reopen`, `purchase_order.create|update|submit|approve|confirm|send|cancel|close`, `goods_receipt.create|post|verify_documents|cancel`.
7. **Dokumen terposting tidak dihapus/diedit.** Koreksi lewat pembatalan, reversal, atau dokumen koreksi yang bertaut.
8. **Penomoran dokumen:** `NumberSequence::next($storeId, $jenis, $periode)` — hanya di dalam transaksi — lalu `DocumentNumber::format('SALE', $n, '202610')` → `SALE-202610-000123` (sudah ada; stok awal memakai `OPEN-000001`).
9. **Stok:** saldo (`inventory_balances`) turunan dari `inventory_movements` (append-only). Stok negatif **dilarang**. Semua perubahan stok lewat `InventoryService` (`receive`, `sell` FEFO, `voidSale`), **wajib di dalam `DB::transaction` pemanggil**; produk dikunci berurutan id. Hitung qty/uang dengan `App\Support\Decimal` (integer), bukan float.
10. **Migration yang sudah di-merge tidak diedit**; perubahan skema = migration baru.
11. **Test:** feature test memperluas `Tests\SeededTestCase`; helper `signIn('Admin'|'Kasir', $username)` memakai Sanctum. Setiap fitur wajib punya test (izin, validasi, jalur gagal, audit).
12. **Format respons:** sukses `{ "data": ... }`, paginasi bawaan Laravel (`data`, `total`, `links`, ...), validasi 422 `{ message, errors }`, 403/404 `{ message }`. Frontend wajib mengirim `Accept: application/json`.

**Kebiasaan khusus proyek:** tabel `users` memakai kolom `password_hash` (bukan `password`); `User::getAuthPassword()` sudah menyesuaikan. Tabel `settings` berisi JSON; seeder memakai `insertOrIgnore` (tidak menimpa nilai yang diubah Admin).

---

## 5. Aturan bisnis yang sudah diputuskan klien

**Alur dan identitas**
- Hanya **satu jenis penjualan** (K1/K2 sistem lama = kasir 1/2, tidak dimodelkan). Kasir dicatat per transaksi dan shift.
- **PO wajib dari PR; penerimaan wajib dari PO.** Tidak boleh jual produk yang belum diinput/berharga. **Stok negatif dilarang.**
- **Satu produk = satu barcode (pcs)**; barcode produk nonaktif tidak boleh dipakai ulang → SKU/barcode **immutable**.
- Kasir boleh membuat produk baru (status `pending_price`, tidak bisa dijual) dan **mengajukan** retur/adjustment; **diskon hanya ditetapkan Admin**; harga hanya `price.change`.
- **HPP rata-rata bergerak**; **tanggal kadaluarsa** hanya untuk produk bertanda `track_expiry`; penjualan memakai **FEFO**; peringatan 30 hari sebelum kadaluarsa.
- Gudang tetap ada di alur tetapi **dinonaktifkan** (`warehouse_enabled=false`): penerimaan langsung ke rak toko.

**Penjualan dan tagihan**
- Mode bayar: `cash` (masuk kas kecil) dan `payroll_credit` (tidak ada arus kas; masuk piutang).
- Kredit hanya untuk **karyawan terverifikasi (Admin) yang sudah punya batas**. Karyawan baru input Kasir berstatus `pending_verification` (hanya tunai) dan memicu **notifikasi ke Admin** untuk mengisi batas. Batas dikosongkan dulu; Admin meminta nominal dari HRD (sistem tidak menyimpan gaji; aturan klien: belanja ≤ 60% gaji).
- Melebihi batas → ditolak, tawarkan tunai; **Admin boleh beri pengecualian** (re-auth) dengan label "melebihi batas".
- **Periode tagihan mengikuti tanggal gaji dari HRD**; Admin menutup periode secara eksplisit pada hari gaji; invoice terbit hari itu; belanja setelahnya masuk periode berikutnya. **Satu invoice gabungan ke HRD, rincian per karyawan**; semua struk bulanan tetap tersimpan dan dapat dicetak ulang berlabel "SALINAN" (tercatat). Tanpa jatuh tempo.
- **PPN ditunda (R-04):** dihitung di invoice untuk kredit dan per transaksi untuk tunai, tetapi tarif, harga termasuk/tidak, dan status PKP **belum diketahui**. Default nonaktif; wajib selesai sebelum UAT.

**Kas dan dana**
- Empat akun dana: Kas Kecil (laci), Kas Besar, Rekening Bank (catatan), **Saldo Pembelian**.
- **Endapan:** setiap setoran wajib menyisakan endapan (nominal atau persen, basis penjualan tunai shift **atau** uang tunai di laci). Batas min/maks diatur Admin; Kasir boleh mengusulkan. **Pembulatan setoran ke bawah Rp1.000.** Endapan menjadi saldo awal shift berikutnya. **Setoran parsial** tengah shift boleh (shift tetap terbuka).
- **Saldo Pembelian (Paket 2):** diisi otomatis **15% (konfigurasi)** dari uang yang benar-benar diterima di bank (setoran bank dari penjualan tunai + pembayaran HRD; bukan transfer internal/saldo awal). Alokasi manual boleh, **wajib persetujuan Owner**. Transfer ke supplier ≤ saldo tersedia, **satu transfer per PO**, sisa dikembalikan, wajib konfirmasi penggunaan + bukti.
- Pembayaran supplier bervariasi (`prepaid`/`credit`/`cod`) — disimpan per supplier dan per PO.
- Write-off barang rusak/kadaluarsa hanya setelah retur supplier ditolak, **persetujuan Owner (re-auth)**.

**Default sementara bertanda ASUMSI** (belum dikonfirmasi): pembayaran HRD boleh sebagian; PO tidak boleh melebihi PR yang disetujui; kredit ditahan selama batas belum diisi; barcode otomatis EAN-13 prefix `20`; produk berstok tidak bisa dinonaktifkan.

---

## 6. Inventaris yang sudah ada

**Endpoint (14):**

| Method | Path | Permission |
|---|---|---|
| POST | `/api/auth/login` | — (throttle 5/menit) |
| POST | `/api/auth/logout`, GET `/api/auth/me` | login |
| GET / POST / PATCH | `/api/categories` | `inventory.view` / `category.manage` |
| GET / POST / PATCH | `/api/suppliers` | `supplier.manage` |
| GET | `/api/products`, `/api/products/{id}`, `/api/products/by-barcode/{barcode}` | `inventory.view` |
| POST / PATCH | `/api/products` | `product.create` / `product.update` (harga: `price.change`, status: `product.activate`) |

**Endpoint tambahan (WS-A/WS-B, lolos test; kontrak lengkap di `docs/BACKEND_PROGRESS.md`):** `GET /api/inventory/products/{id}/stock`, `GET /api/inventory/movements`, `POST /api/inventory/opening-balances` · `GET/POST /api/customers`, `GET/PATCH /api/customers/{id}`, `POST /api/customers/{id}/verify`, `PUT|GET /api/customers/{id}/credit-limit(s)` · `GET /api/notifications`, `POST /api/notifications/{id}/read`, `POST /api/notifications/read-all`.

**Endpoint POS (WS-D, lolos test):** `GET /api/shifts/current`, `POST /api/shifts/open`, `GET /api/shifts/{id}`, `POST /api/shifts/{id}/start-count|close|review`, `GET /api/shifts` · `POST|GET /api/sales`, `GET /api/sales/{id}`, `POST /api/sales/{id}/reprint`.

**Endpoint setoran/endapan/void (belum dijalankan):** `GET /api/float-policies`, `PUT /api/float-policies/{scope}` · `POST /api/shifts/{id}/deposits` · `GET /api/cash-deposits`, `GET /api/cash-deposits/{id}`, `POST /api/cash-deposits/{id}/submit|cancel|receive|correct` · `GET /api/fund-accounts` · `POST /api/sales/{id}/void`. Kontrak: `docs/BACKEND_PROGRESS.md` bagian 7.

**Berkas penting** (di folder keluaran proyek): `schema_paket1.sql`, `erd_paket1.md`, zip migration, zip tahap1b (seeder/auth/RBAC), zip tahap1c (master data), `SETUP.md`, `SETUP_AUTH_RBAC.md`, `PANDUAN_MASTER_DATA.md`.

**Tabel Paket 1 (55)** sudah mencakup semua alur di bawah. **Belum dirancang (Paket 2/3):** `bank_accounts`, `bank_transactions`, `bank_deposits`, `bank_receipts`, `supplier_payments`, `purchase_fund_*`, `expenses`, `customer_returns`, `credit_notes`, `supplier_returns`, rekonsiliasi.

---

## 7. Sisa pekerjaan dan rencana paralel

**Definisi "bisa dijalankan lokal" (MVP):** login → kelola master data → terima barang dari PO → jual (tunai/kredit karyawan, scan barcode, cetak struk) → tutup shift + setoran/endapan → tutup periode + cetak invoice HRD, dengan data demo dan skrip smoke test end-to-end.

### Workstream

| WS | Isi | Bergantung pada |
|---|---|---|
| **A. Karyawan & denah rak** | `customers` (create Kasir/verify Admin), `customer_credit_limits`, notifikasi `customer.limit_needed` (+ endpoint notifikasi), CRUD rak/posisi | master data (selesai) |
| **B. Inventory inti** | `InventoryService` (saldo + movement + batch + FEFO, transaksi, anti-negatif), penerimaan barang dari PO, transfer, adjustment | — **fondasi bagi C dan D** |
| **C. Pembelian** | PR → pemeriksaan Finance → persetujuan Owner (re-auth) → PO (tanpa saldo pembelian di Paket 1) | B (untuk penerimaan) |
| **D. POS & kas** | shift buka/tutup, posting penjualan (idempotensi, FEFO, aturan kredit/batas/pengecualian), void, cetak ulang, cash movement, kebijakan endapan, setoran parsial/final | A (karyawan), B (stok) |
| **E. Tagihan** | periode tagihan, tutup periode, invoice gabungan + rincian per karyawan, catat pembayaran HRD | D |
| **F. Frontend** | scaffold (Vite + React + TS), klien API bertipe, login/layout/guard permission, layar master data, **layar kasir (prioritas)**, penerimaan, PR/PO, shift/setoran, tagihan | kontrak API dari A–E (mulai dari yang sudah ada) |
| **G. Cetak** | struk thermal 58/80 mm via CSS print browser, paket cetak invoice + struk | D, E |

**Kontrak antar-workstream yang perlu disepakati sebelum paralel:** tanda tangan `InventoryService` (mis. `receive(...)`, `sell(...)` yang mengembalikan alokasi batch FEFO, `voidSale(...)`, `transfer(...)`, `adjust(...)`), pembentuk nomor dokumen, dan bentuk respons POS (keranjang, total, struk).

### Jadwal usulan (4 minggu)

| Minggu | Backend | Frontend |
|---|---|---|
| 1 | Verifikasi tahap1c; git baseline; pecah `routes/api.php` per modul; **B (InventoryService + penerimaan)**; A | Scaffold, login, layout, master data |
| 2 | C (PR/PO); **D (shift + posting penjualan)** | Layar kasir v1 (scan, keranjang, tunai/kredit) |
| 3 | D (void, setoran/endapan); E (periode + invoice) | Penerimaan, PR/PO, shift/setoran, daftar karyawan |
| 4 | G + endpoint dashboard minimal; hardening; seeder demo; skrip smoke test | Cetak struk/invoice, perapihan, dashboard |

**Jika jadwal mundur, potong dalam urutan ini:** denah rak visual (pakai daftar), UI adjustment/opname, transfer antar-rak, UI langkah "pemeriksaan Finance" (jadikan satu tombol Admin), dashboard. **Jangan dipotong:** posting penjualan atomik, aturan kredit/batas, FEFO, shift + endapan, invoice HRD.

**Di luar target 1 bulan:** Paket 2 (Saldo Pembelian, pembayaran supplier, setoran bank, expenses, retur pelanggan, credit note), Paket 3 (retur supplier + write-off, rekonsiliasi bank, laporan analitik Owner), modul impor data (ditunda klien; cut-over ±1,5–2 bulan dari sekarang).

---

## 8. Aturan kerja bersama beberapa agent

1. **Jalankan `git init` dan commit baseline sekarang** (belum diketahui apakah proyek sudah memakai git). Satu cabang per workstream; merge hanya setelah `php artisan test` hijau.
2. **Kepemilikan berkas:** `PermissionCatalog`, `routes/api.php`, dan seeder adalah titik konflik. Saran: satu berkas route per modul (`routes/api/<modul>.php` dimuat dari `routes/api.php`), dan perubahan permission hanya lewat satu agent atau PR terpisah.
3. **Tanpa kolom/tabel baru tanpa migration**; jangan mengubah migration lama.
4. **Setiap workstream** menyertakan: service + controller + request + test + entri audit, dan memperbarui daftar endpoint di berkas ini.
5. **Jangan menyatakan fitur selesai sebelum test benar-benar dijalankan.** Jika PHP tidak tersedia bagi agent, tandai "belum dijalankan" dan minta pengguna menjalankan `php artisan test`.
6. **Jangan membuat asumsi bisnis baru tanpa menandainya `ASUMSI`** dan mencatatnya di dokumen kebutuhan.

---

## 9. Pertanyaan/risiko terbuka

| ID | Hal | Dampak |
|---|---|---|
| R-04 | PPN: tarif, harga termasuk/tidak, status PKP, faktur pajak — menunggu klien | Wajib sebelum UAT; tidak menghambat pengembangan |
| R-09 | Konfirmasi: kredit ditahan selama batas belum diisi | Diterapkan sebagai asumsi |
| WS-C | ASUMSI pembelian: PO otomatis disetujui bila total ≤ total PR; Owner = pemegang `settings.manage`; penerimaan dari PO `approved` diizinkan; gudang/putaway belum didukung (lihat `BACKEND_PROGRESS.md` 6.7) | Konfirmasi klien sebelum UAT |
| R-11 | Format file migrasi dari aplikasi lama | Ditunda |
| Q-07/09/10/11/13/14 | Default ASUMSI (lihat dokumen Bagian 13.7) | Perlu konfirmasi klien sebelum UAT |
| Risiko | Cakupan vs 1 bulan; kode backend baru belum diuji di lingkungan penyusun; uji scanner/printer butuh perangkat klien | Kelola lewat pemotongan cakupan (bagian 7) |

---

## 10. Langkah segera (urutan)

1. ~~Verifikasi test master data~~ — **sudah lolos**.
2. ~~`git init`, commit baseline, cabang per workstream~~ — **sudah** (root `pos_retail`: backend, frontend, docs).
3. ~~Kontrak `InventoryService` dan format nomor dokumen~~ — **sudah** (lihat bagian 4 butir 8–9). Pengguna menjalankan `php artisan test` untuk WS-A/WS-B. WS-D (shift, penjualan, void, setoran/endapan) dan WS-C (PR→PO→penerimaan) **lolos test (174, 24 Okt 2026)**. Tagihan HRD (WS-E) **lolos test (184, 25 Okt 2026)**. Pengaturan diskon dan PPN (3.7) **lolos test (190, 25 Okt 2026)**. Manajemen pengguna (1.8) sudah ditulis dan **menunggu `php artisan test`** (`UserManagementTest`). **Berikutnya:** kas masuk/keluar lain (3.6), adjustment/opname + transfer. Peta jalan lengkap: `docs/ROADMAP_PROGRESS.md`.
4. Mulai paralel: WS-B dan WS-A (backend), WS-F scaffold (frontend).
