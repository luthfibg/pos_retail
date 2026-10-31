# Peta Jalan & Progres — POS Retail SMK

**Diperbarui:** 28 Oktober 2026 (test terakhir dijalankan: **238 test backend lulus**) · **Berkas ini = pedoman progres proyek.** Untuk kontrak endpoint dan layar yang bisa dibuatkan UI, rujukannya `BACKEND_PROGRESS.md`; daftar command operator ada di `OPERATOR_COMMANDS.md`; untuk progres layar frontend, rujuk `FRONTEND_PROGRESS.md`; untuk aturan kerja dan arsitektur, `HANDOFF_POS_RETAIL_SMK.md`.

| Tanda | Arti |
|---|---|
| ✅ | Selesai **dan** `php artisan test` sudah dijalankan dan hijau |
| 🟡 | Kode + test sudah ditulis, **belum dijalankan** (agent tidak punya PHP). Boleh dibuatkan UI terhadap kontraknya, tetapi respons nyata bisa sedikit berbeda sampai test hijau |
| ⏳ | Belum dikerjakan |
| ⏸ | Ditunda: menunggu klien atau di luar cakupan 1 bulan (Paket 2/3) |

---

## 1. Posisi saat ini

**Backend Paket 1 (Fase 0–6; tidak termasuk hardening/UAT/go-live dan Paket 2/3): 35 tahap — 32 ✅ selesai dan lulus test · 0 🟡 menunggu test · 3 ⏳ belum.**

| Fase | ✅ | 🟡 | ⏳ | ⏸ |
|---|---|---|---|---|
| Fase 0 — Analisis & desain | 2 | 0 | 0 | 0 |
| Fase 1 — Fondasi backend (tahap 1a–1c) | 8 | 0 | 0 | 0 |
| Fase 2 — Inventory & karyawan | 6 | 0 | 1 | 0 |
| Fase 3 — POS & kas | 7 | 0 | 0 | 1 |
| Fase 4 — Pembelian | 5 | 0 | 0 | 0 |
| Fase 5 — Tagihan HRD | 3 | 0 | 0 | 0 |
| Fase 6 — Cetak, laporan, dashboard | 1 | 0 | 2 | 0 |
| Fase 7 — Hardening & UAT | 0 | 0 | 5 | 0 |
| Fase 8 — Cut-over & go-live | 0 | 0 | 3 | 1 |
| Di luar Paket 1 (setelah go-live) | 0 | 0 | 0 | 2 |
| **Total semua fase** | **32** | **0** | **11** | **4** |

### Aplikasi sekarang sudah bisa apa (✅ = lulus `php artisan test`, terakhir 28 Okt 2026)

- **Masuk dan hak akses:** login/logout, role Admin dan Kasir, izin yang bisa didelegasikan, persetujuan dengan mengetik ulang password pemberi persetujuan. ✅
- **Master data:** kategori, supplier, produk (harga + riwayat harga, barcode otomatis, status stok). ✅
- **Stok:** Admin memasukkan stok awal; stok dilihat per batch dengan urutan FEFO dan lencana kedaluwarsa; riwayat pergerakan stok. ✅
- **Transfer stok:** transfer antarposisi dan putaway gudang↔toko mengikuti status draft/posting, menjaga batch dan saldo total, serta menghormati `warehouse_enabled`. ✅
- **Adjustment dan opname:** Kasir membuat dan mengajukan snapshot hitung stok; Admin menyetujui (re-auth wajib untuk loss/expired) dan posting movement penyesuaian secara atomik. ✅
- **Karyawan:** Kasir menambah karyawan (menunggu verifikasi, hanya tunai), Admin memverifikasi dan menetapkan batas kredit, notifikasi ke Admin. ✅
- **Kasir:** buka shift (hitung buta), jual tunai atau kredit potong gaji (FEFO, diskon, PPN opsional, batas kredit + pengecualian Admin dengan re-auth, anti transaksi ganda), cetak ulang berlabel SALINAN, tutup shift dengan selisih kas, tinjau oleh Admin. ✅
- **Kas dan koreksi:** kebijakan endapan (tetap/persen, min/maks, pembulatan ke bawah), setoran akhir shift dan setoran parsial tengah shift, Finance menghitung ulang dan menerima (selisih → koreksi), saldo Kas Kecil/Kas Besar dari ledger, void penjualan oleh Admin (stok kembali, kas/kredit dikoreksi). ✅
- **Kas nonpenjualan:** Kasir mencatat kas masuk/keluar pada shift aktif; kas yang diharapkan dan saldo Kas Kecil diperbarui, dengan audit dan ledger. ✅
- **Pembelian:** PR → pemeriksaan Finance → persetujuan Owner → PO → kirim → penerimaan barang ke toko atau gudang (posisi rak opsional), HPP rata-rata, verifikasi surat jalan/faktur. ✅
- **Lampiran penerimaan:** Kasir/Admin dapat mengunggah foto surat jalan atau dokumen pendukung pada GR yang belum diverifikasi; berkas disimpan privat dan aksesnya dibatasi ke pemilik GR atau pemegang izin verifikasi. ✅

- **Tagihan HRD:** Admin membuka/menutup periode tagihan pada hari gaji (struk kredit terikat, periode berikutnya terbuka otomatis), membuat satu invoice gabungan per periode dengan rincian per karyawan (PPN kredit bila dikonfigurasi), menerbitkan, menandai diserahkan ke HRD, dan mencatat pembayaran HRD (boleh sebagian). ✅

- **Manajemen pengguna:** Admin menambah akun Kasir/Admin, mengubah nama/email/role, menonaktifkan/mengaktifkan, dan mereset sandi (sesi lama diakhiri) tanpa menyentuh database; setiap pengguna dapat mengganti sandinya sendiri. ✅
- **Diskon dan PPN:** Admin membuat/mengubah/menonaktifkan diskon per produk atau kategori (persen/nominal, rentang tanggal) dan mengatur saklar PPN dengan tarif berversi, tanpa menyentuh database. ✅

### Belum bisa

usulan endapan oleh Kasir (`float_proposals`) · retur pelanggan dan void struk tunai dari shift yang sudah ditutup · denah rak · penyempurnaan cetak thermal 58/80 mm dan cetak invoice · koreksi/pembatalan invoice dan credit note.

### Langkah berikutnya (urut)
1. ~~Pasang paket WS-C dan jalankan seluruh test~~ — **selesai 24 Okt 2026: 154 lulus.**
2. ~~Jalankan `php artisan test` untuk void dan setoran/endapan~~ — **selesai 24 Okt 2026: 174 lulus.**
3. ~~Jalankan test Tagihan HRD~~ — **selesai 25 Okt 2026: 184 lulus.**
3b. ~~Jalankan test 3.7~~ — **selesai 25 Okt 2026: 190 lulus.**
3c. ~~Jalankan `php artisan test` untuk 1.8~~ — **selesai 26 Okt 2026: seluruh 200 test lulus.**
4. ~~Kas masuk/keluar lain (3.6)~~ — **selesai 26 Okt 2026: seluruh 204 test lulus.**
5. ~~Adjustment dan opname dengan persetujuan (2.7)~~ — **selesai 27 Okt 2026: `StockAdjustmentTest` 9 test; suite saat tahap itu 223 test lulus (1.953 assertions).** Tahap backend berikutnya yang terbuka dicatat di bawah; tahap 2.5 denah rak tetap berprioritas rendah.
6. ~~Penerimaan ke gudang + putaway (4.4)~~ — **selesai 27 Okt 2026: `GoodsReceiptTest` 12 test; suite saat tahap itu 224 test lulus (1.978 assertions).** Tahap backend berikutnya yang terbuka: denah rak (2.5), cetak dan laporan (6.1–6.3).
7. ~~Lampiran dokumen penerimaan (4.5)~~ — **selesai 27 Okt 2026: upload/download privat, otorisasi pemilik/approver, validasi format dan ukuran, audit, serta metadata pada detail GR; `GoodsReceiptTest` 16 test dan suite 228 test lulus (2.019 assertions).**
8. ~~Dashboard dan laporan dasar (6.3)~~ — **selesai 28 Okt 2026: laporan penjualan harian, stok menipis/kedaluwarsa, serta ringkasan kas; empat endpoint, batasan toko/kasir, periode WIB, dan `ReportTest` (3 test); suite 231 test lulus (2.058 assertions).** Berikutnya: denah rak (2.5, prioritas rendah), cetak struk/invoice (6.1–6.2), lalu hardening/UAT.

### Tahap frontend terbaru

UI Kasir `/pos` kini terintegrasi dengan `POST /api/sales/preview`: total, diskon, PPN, stok FEFO, dan sinyal batas kredit berasal dari backend setelah debounce; frontend tidak lagi menghitung perkiraan subtotal. Struk menampilkan peringatan jika total final posting berbeda dari pratinjau. Typecheck, 161 test frontend, build produksi, dan `git diff --check` lulus; uji klik setelah integrasi ini masih menunggu pengguna.

UI Manajemen Pengguna `/users` kini menyediakan daftar/cari/filter, tambah dan ubah akun, pengelolaan role/status, reset sandi, serta ganti sandi sendiri dari profil untuk semua pengguna. Aturan sensitif (self-role, self-deaktivasi, Admin aktif terakhir, validitas sandi) tetap ditegakkan backend. Typecheck, 161 test frontend, dan build produksi lulus; uji klik pengguna menunggu.

UI Tagihan HRD `/billing` mengelola periode, merinci kredit per karyawan, membuat/mencetak invoice, memproses penerbitan dan serah terima, serta mencatat pembayaran sebagian. Cetakan A4 mencakup status invoice, ringkasan pembayaran, dan sisa tagihan. Pengguna mengonfirmasi uji klik berjalan lancar.

UI Dashboard `/dashboard` menggunakan endpoint laporan gabungan backend untuk ringkasan penjualan/kas, grafik harian, stok menipis dan batch mendekati kedaluwarsa, serta saldo dana sesuai permission. Pengguna telah mengonfirmasi filter menampilkan data yang benar.

Tahap sebelumnya mencakup UI Transfer Stok `/inventory/transfers` (daftar/filter, Draft dari saldo sellable per batch/posisi, detail, posting, pembatalan) dan lampiran privat di detail `/goods-receipts` (unggah/unduh JPEG, PNG, WebP, PDF). Backend belum menyediakan katalog posisi rak, jadi posisi tujuan transfer dapat diisi sebagai ID opsional; transfer antar lokasi tetap berfungsi tanpa posisi tujuan.

Tahap PR/PO sebelumnya menutup gap alur pembelian yang hanya mencakup penerimaan PO yang sudah tersedia. `/purchase-requisitions` mendukung Kasir membuat/mengubah/mengajukan PR; Finance memeriksa dan mengembalikan dengan catatan; Owner menyetujui/menolak dengan autentikasi ulang; dan Purchasing membuat PO per supplier, mengajukan, melakukan konfirmasi Owner bila nilai PO memerlukan persetujuan, serta menandai PO dikirim.

Hak akses UI menggunakan permission dan tidak bergantung pada nama role sehingga dapat dipakai pada model Admin gabungan maupun konfigurasi Kasir/Finance/Purchasing/Owner terpisah. Akses GET PR backend juga mendukung permission pengelolaan tanpa mewajibkan permission `purchase_requisition.create`. `npm run typecheck`, `npm test` (130 test), `npm run build`, dan `php artisan test` (222 test saat tahap tersebut) lulus. Uji klik tahap Admin PR/PO belum dikonfirmasi.

**Langkah frontend berikutnya:** uji klik integrasi pratinjau di `/pos`, uji perangkat cetak struk/invoice pada 58/80 mm dan A4, lalu uji klik Manajemen Pengguna, Transfer Stok, lampiran Penerimaan Barang, PR/PO, dan Adjustment/Opname. `/goods-receipts` juga masih menunggu uji klik. Dashboard dan Tagihan HRD sudah diuji pengguna.

**Jika jadwal mundur, potong dalam urutan ini** (dari `HANDOFF` bagian 7): denah rak visual (pakai daftar) → transfer antar-rak. **Jangan dipotong:** posting penjualan atomik, aturan kredit/batas, FEFO, shift + endapan, invoice HRD.

---

## 2. Daftar tahapan lengkap (backend)

### Fase 0 — Analisis & desain

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 0.1 | Dokumen kebutuhan teknis (v0.2 + Bagian 15), matrix permission, state diagram, pertanyaan bisnis | ✅ | docs/ |
| 0.2 | ERD + skema database Paket 1 (55 tabel) | ✅ | docs/erd_paket1.md, schema_paket1.sql |

### Fase 1 — Fondasi backend (tahap 1a–1c)

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 1.1 | Proyek Laravel + Sanctum + MySQL, 55 migration (lolos `migrate:fresh`) | ✅ | — |
| 1.2 | Seeder: toko, role, 46 permission, register, akun dana, setting, akun admin | ✅ | SeederTest |
| 1.3 | Auth: login / logout / me, throttle, audit | ✅ | AuthTest |
| 1.4 | RBAC (role + override per pengguna) dan re-auth persetujuan (`ReauthService`, lockout 5x) | ✅ | RbacTest, ReauthServiceTest |
| 1.5 | Master data — kategori | ✅ | CategoryTest |
| 1.6 | Master data — supplier | ✅ | SupplierTest |
| 1.7 | Master data — produk (riwayat harga, barcode otomatis, status stok) | ✅ | ProductTest |
| 1.8 | Manajemen pengguna (Admin): tambah Kasir/Admin, ubah, aktif/nonaktif, reset sandi; ganti sandi sendiri | ✅ | UserManagementTest |

### Fase 2 — Inventory & karyawan

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 2.1 | `InventoryService`: saldo, pergerakan (append-only), batch, FEFO, anti-stok-negatif, HPP rata-rata bergerak | ✅ | InventoryServiceTest |
| 2.2 | Stok awal (Admin), lihat stok per batch, riwayat pergerakan | ✅ | OpeningBalanceTest |
| 2.3 | Data karyawan: input Kasir, verifikasi + batas kredit Admin, riwayat batas | ✅ | CustomerTest |
| 2.4 | Notifikasi (`customer.limit_needed`, daftar, tandai baca) | ✅ | NotificationTest |
| 2.5 | Denah rak (CRUD rak dan posisi) — prioritas terendah, daftar sudah cukup untuk MVP | ⏳ |  |
| 2.6 | Transfer antar posisi / kelompok stok (putaway) | ✅ | StockTransferTest (6) |
| 2.7 | Adjustment dan opname dengan persetujuan (re-auth) | ✅ | StockAdjustmentTest (9) |

### Fase 3 — POS & kas

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 3.1 | Shift kasir: buka, hitung buta, tutup, tinjau; saldo awal = endapan sebelumnya | ✅ | ShiftTest |
| 3.2 | Posting penjualan atomik: tunai + kredit potong gaji, FEFO, diskon, PPN opsional, batas kredit + pengecualian Admin, idempotensi | ✅ | SaleTest |
| 3.3 | Riwayat penjualan dan cetak ulang berlabel SALINAN | ✅ | SaleTest |
| 3.4 | Void / pembatalan penjualan: Admin, stok kembali ke batch asal, kredit hanya bila belum ditagih, tunai hanya selama shift struk masih open | ✅ | SaleVoidTest (6) |
| 3.5 | Setoran dan endapan (parsial / final), kebijakan endapan berversi, penerimaan Finance, selisih/koreksi, saldo dana. Usulan endapan Kasir (`float_proposals`) belum | ✅ | CashDepositTest (14) |
| 3.6 | Kas masuk / keluar lain (`cash_movements`) | ✅ | CashMovementTest (4) |
| 3.7 | Pengaturan diskon dan PPN lewat API (Admin): CRUD diskon + saklar/tarif PPN berversi | ✅ | PricingSettingsTest |
| 3.8 | Retur pelanggan dan credit note | ⏸ | Paket 2 |

### Fase 4 — Pembelian

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 4.1 | PR: draft, ajukan, pemeriksaan Finance, persetujuan Owner (re-auth, tanda swa-persetujuan) | ✅ | PurchaseRequisitionTest |
| 4.2 | PO: dari PR, otomatis/konfirmasi Owner, kirim, batal, tutup | ✅ | PurchaseOrderTest |
| 4.3 | Penerimaan barang: posting menambah stok, selisih/rusak, verifikasi surat jalan + faktur | ✅ | GoodsReceiptTest |
| 4.4 | Penerimaan ke gudang + putaway (pilih lokasi gudang aktif dan posisi rak, atau putaway dengan transfer stok) | ✅ | GoodsReceiptTest |
| FR-01 | Pratinjau penjualan server read-only untuk layar kasir | ✅ | `SalePreviewTest` (5); paritas posting, diskon/PPN, kredit, stok kadaluarsa |
| 4.5 | Lampiran dokumen (foto surat jalan) — penyimpanan privat, akses pemilik/approver, metadata + audit | ✅ | GoodsReceiptTest |

### Fase 5 — Tagihan HRD

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 5.1 | Periode tagihan: buka / ubah jadwal / tutup periode (struk kredit terikat, periode berikutnya terbuka otomatis) | ✅ | BillingTest |
| 5.2 | Invoice gabungan ke HRD + rincian per karyawan (PPN kredit dihitung saat invoice); terbit, serah ke HRD | ✅ | BillingTest |
| 5.3 | Catat pembayaran HRD (potong gaji), boleh sebagian | ✅ | BillingTest |

### Fase 6 — Cetak, laporan, dashboard

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 6.1 | Struk thermal 58/80 mm (CSS print browser; data struk sudah dari API) | 🔨 | Implementasi frontend selesai; pemilihan ukuran tersedia di kasir dan riwayat; perlu uji printer fisik |
| 6.2 | Cetak invoice HRD | 🔨 | Lembar A4, status, riwayat pembayaran, dan sisa tagihan selesai; perlu uji cetak fisik |
| 6.3 | Dashboard minimal dan laporan dasar (penjualan harian, stok menipis/kedaluwarsa, ringkasan kas) | ✅ | `ReportTest` (3); periode WIB, filter toko/kasir, endpoint detail + dashboard; suite 231 lulus |

### Fase 7 — Hardening & UAT

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 7.1 | Seluruh `php artisan test` hijau di akhir proyek. **Suite saat ini sudah hijau (238 lulus, 28 Okt 2026)**; gerbang ini diulang setiap tahap baru dan dikunci sebelum UAT | ⏳ | tugas pengguna |
| 7.2 | Seeder demo + skrip smoke test alur utama | ⏳ |  |
| 7.3 | Konfirmasi keputusan klien: R-04 PPN, Q-07/09/10/11/13/14, ASUMSI pembelian | ⏳ | klien |
| 7.4 | Uji perangkat: scanner barcode dan printer thermal | ⏳ | perangkat klien |
| 7.5 | UAT bersama klien | ⏳ |  |

### Fase 8 — Cut-over & go-live

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 8.1 | Pemasangan lokal + prosedur backup | ⏳ |  |
| 8.2 | Stok awal manual saat cut-over (endpoint 2.2 sudah ada; impor data ditunda klien) | ⏳ |  |
| 8.3 | Pelatihan dan go-live | ⏳ |  |
| 8.4 | Modul impor data dari aplikasi lama | ⏸ | ditunda klien, ±1,5–2 bulan |

### Di luar Paket 1 (setelah go-live)

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| P2 | Paket 2: Saldo Pembelian + alokasi, pembayaran supplier, setoran bank, expenses, retur pelanggan, credit note | ⏸ |  |
| P3 | Paket 3: retur supplier + write-off, rekonsiliasi bank, laporan analitik Owner | ⏸ |  |

---

## 3. Gerbang kualitas: status `php artisan test`

| Suite | Jumlah test | Status | Dikonfirmasi oleh |
|---|---|---|---|
| SeederTest, AuthTest, RbacTest, ReauthServiceTest, CategoryTest, SupplierTest, ProductTest, NumberSequenceTest, DecimalTest, Ean13Test, StockStatusTest | 3 · 8 · 7 · 6 · 8 · 4 · 15 · 1 · 4 · 2 · 5 | ✅ | pengguna (24 Okt 2026) |
| InventoryServiceTest, OpeningBalanceTest, CustomerTest, NotificationTest | 10 · 9 · 12 · 4 | ✅ | pengguna (24 Okt 2026) |
| ShiftTest, SaleTest | 7 · 17 | ✅ | pengguna (24 Okt 2026) |
| PurchaseRequisitionTest, PurchaseOrderTest, GoodsReceiptTest (+ `tests/Concerns/BuildsPurchasing.php`) | 12 · 13 · 16 | ✅ | backend test run (27 Okt 2026) |
| SaleVoidTest, CashDepositTest | 6 · 16 | ✅ | test backend (28 Okt 2026) |
| BillingTest | 10 | ✅ | pengguna (25 Okt 2026) |
| PricingSettingsTest | 6 | ✅ | pengguna (25 Okt 2026) |
| UserManagementTest | 10 | ✅ | pengguna (26 Okt 2026) |
| CashMovementTest | 4 | ✅ | backend test run (26 Okt 2026) |
| StockTransferTest | 6 | ✅ | backend test run (27 Okt 2026) |
| StockAdjustmentTest | 9 | ✅ | backend test run (27 Okt 2026) |
| ReportTest | 3 | ✅ | backend test run (28 Okt 2026) |
| **Total saat ini (30 kelas)** | **238** — 238 lulus | ✅ | backend test run (28 Okt 2026) |

Verifikasi terbaru: pada 28 Okt 2026 `php artisan test` dijalankan setelah FR-02; seluruh 238 test lulus (2.129 assertions).

Perintah: `php artisan test` (semua) atau `php artisan test --filter=GoodsReceiptTest` (satu kelas). Test memakai database `pos_retail_test`; `tests/TestCase.php` menolak berjalan di database yang namanya tidak berakhiran `_test`. Kegagalan paling mungkin: salah ketik nama kolom atau perbedaan format respons kecil — kirim keluaran lengkapnya ke agent yang menulis kodenya.

---

## 4. Untuk agent frontend

**Terbaru (28 Okt 2026): backend suite lulus 238 test; UI Dashboard dan Tagihan HRD telah dikonfirmasi pengguna, Manajemen Pengguna dan Transfer Stok siap diuji.** UI kas nonpenjualan, Draft setoran parsial, dan Riwayat Penjualan juga sudah diuji pengguna. `/goods-receipts` mendukung lokasi gudang backend 4.4 dan lampiran dokumen backend 4.5; UI pemilih lokasi/putaway belum dibuat, sementara unggah/unduh lampiran tersedia dan menunggu uji klik. Penerimaan, UI PR/PO dan Adjustment/Opname menunggu uji klik. Akses Finance receive-only pada antrean setoran lulus test backend; UAT UI Finance masih belum dikonfirmasi. Kontrak adjustment ada di `BACKEND_PROGRESS.md` bagian 1.

| Modul | Bagian `BACKEND_PROGRESS.md` | Status backend | Folder UI terlihat di zip terakhir |
|---|---|---|---|
| Auth, kategori, supplier, produk | HANDOFF bagian 6 | ✅ | auth, categories, suppliers, products |
| Inventory (stok awal, stok per batch, pergerakan) | 1 | ✅ | inventory |
| Adjustment & Opname | 1 | ✅ backend / 🟡 UI | `inventory/AdjustmentsPage.tsx` (menunggu uji klik) |
| Transfer stok antarposisi / putaway | 1 | ✅ | `inventory/TransfersPage.tsx` (menunggu uji klik; katalog posisi rak belum ada) |
| Dashboard dan laporan | 11 | ✅ | `reports/DashboardPage.tsx` (filter sudah dikonfirmasi pengguna) |
| Tagihan HRD | 8 | ✅ | `billing/BillingPage.tsx` (uji klik pengguna berjalan lancar) |
| Manajemen pengguna | 10 | ✅ | `users/UsersPage.tsx` (menunggu uji klik) |
| Karyawan + batas kredit | 2 | ✅ | customers |
| Notifikasi | 3 | ✅ | notifications |
| Shift kasir | 4 | ✅ | shifts |
| Penjualan (POS) | 5 | ✅ | belum ada folder |
| **Pembelian (PR, PO, penerimaan)** | **6** | ✅ | belum ada folder |
| Setoran, endapan, void | 7 | ✅ | belum ada folder |
| Kas masuk/keluar nonpenjualan | 7.4 | ✅ | shifts; UI baru selesai, menunggu verifikasi browser |

Kolom UI menunjukkan folder fitur pada source frontend saat ini; rincian status dan cakupan layar ada di `FRONTEND_PROGRESS.md`.

**Pesan siap salin untuk agent frontend:**

> Backend Pembelian (PR → PO → penerimaan barang) sudah mendukung penerimaan ke lokasi gudang aktif bila `warehouse_enabled=true` dan lampiran dokumen penerimaan privat; baca `docs/BACKEND_PROGRESS.md` bagian 6. Layar yang sekarang bisa dibuat, urut prioritas: (1) penerimaan barang oleh Kasir (`GET /api/purchase-orders?receivable=1` → `POST /api/goods-receipts` dengan `post: true` dan `receiving_location_id` opsional), (2) daftar/form PR untuk Kasir, (3) antrean pemeriksaan Finance dan dialog persetujuan Owner (input username + password; salah → 422 `approver_password`), (4) PO untuk Admin, (5) verifikasi dokumen dan unggah lampiran penerimaan. Catatan: Kasir tidak menerima harga beli (`unit_price`, `unit_cost`, `total` = `null`); `qty_damaged` hanya dicatat, tidak menambah stok. Status backend ✅ (231 test lulus). **Layar kasir (penjualan, bagian 5) masih menjadi prioritas utama** bila belum dibuat.

---

## 5. Cara memperbarui berkas ini

1. Setiap tahap selesai ditulis: ubah statusnya ke 🟡, tambahkan baris di `BACKEND_PROGRESS.md` (Riwayat + kontrak), dan perbarui angka di bagian 1.
2. Setelah `php artisan test` dijalankan dan hijau: ubah 🟡 → ✅ (tahap dan baris suite di bagian 3), catat tanggal dan jumlah test lulus di judul berkas dan tabel bagian 3, lalu sinkronkan penanda status di `BACKEND_PROGRESS.md` dan tabel status `HANDOFF` bagian 4.
3. Keputusan klien yang masuk (R-04, Q-xx): catat di `HANDOFF` bagian 9 dan hapus dari daftar tahap 7.3 bila selesai.
4. Jangan menandai ✅ sebelum test dijalankan (aturan kerja `HANDOFF` bagian 8 butir 5).
