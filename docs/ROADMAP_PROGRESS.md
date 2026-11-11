# Peta Jalan & Progres — POS Retail SMK

**Diperbarui:** 10 November 2026 (Handoff #8: `OpnameHistoryTest` 8 test/81 assertions; backend penuh 381/387; frontend 252 test; build lulus; UAT/benchmark skala masih terbuka) · **Berkas ini = pedoman progres proyek.** Untuk kontrak endpoint dan layar yang bisa dibuatkan UI, rujukannya `BACKEND_PROGRESS.md`; daftar command operator ada di `OPERATOR_COMMANDS.md`; untuk progres layar frontend, rujuk `FRONTEND_PROGRESS.md`; untuk aturan kerja dan arsitektur, `HANDOFF_POS_RETAIL_SMK.md`.

## Adjustment & Opname — Ikhtisar

Bagian ini merangkum fondasi adjustment stok dan siklus opname. Catatan per handoff tetap dipertahankan di bawah.

### Laporan Piutang Tahunan

- Tab ketiga **Tutup Tahun** merangkum tagihan kredit, pembayaran, dan sisa piutang per karyawan berdasarkan tahun `billing_periods.period_month`.
- Laporan tahun berjalan dihitung langsung dari transaksi terkini. Tagihan mengikuti periode billing; pembayaran tahun berjalan dibatasi waktu saat laporan diminta, sedangkan tahun sebelumnya memakai batas akhir 31 Desember. Pembayaran invoice gabungan dialokasikan proporsional ke karyawan menurut nilai tagihan.
- Tanggal cetak dapat diatur di **Pengaturan → Piutang → Laporan piutang tahunan**. Tombol cetak tahun berjalan aktif pada tanggal tersebut; laporan tahun sebelumnya selalu dapat dicetak.
- Laporan tidak menutup periode bulanan atau membuat invoice tahunan. Akses laporan mengikuti `invoice.generate`; pengaturan tanggal mengikuti `settings.manage`.
- Endpoint: `GET /api/annual-receivable-reports`, `GET /api/annual-receivable-reports/{year}`, `GET/PUT /api/settings/annual-receivable-report`.

### Fitur, layar, dan alur

- **Adjustment manual:** daftar, detail, dan form adjustment stok tersedia pada tab Adjustment; posting mencatat pergerakan stok.
- **Stock opname:** buat sesi untuk seluruh toko atau kategori; lihat daftar, cakupan, progres per kategori, dan detail sesi.
- **Penghitungan:** input manual atau scanner, ubah jumlah secara eksplisit, log hitungan, lookup barcode, dan sinkronisasi antrean offline.
- **Laporan dan workflow:** setelah semua produk dihitung, laporan dapat ditinjau; sesi dapat diajukan ke Owner, ditolak untuk dihitung ulang, disetujui dan diposting, atau langsung diposting jika persetujuan tidak diperlukan.
- **Riwayat:** pengelompokan bulan/kuartal/tahun, filter status/hasil/cakupan/tanggal, tren produk berselisih, produk yang sering berselisih, status opname terakhir, dan pengingat opsional.
- **Ekspor:** CSV ringkasan/detail per sesi dan rekap periode; laporan serta rekap dapat dicetak dari peramban.

Alur normal: Admin menutup transaksi dan membuat sesi → petugas menghitung seluruh produk → Admin meninjau laporan → bila perlu, ajukan dan minta Owner menyetujui/menolak → posting membekukan hasil dan menyesuaikan stok secara atomik → lock dilepas → riwayat/ekspor baca-saja. `posted` dan laporan bekunya tidak dapat diubah.

### Endpoint dan izin

Semua endpoint berada di `/api` dan memerlukan Sanctum kecuali autentikasi tetap mengikuti route middleware.

| Endpoint | Izin |
|---|---|
| `GET /stock-opname/lock-status` | Login; endpoint lock status saja tidak memerlukan izin opname |
| `GET /stock-opname/last-status`, `/stock-opname-sessions`, `/stock-opname-sessions/{id}`, `/report`, `/tree`, `/items`, `/scope-options` | `opname.view` (`report` pratinjau aktif juga memerlukan `opname.review`) |
| `GET /stock-opname-sessions/periods`, `/frequent-variance`, `/periods/export`, `/{id}/export` | `opname.view`; kunci nilai hanya bagi `opname.view_value` |
| `GET /stock-opname-sessions/{id}/offline-index`, `GET .../lookup`, `GET .../counts`, `POST .../counts`, `.../counts/batch`, `.../counts/{item}/clear` | `opname.count` |
| `POST /stock-opname-sessions` | `opname.create` |
| `POST /stock-opname-sessions/{id}/cancel` | `opname.cancel` |
| `POST .../{id}/submit` | `opname.post` |
| `POST .../{id}/approve`, `POST .../{id}/reject` | `opname.approve` (Owner) |
| `GET/PUT /settings/opname` | `opname.settings.manage`; pengingat oleh Admin/Owner, ambang hanya Owner |
| Adjustment manual `/inventory/adjustments`, `/inventory/adjustments/meta`, `/inventory/adjustments/{id}` | Login; izin spesifik diperiksa controller dan aturan kewenangan stok |

Role bawaan: Owner dapat meninjau, menghitung, mengubah ambang, menyetujui, dan melihat nilai; Admin dapat mengelola/memulai/menghitung/mengajukan, tetapi tidak menyetujui atau melihat nilai rupiah; Accounting dapat membaca riwayat/laporan dan nilai jika memiliki `opname.view_value`, namun bukan menghitung atau memposting; Kasir tidak mendapat fitur opname kecuali akses `lock-status` yang terautentikasi. Izin efektif tetap diputuskan backend, bukan hanya visibilitas UI.

### Pengaturan, lock, blind count, dan batasan

- Kunci: `opname.show_system_qty` (default `false`); `opname.approval.per_product_threshold` (Rp25.000); `opname.approval.per_session_threshold` (Rp200.000); `opname.approval.require_first_opname` (`true`); `opname.reminder.enabled` (`false`); `opname.reminder.interval_days` (`30`, 1–365); `opname.reminder.basis` (`all` atau `any`, default `all`).
- Sesi `in_progress` dan `pending_approval` mengunci produk dalam cakupan; `posted` dan `cancelled` melepas lock. Sesi yang saling tumpang tindih ditolak.
- Pada mode blind, jumlah sistem/status cocok/selisih tidak dikirim pada endpoint penghitungan; `offline-index` tidak pernah berisi angka stok atau selisih. Laporan pratinjau hanya untuk role yang boleh meninjau, dan nilai/ambang hanya untuk `opname.view_value`.
- Rekap historis hanya menghitung sesi `posted`; sesi lain hanya memengaruhi jumlah sesi total. Batas kalender menggunakan zona waktu toko dan timestamp basis data disimpan UTC.
- Pengingat mati secara default, berupa banner aplikasi saja, dan tidak membuat sesi otomatis atau memblokir transaksi. Belum ada PWA/service worker; reload ketika offline tidak didukung. UAT scanner/perangkat nyata masih diperlukan.
- Simulasi lokal: `cd backend; php artisan opname:simulate-counts {sessionId} --percent=30 --variance=10`; command wajib menolak environment selain `local`/`testing`. Di frontend, `window.__simulateScan(...)` hanya untuk dev dan tidak boleh ada di build produksi.

### Utang teknis dan catatan pemeriksaan

- Jangan menghapus `stock_adjustments.source`, `stock_adjustments.opname_session_id`, atau alasan `opname_result` berdasarkan asumsi: pencarian kode menemukan pemakaian aktif `source`/`opname_session_id` pada posting, lock, respons, serta test; alasan `opname_result` dipakai untuk adjustment internal opname. Usulan aman: **pertahankan kolom dan enum saat ini**; bila ingin merapikan, lakukan analisis migrasi terpisah setelah audit data, misalnya migrasi yang menghapus FK/kolom `opname_session_id` hanya bila seluruh consumer serta data legacy sudah dipindahkan. Tidak ada migrasi penghapusan yang dibuat di seri ini.
- Tidak ada benchmark produksi atau UAT staging/perangkat nyata yang dijalankan oleh sesi ini; angka benchmark lokal dan hasil UAT harus dicatat setelah tersedia.

| Tanda | Arti |
|---|---|
| ✅ | Selesai **dan** `php artisan test` sudah dijalankan dan hijau |
| 🟡 | Kode + test sudah ditulis, tetapi validasi belum lengkap/hijau atau masih menunggu konfirmasi pengguna |
| ⏳ | Belum dikerjakan |
| ⏸ | Ditunda: menunggu klien atau di luar cakupan 1 bulan (Paket 2/3) |

---

## 1. Posisi saat ini

**Backend Paket 1 (Fase 0–6; tidak termasuk hardening/UAT/go-live dan Paket 2/3): 38 tahap — 32 ✅ selesai dan lulus test · 3 🟡 menunggu test · 3 ⏳ belum.**

| Fase | ✅ | 🟡 | ⏳ | ⏸ |
|---|---|---|---|---|
| Fase 0 — Analisis & desain | 2 | 0 | 0 | 0 |
| Fase 1 — Fondasi backend (tahap 1a–1c) | 8 | 3 | 0 | 0 |
| Fase 2 — Inventory & karyawan | 6 | 0 | 1 | 0 |
| Fase 3 — POS & kas | 7 | 0 | 0 | 1 |
| Fase 4 — Pembelian | 5 | 0 | 0 | 0 |
| Fase 5 — Tagihan HRD | 3 | 0 | 0 | 0 |
| Fase 6 — Cetak, laporan, dashboard | 1 | 0 | 2 | 0 |
| Fase 7 — Hardening & UAT | 0 | 0 | 5 | 0 |
| Fase 8 — Cut-over & go-live | 0 | 0 | 3 | 1 |
| Di luar Paket 1 (setelah go-live) | 0 | 0 | 0 | 2 |
| **Total semua fase** | **32** | **3** | **11** | **4** |

### Aplikasi sekarang sudah bisa apa (✅ = lulus `php artisan test`, terakhir 28 Okt 2026)

- **Masuk dan hak akses:** login/logout, role Admin dan Kasir, izin yang bisa didelegasikan, persetujuan dengan mengetik ulang password pemberi persetujuan. ✅
- **Master data:** kategori, supplier, produk (harga + riwayat harga, barcode otomatis, status stok). ✅
- **Stok:** Admin memasukkan stok awal; stok dilihat per batch dengan urutan FEFO dan lencana kedaluwarsa; riwayat pergerakan stok. ✅
- **Pemantauan stok & PR otomatis:** ambang toko default 3 unit dapat diatur; kuantitas pengisian ulang ditetapkan pada master produk; draft PR tersinkron otomatis dan Kasir hanya meneruskan. ✅ `StockMonitoringTest` serta 10 test feature stok/pembelian terkait lulus; total validasi terarah 122 test (1.158 assertions).
- **Transfer stok:** transfer antarposisi dan putaway gudang↔toko mengikuti status draft/posting, menjaga batch dan saldo total, serta menghormati `warehouse_enabled`. ✅
- **Adjustment dan opname:** Kasir membuat dan mengajukan snapshot hitung stok; Admin menyetujui (re-auth wajib untuk loss/expired) dan posting movement penyesuaian secara atomik. ✅
- **Karyawan:** Kasir menambah karyawan (menunggu verifikasi, hanya tunai), Admin memverifikasi dan menetapkan batas kredit, notifikasi ke Admin. ✅
- **Kasir:** buka shift (hitung buta), jual tunai atau kredit potong gaji (FEFO, diskon, PPN opsional, batas kredit + pengecualian Admin dengan re-auth, anti transaksi ganda), cetak ulang berlabel SALINAN, tutup shift dengan selisih kas, tinjau oleh Admin. ✅
- **Kas dan koreksi:** kebijakan endapan (tetap/persen, min/maks, pembulatan ke bawah), setoran akhir shift dan setoran parsial tengah shift, Finance menghitung ulang dan menerima (selisih → koreksi), saldo Kas Kecil/Kas Besar dari ledger, void penjualan oleh Admin (stok kembali, kas/kredit dikoreksi). ✅
- **Kas nonpenjualan:** Kasir mencatat kas masuk/keluar pada shift aktif; kas yang diharapkan dan saldo Kas Kecil diperbarui, dengan audit dan ledger. ✅
- **Pembelian:** PR → pemeriksaan Finance → persetujuan Owner → PO → kirim → penerimaan barang ke toko atau gudang (posisi rak opsional), HPP rata-rata, verifikasi surat jalan/faktur. ✅
- **Lampiran penerimaan:** Kasir/Admin dapat mengunggah foto surat jalan atau dokumen pendukung pada GR yang belum diverifikasi; berkas disimpan privat dan aksesnya dibatasi ke pemilik GR atau pemegang izin verifikasi. ✅

- **Tagihan HRD:** Admin membuka/menutup periode tagihan pada hari gaji (struk kredit terikat, periode berikutnya otomatis bernama `Periode [Nama Bulan]`), mengubah nama, dan membatalkan periode kosong dengan alasan; membuat satu invoice gabungan per periode dengan rincian per karyawan, menerbitkan, menandai diserahkan ke HRD, dan mencatat pembayaran HRD (boleh sebagian). ✅

- **Model administrasi toko (🟡):** toko memilih model simple (Admin + Kasir) atau standar retail (Kasir, Finance, Purchasing, Accounting, Owner); peralihan divalidasi (tiap role wajib punya akun aktif) dan mengonversi Admin↔Owner; menu per role mengikuti permission.
- **Kewenangan stok (🟡):** per toko, Admin/Owner menentukan role yang boleh stok awal, penerimaan, transfer, dan ajuan/persetujuan adjustment, terpisah untuk lokasi toko dan gudang, di toko dengan atau tanpa gudang dan di model administrasi mana pun.
- **Kunci otorisasi (🟡):** Owner/Admin dapat memiliki kunci khusus (kode 6 karakter kapital atau kalimat rahasia) yang menggantikan atau melengkapi password pada persetujuan PR/PO, adjustment, dan pengecualian kredit; dapat dibuat, diganti, dihapus, dicabut oleh pengelola, dan terkunci otomatis bila ditebak berulang. UI pengelolaan tersedia di Pengaturan; typecheck, 183 test frontend, dan build lulus, uji klik menunggu. Backend perlu migration `authorization_keys`.
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
8. ~~Dashboard dan laporan dasar (6.3)~~ — **selesai 28 Okt 2026: laporan penjualan harian, stok menipis/kedaluwarsa, serta ringkasan kas; empat endpoint, batasan toko/kasir, periode WIB, dan `ReportTest` (3 test); suite 231 test lulus (2.058 assertions).** Laporan laba kotor expected/valid tersedia lewat endpoint terpisah dengan akses `reports.profit.view`; UI Dashboard telah menambahkan ringkasan dan visualisasi sesuai role. Frontend typecheck, test, dan build lulus; uji klik menunggu.
9. **Finalisasi Paket 1 — prioritas disepakati (B#4):** (1) Management Retail/operator platform ✅ ada (login CLI → layar operator masih bermasalah, ditangani agent lain); (2) **model administrasi toko 1.9 🟡** — jalankan `php artisan test` untuk `AdminModelTest`; (3) **matriks kewenangan stok 1.10 🟡** (siapa boleh stok awal / penerimaan / transfer / adjustment, per toko, tanpa bergantung gudang atau model) — jalankan `php artisan test` untuk `StockAuthorityTest`; (4) saklar Warehouse ✅ sudah ada (`WarehouseSettingsTest`); (5) **kunci otorisasi Owner 1.11 🟡** (melengkapi re-auth: hash, batas percobaan, penguncian, rotasi, audit; default mode password) — jalankan `php artisan migrate` lalu `php artisan test` untuk `AuthorizationKeyTest`. **Seluruh prioritas backend finalisasi Paket 1 sudah tertulis; sisa: menjalankan test dan konfirmasi klien.** Frontend: satu workspace Pengaturan (termasuk model administrasi) dan navigasi alur kerja per role mengikuti `permissions` dari `/api/auth/me`.

### Tahap frontend terbaru

UI Operator Platform `/platform/stores` terpisah dari layout dan permission tenant POS: operator dapat mencari/filter/membuka detail tenant, onboarding tenant beserta Admin awal, serta mengaktifkan/nonaktifkan tenant. Login CLI menukar tiket sekali pakai dan membuka layar operator; akses operator ke rute tenant dialihkan kembali ke console platform. Password Admin awal dibersihkan setelah request dan tidak disimpan dalam cache mutation. Typecheck, 161 test frontend, dan build produksi lulus; uji klik login CLI dan layar operator menunggu.

UI Kasir `/pos` kini terintegrasi dengan `POST /api/sales/preview`: total, diskon, PPN, stok FEFO, dan sinyal batas kredit berasal dari backend setelah debounce; frontend tidak lagi menghitung perkiraan subtotal. Struk menampilkan peringatan jika total final posting berbeda dari pratinjau. Typecheck, 161 test frontend, build produksi, dan `git diff --check` lulus; uji klik setelah integrasi ini masih menunggu pengguna.

UI Manajemen Pengguna `/users` kini menyediakan daftar/cari/filter, tambah dan ubah akun, pengelolaan role/status, reset sandi, serta ganti sandi sendiri dari profil untuk semua pengguna. Aturan sensitif (self-role, self-deaktivasi, Admin aktif terakhir, validitas sandi) tetap ditegakkan backend. Typecheck, 161 test frontend, dan build produksi lulus; uji klik pengguna menunggu.

UI Tagihan HRD `/billing` mengelola periode, merinci kredit per karyawan, membuat/mencetak invoice, memproses penerbitan dan serah terima, serta mencatat pembayaran sebagian. Cetakan A4 mencakup status invoice, ringkasan pembayaran, dan sisa tagihan. Pengguna mengonfirmasi uji klik berjalan lancar.

UI Dashboard `/dashboard` memakai endpoint laporan gabungan dan laba, serta menampilkan kartu ringkasan untuk setiap menu sidebar yang diizinkan bagi pengguna aktif. Kartu mencakup status/antrean shift, penjualan, setoran, pembelian, persediaan, dan data master; detail grafik dan laporan tetap tersedia dalam panel terpisah. Laba diterima/belum diterima hanya terlihat bagi pemegang `reports.profit.view`; perbedaan cakupan filter kasir dijelaskan. Ringkasan memakai endpoint daftar yang telah ada dan kesalahan dilaporkan per kartu. UI `/settings` juga tetap menyediakan perubahan nama toko berdasarkan `store.name` dari `/auth/me`. Perubahan dashboard menunggu uji klik.

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
| 1.2 | Seeder: toko, role, 54 permission, register, akun dana, setting, akun admin | ✅ | SeederTest |
| 1.3 | Auth: login / logout / me, throttle, audit | ✅ | AuthTest |
| 1.4 | RBAC (role + override per pengguna) dan re-auth persetujuan (`ReauthService`, lockout 5x) | ✅ | RbacTest, ReauthServiceTest |
| 1.5 | Master data — kategori | ✅ | CategoryTest |
| 1.6 | Master data — supplier | ✅ | SupplierTest |
| 1.7 | Master data — produk (riwayat harga, barcode otomatis, status stok) | ✅ | ProductTest |
| 1.8 | Manajemen pengguna (Admin): tambah Kasir/Admin, ubah, aktif/nonaktif, reset sandi; ganti sandi sendiri | ✅ | UserManagementTest |
| 1.9 | Model administrasi toko: simple (Admin + Kasir) atau standar retail (Kasir, Finance, Purchasing, Accounting, Owner); validasi akun per role, konversi Admin↔Owner, role baru + matriks permission, `can.any` | 🟡 | AdminModelTest (8) |
| 1.10 | Matriks kewenangan stok per toko: siapa boleh stok awal, penerimaan, transfer, ajuan dan persetujuan adjustment (lingkup toko/gudang); permission stok diturunkan dari matriks; `inventory.opening_balance`; FR-04 | 🟡 | StockAuthorityTest (12) |
| 1.11 | Kunci otorisasi Owner/Admin: kode 6 karakter kapital atau kalimat rahasia (hash), CRUD mandiri + pencabutan, mode `password`/`key`/`password_and_key` per toko di semua dialog re-auth, penguncian setelah 10 gagal; migration `authorization_keys` | 🟡 | AuthorizationKeyTest (12) |

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

**Tambahan finalisasi — mesin kasir (di luar tahapan baseline):** `registers` ternyata sudah tersedia dan sudah menjadi FK shift. CRUD mesin, akun Kas Kecil per mesin, permission `register.manage`, pemilihan mesin saat buka shift, dan nama mesin pada laporan telah ditambahkan; `RegisterTest` serta `ShiftTest` lulus. Migration baru tidak membuat tabel; hanya melengkapi akun laci yang belum ada dan menegakkan keunikan nama mesin serta akun Kas Kecil per mesin. Status: ✅.

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
| P2 | Paket 2: Saldo Pembelian + alokasi, pembayaran supplier, setoran bank, expenses, retur pelanggan, credit note | 🟡 | Fondasi rekening bank, Kas Pembelian, alokasi dana PO, persetujuan Owner, dan pelepasan alokasi sudah dibuat; `PurchaseOrderTest` dan `GoodsReceiptTest` lulus terarah. Suite penuh 294/297 dengan tiga kegagalan test lama yang tidak terkait. Pembayaran supplier dan modul P2 lainnya belum dikerjakan |
| P3 | Paket 3: retur supplier + write-off, rekonsiliasi bank, laporan analitik Owner | 🟡 | Retur supplier/write-off backend dan UI tersedia; test frontend lulus, uji klik menunggu. Rekonsiliasi bank dan analitik Owner masih tersisa |

---

## 3. Gerbang kualitas: status `php artisan test`

| Suite | Jumlah test | Status | Dikonfirmasi oleh |
|---|---|---|---|
| SeederTest, AuthTest, RbacTest, ReauthServiceTest, CategoryTest, SupplierTest, ProductTest, NumberSequenceTest, DecimalTest, Ean13Test, StockStatusTest | 3 · 8 · 7 · 6 · 8 · 4 · 15 · 1 · 4 · 2 · 5 | ✅ | pengguna (24 Okt 2026) |
| InventoryServiceTest, OpeningBalanceTest, CustomerTest, NotificationTest | 10 · 9 · 12 · 4 | ✅ | pengguna (24 Okt 2026) |
| ShiftTest, SaleTest | 7 · 17 | ✅ | pengguna (24 Okt 2026) |
| PurchaseRequisitionTest, PurchaseOrderTest, GoodsReceiptTest (+ `tests/Concerns/BuildsPurchasing.php`) | 12 · 17 · 16 | 🟡 | `PurchaseOrderTest` (17) dan `GoodsReceiptTest` (16) lulus terarah; suite penuh 294/297 dengan tiga kegagalan test lama yang tidak terkait |
| SaleVoidTest, CashDepositTest | 6 · 16 | ✅ | test backend (28 Okt 2026) |
| BillingTest | 10 | ✅ | pengguna (25 Okt 2026) |
| PricingSettingsTest | 6 | ✅ | pengguna (25 Okt 2026) |
| UserManagementTest | 10 | ✅ | pengguna (26 Okt 2026); sesuaikan daftar role di `/api/roles` — jalankan ulang |
| AdminModelTest | 8 | 🟡 | menunggu `php artisan test` |
| StockAuthorityTest | 12 | 🟡 | menunggu `php artisan test` |
| AuthorizationKeyTest | 12 | 🟡 | menunggu `php artisan migrate` lalu `php artisan test` |
| CashMovementTest | 4 | ✅ | backend test run (26 Okt 2026) |
| StockTransferTest | 6 | ✅ | backend test run (27 Okt 2026) |
| StockAdjustmentTest | 9 | ✅ | backend test run (27 Okt 2026) |
| ReportTest | 3 | ✅ | backend test run (28 Okt 2026) |
| **Total saat ini (31 kelas)** | Suite penuh terakhir 244 test (243 lulus, 1 gagal `ReportTest`); **+ 8 test `AdminModelTest` 12 test `StockAuthorityTest`, dan 12 test `AuthorizationKeyTest` belum dijalankan** | 🟡 | backend test run (31 Okt 2026) |

Verifikasi terbaru: pada 28 Okt 2026 `php artisan test` dijalankan setelah FR-02; seluruh 238 test lulus (2.129 assertions).

Perintah: `php artisan test` (semua) atau `php artisan test --filter=GoodsReceiptTest` (satu kelas). Test memakai database `pos_retail_test`; `tests/TestCase.php` menolak berjalan di database yang namanya tidak berakhiran `_test`. Kegagalan paling mungkin: salah ketik nama kolom atau perbedaan format respons kecil — kirim keluaran lengkapnya ke agent yang menulis kodenya.

---

## 4. Untuk agent frontend

### Adjustment & Opname — Handoff #1 (6 Nov 2026)

**Status:** implementasi backend dan UI Adjustment langsung selesai; validasi terarah lulus, UAT browser masih menunggu. Tab Opname tetap placeholder untuk Handoff #2 dan seterusnya.

- Halaman bertab memakai rute bersarang `/inventory/adjustments/adjustment` dan `/inventory/adjustments/opname`; rute induk mengarahkan ke tab Adjustment. Menu dan akses langsung untuk Admin, Owner, dan Kasir tidak memakai permission Adjustment baru. Tab Opname tetap placeholder untuk Handoff #2.
- Adjustment manual mengubah stok saat disimpan dan tidak dapat diedit/dihapus; koreksi dilakukan dengan adjustment baru. Alur UI, endpoint, dan dokumen Adjustment legacy dihapus; endpoint utama `/api/inventory/adjustments` dipakai oleh halaman baru.
- `GET /api/inventory/adjustments/meta` mengembalikan tipe dan alasan; `GET /api/inventory/adjustments` mengembalikan daftar berpaginasi dengan filter `q`, `type`, `reason_code`, `source`, `date_from`, `date_to`, `sort`, `page`, dan `per_page`; `GET /api/inventory/adjustments/{id}` mengembalikan detail; `POST /api/inventory/adjustments` menerima `product_id`, `type`, integer `quantity`, `reason_code`, `notes?`, `expiry_date?`, dan UUID `client_request_id`. POST sukses `201`; idempotensi permintaan yang sama `200`.
- `StockAdjustmentService::record()` menjadi jalur pencatatan yang mendukung `source=opname`/`opname_session_id` untuk Handoff #6. Perubahan saldo tetap melalui `InventoryService::recordDirectAdjustment()`; pengurangan mengikuti FEFO. Produk yang melacak kedaluwarsa memerlukan tanggal pada penambahan; batch internal tetap dipakai agar FEFO tidak rusak, tanpa menampilkan ID/kode batch di UI.
- UI: `AdjustmentOpnamePage`, `AdjustmentsPage`, form/detail responsif, filter dan paginasi, validasi stok/jumlah/catatan/tanggal, idempotensi UUID, dan `ProductPicker` bersama untuk pencarian/barcode. `ProductPicker` tidak menampilkan stok pada hasil pencarian secara default.
- Pemeriksaan implementasi menemukan perbedaan penting dengan asumsi handoff: produk hanya menyimpan `track_expiry`, bukan tanggal kedaluwarsa; tanggal berasal dari batch. Karena itu model expiry-bucket dan penyimpanan batch lama dipertahankan. Penambahan stok produk bertanggal kedaluwarsa meminta tanggal, sedangkan pengurangan tetap dialokasikan FEFO.
- Validasi konsolidasi (6 Nov 2026): `StockAdjustmentTest` 12 test/76 assertions, `StockAuthorityTest` 11/123, `SupplierReturnTest` 8/77, dan `RbacTest` 7/15 lulus; Pint untuk PHP yang diubah lulus. Frontend typecheck, production build, dan seluruh 233 test Vitest lulus. UAT browser tetap menunggu. Ringkasan kontrak backend ada di `BACKEND_PROGRESS.md`.

### Adjustment & Opname — Handoff #2 (7 Nov 2026)

**Status:** fondasi sesi opname backend dan UI selesai; test terarah lulus. UAT browser pada 375/768/1280 px belum dilakukan. Layar menghitung, simpan hitungan, posting, persetujuan, serta adjustment otomatis tetap untuk Handoff #3–#6.

**Pemeriksaan awal (bagian 3 handoff):**
- Handoff #1 terpasang: tab/rute Adjustment, placeholder Opname, `ProductPicker`, tabel `stock_adjustments.opname_session_id` nullable, dan `StockAdjustmentService::record()`. Test lama jalur `source=opname` kini memakai ID sesi valid agar FK baru tetap ditegakkan; Adjustment manual tidak berubah.
- Kategori hierarkis lewat `categories.parent_id`; produk aktif (`products.status = active`) dapat terhubung di level kategori mana pun. Endpoint kategori lama datar dengan `products_count` langsung, sehingga pohon dan hitungan turunan ditambahkan khusus lewat `scope-options`. Kedalaman tidak dibatasi oleh skema; utilitas kategori yang ada membatasi penelusuran siklus sampai 50 tingkat.
- Saldo tersimpan per lokasi/posisi/batch dan bucket `sellable`, `quarantine`, `damaged`. `InventoryService::productStock()` hanya membaca satu produk per panggilan; sesi memakai satu query agregat massal di transaksi yang sama. Snapshot opname adalah jumlah ketiga bucket pada seluruh lokasi, termasuk produk bersaldo nol. Produk nonaktif dikecualikan; `ProductService` menolak menonaktifkan produk yang masih bersaldo positif.
- Penomoran mengikuti `NumberSequence` + `DocumentNumber` (`OPN-YYMMDD-######`); respons memakai envelope `data`, pagination Laravel, dan galat validasi 422. Permission mengikuti `PermissionCatalog`; tanggal waktu disimpan UTC dan ditampilkan dalam zona toko dari `/auth/me` (fallback WIB).
- Migrasi memeriksa bahwa seluruh `stock_adjustments.opname_session_id` lama masih `NULL` sebelum menambahkan FK. Untuk database yang telah ada, jalankan `php artisan db:seed --class="Database\Seeders\PermissionSeeder"` setelah migrasi agar permission opname dan grant role tersinkron.

**Backend selesai:**
- Tabel `stock_opname_sessions`, `stock_opname_session_categories`, `stock_opname_items` (termasuk kolom hitung nullable untuk handoff berikutnya), indeks, FK, dan FK `stock_adjustments.opname_session_id`.
- `OpnameSessionService::start()`, `cancel()`, `search()`, `find()`, `scopeOptions()`, serta `resolveScopeProducts()` yang dapat dipakai ulang. Mulai sesi mengunci baris toko untuk serialisasi permintaan, menolak irisan berdasarkan produk sesi aktif, memakai idempotensi UUID, dan menulis sesi/cakupan/item secara atomik dalam chunk 500. Tidak ada perubahan stok saat mulai atau batal.
- `GET /api/stock-opname-sessions`: `data[]` ringkasan + metadata pagination; filter `page`, `per_page` (maks. 100), `status`, `q`, `date_from`, `date_to`, `sort`.
- `GET /api/stock-opname-sessions/{id}`: ringkasan + catatan, kategori cakupan, dan data pembatalan. Keduanya tidak mengembalikan item, `system_qty_at_start`, atau kolom hitung.
- `POST /api/stock-opname-sessions`: body `scope_type`, `category_ids?`, `name?`, `notes?`, `client_request_id`; baru `201`, idempoten `200`, irisan `422` dengan `conflicting_sessions: [{id, number}]`.
- `POST /api/stock-opname-sessions/{id}/cancel`: body `{reason}` wajib; hanya status `in_progress` dapat dibatalkan.
- `GET /api/stock-opname/scope-options`: `{data: pohon kategori, total_products}`; node berisi `id`, `parent_id`, `name`, `product_count` aktif termasuk turunan, `locked_by`, dan `children`.
- Izin: `opname.view` untuk Admin, Owner, Accounting; `opname.count`, `opname.create`, dan `opname.cancel` untuk Admin dan Owner. Accounting hanya dapat melihat; Kasir tidak mendapat izin Opname. Untuk mempertahankan akses Adjustment dari Handoff #1, Kasir tetap melihat menu Adjustment langsung (tanpa tab/akses Opname). Pada database yang telah ada sebelum permission opname ditambahkan, jalankan `php artisan db:seed --class="Database\\Seeders\\PermissionSeeder"` dari folder `backend` agar grant Admin/Owner tersinkron.

**UI selesai:** daftar sesi responsif dengan pencarian/filter status, skeleton/kosong/error, pagination desktop dan “Muat lagi” mobile; modal Mulai Opname layar penuh di HP dengan pohon kategori, kunci sesi, jumlah produk, UUID idempoten dan tautan sesi konflik; detail deep-link dengan ringkasan dan pembatalan beralasan. Rute `/inventory/adjustments/opname/:sessionId` disiapkan sebagai slot Handoff #3. Accounting dapat membuka Opname saja; Kasir tetap hanya Adjustment.

**Validasi:** `OpnameSessionTest` 10 test/72 assertions (termasuk FK, atomisitas, permissions, filters, dan 5.000 produk), `StockAdjustmentTest` 12/76, `RbacTest` 7/15, `SeederTest` 3/21, Pint, `npm run build`, dan `npm test` (233 test) lulus. Start 5.000 produk terukur **1,570–4,675 detik** pada beberapa run; run terakhir 4,675 detik. Perintah: dari `backend`, `php artisan test --filter=OpnameSessionTest` dan `php artisan test --filter=StockAdjustmentTest`; jalankan `php artisan test` untuk suite penuh. Test suite backend penuh tidak dijalankan pada sesi ini. Berikutnya: Handoff #3 (kerangka layar hitung, peta progres baca-saja, dan pengaturan tampil/sembunyi stok), lalu UAT browser.

### Adjustment & Opname — Handoff #3 (7 Nov 2026)

**Status:** implementasi backend dan workspace baca-saja selesai; test opname, Pint, frontend typecheck/build, dan 233 test Vitest lulus. UAT browser pada 375/768/1280 px belum dilakukan. Form hitungan, scan, rekomendasi, posting, persetujuan, dan adjustment otomatis tetap untuk Handoff #4–#6.

**Pemeriksaan awal dan keputusan yang diterapkan:**
- `categories.parent_id` mendukung kedalaman bebas dan produk dapat berada langsung di kategori mana pun; tidak ditemukan kolom `sort_order`, jadi node kategori diurutkan alfabetis untuk hasil stabil. Pengujian kategori berpindah menunjukkan FK mencegah hard-delete; kategori yang tidak cocok dengan snapshot ditampilkan sebagai “Lainnya” dan item tetap memakai jalur nama snapshot.
- Pengaturan toko memakai tabel `settings` dengan nilai JSON, dan `AuditLogger` tersedia. Agar Owner hanya memperoleh akses opname yang diminta (bukan perluasan akses konfigurasi), pengaturan memakai izin khusus `opname.settings.manage` untuk Admin/Owner. Nilai awal `opname.show_system_qty=false`.
- Tidak ada komponen accordion khusus yang perlu dipakai; node memakai tombol native dengan `aria-expanded`/`role=tree`, React Query untuk fetch/refetch, dan safe-area menggunakan pola CSS `env(safe-area-inset-bottom)` yang sudah didukung aplikasi.

**Backend selesai:**
- `OpnameDisplayPolicy` menjadi sumber kebijakan tunggal: ketika setting mati, endpoint pohon tidak mengirim `variance_count`, endpoint item tidak mengirim `system_qty`, dan status produk hanya `uncounted`/`counted`; ketika aktif, status `matched`/`variance` dan angka stok sistem dikirim.
- `GET /api/stock-opname-sessions/{id}/tree` mengembalikan sesi, kebijakan tampilan, ringkasan progres, kategori hierarkis, jumlah produk langsung/turunan, status `not_started|partial|done`, dan jumlah selisih hanya saat angka stok ditampilkan.
- `GET /api/stock-opname-sessions/{id}/items` mendukung `category_id`, `scope=direct|all`, `q` minimal dua karakter, `only_uncounted`, paginasi, jalur kategori, dan prioritas barcode persis; menggunakan snapshot nama/barcode item. Kedua endpoint baca memerlukan `opname.view`.
- `GET/PUT /api/settings/opname` memakai izin `opname.settings.manage`; perubahan nilai dicatat melalui audit. `OpnameSessionService` kini menghitung `counted_products` per kelompok pada daftar dan detail.
- `php artisan opname:simulate-counts {sessionId} {--percent=30} {--variance=10} {--reset}` tersedia hanya di environment `local`/`testing`; tidak ada endpoint HTTP penulis hitungan. Contoh: `php artisan opname:simulate-counts 123 --percent=40 --variance=15`; bersihkan fixture dengan `php artisan opname:simulate-counts 123 --reset`, kemudian batalkan sesi uji agar produk tidak terkunci.

**UI selesai:** detail sesi menjadi workspace responsif. HP memakai tiga tampilan `?view=input|daftar|ringkasan` (default Input) dan bottom bar safe-area; tablet bisa melipat daftar; desktop menampilkan dua panel dan membuka Ringkasan dari header. Peta progres mendukung hierarki bebas, lazy-load/paginasi 100 produk, filter belum dihitung, pencarian nama/barcode beserta `category_path`, pemilihan konteks aktif, skeleton/kosong/error, tombol muat ulang, refetch 15 detik saat tab terlihat/fokus, status sesi nonaktif, dan placeholder input saja. `OpnameWorkspaceContext` menyediakan `activeNodeId`, `setActiveNodeId`, serta data tree untuk Handoff #4/#5. Bagian “Opname” pada Pengaturan menyediakan toggle dengan konfirmasi; hanya Admin/Owner yang melihatnya.

**Validasi:** `OpnameSessionTest` 17 test/160 assertions dan `StockAdjustmentTest` 12/76 lulus, begitu pula Pint dan frontend build/typecheck serta 233 test Vitest. Suite backend penuh: 341 lulus, 4 gagal (`PlatformStoreManagementTest` dua ekspektasi data tenant, `ReportTest` fixture kedaluwarsa, dan `SupplierTest` ekspektasi Kasir ditolak meski controller supplier yang ada memberi akses baca untuk `product.create`). Pada uji sesi 5.000 produk terakhir: pembuatan sesi **1,459 s**, tree **0,048 s**, dan items 100 baris **0,110 s**; target tree <1 s dan items <300 ms terpenuhi. UAT browser serta pembatalan/reset fixture melalui browser lokal tetap perlu dilakukan pengguna.

### Adjustment & Opname — Handoff #4 (9 Nov 2026)

**Status:** implementasi hitungan, lookup, dan lock backend serta UI form/input telah dibuat; validasi terarah lulus. Belum selesai untuk penandaan final: UAT browser pada 375/768/1280 px belum dijalankan dan suite backend penuh belum diulang. Jangan anggap alur selesai produksi sebelum UAT dan seluruh jalur mutasi diuji.

**Pemeriksaan awal:** perubahan saldo dan movement tetap dipusatkan di `InventoryService`; alur retur pemasok membaca saldo langsung tetapi mengubahnya melalui service ini. POS/checkout, void penjualan, penerimaan GR, penerimaan barang pengganti, opening balance, adjustment, retur supplier, dan transfer memakai jalur guard inventory. `all` mencakup produk yang dibuat setelah sesi dimulai; cakupan `categories` hanya mengunci item sesi.

**Backend:**
- `OpnameLockService` mengunci sesi `in_progress` dan `pending_approval`, melepas lock untuk `cancelled`/`posted`, mengembalikan nama produk + nomor sesi tanpa jumlah stok, dan membatasi pengecualian `stock_adjustment` ke referensi opname aktif yang benar-benar mencakup produk.
- `InventoryService::withUnlockedProducts()` melakukan pre-check banyak produk sebelum callback transaksi berjalan. Tes memastikan batch yang mengandung produk terkunci ditolak sebelum satu pun mutasi.
- Tabel append-only `stock_opname_count_logs`; `OpnameCountService` menangani set/tambah/hapus, UUID idempoten, riwayat, lookup barcode/nama, dan snapshot stok tanpa mengubah saldo.
- Endpoint hitungan: `POST /api/stock-opname-sessions/{id}/counts` (item, summary, nodes), `POST /api/stock-opname-sessions/{id}/counts/{itemId}/clear`, `GET /api/stock-opname-sessions/{id}/lookup?q=&mode=auto|search`, `GET /api/stock-opname-sessions/{id}/counts?limit=10`. Penulisan/lookup/riwayat memerlukan `opname.count`; lock status `GET /api/stock-opname/lock-status` tersedia bagi semua pengguna login.
- `lookup` membedakan `not_in_session` dari `unknown_barcode`; jika produk bukan cakupan, pesannya menyebut produk baru dihitung di opname berikutnya. Blind mode tidak mengirim stok sistem atau selisih.

**UI:**
- `CountEntryForm`, `useOpnameCountMutation`, dan `OpnameWorkspaceContext` terhubung ke panel Input. Pemilihan dari pencarian, daftar kategori, maupun hitungan terakhir memuat form; setelah simpan progres/cache diperbarui, produk disorot, dan fokus kembali ke pemilih. Form mendukung set, tambah, ganti, clear dengan konfirmasi, riwayat 10 hitungan, penanganan retry idempoten, serta mode baca/izin.
- Pada HP panel memakai tinggi viewport dinamis, scroll ke field jumlah, tombol simpan sticky, dan tetap mempertahankan panel agar navigasi tidak membuang state. Ringkasan memberi tahu bahwa produk baru masuk pada opname berikutnya.
- POS menampilkan status lock berkala setiap 30 detik hanya saat tab terlihat. `ErrorNotice` memformat `stock_locked_by_opname` sebagai pesan yang menyebut nama produk dan nomor sesi, termasuk pada POS, penerimaan GR, retur supplier, opening balance, adjustment, dan transfer; alur mutation mempertahankan input saat ditolak.
- Langkah Mulai Opname kini meminta konfirmasi eksplisit sebelum tombol “Mulai dan tutup transaksi”.

**Pengukuran (test DB, 5.000 item, run terakhir):** start 1,143 s; tree 0,048 s; items/100 0,092 s; lookup 0,033 s (<150 ms); simpan hitungan 0,067 s (<200 ms); guard checkout untuk 20 produk 0,004 s, satu query sesi lock. Angka ini hanya indikasi lokal, bukan jaminan produksi.

**Validasi:** `OpnameSessionTest` 17/162 assertions; `OpnameCountTest` + `OpnameLockTest` 8/89 assertions; full suite `php artisan test`: 358/364 passed. Enam kegagalan yang tampak tidak terkait Handoff #4: dua assertion jumlah tenant di `PlatformStoreManagementTest`, fixture kedaluwarsa di `ReportTest`, `StockAuthorityTest` yang mengharapkan penerimaan kedua pada PO yang kini hanya boleh diterima sekali, assertion lama `SupplierReturnTest::test_supplier_return_acceptance_quarantines_items_and_receives_replacement` yang mengharapkan `data.status` tidak ada, dan test akses supplier Kasir. `SaleTest`, `StockAdjustmentTest`, dan `GoodsReceiptTest` lulus. Frontend `npm run build` dan `npm test` lulus (234 tests); build masih memberi peringatan chunk utama >500 kB. UAT manual untuk barcode, mode buta/terbuka, 375/768/1280 px, banner POS, serta penolakan API pada GR/retur/adjustment/transfer masih perlu dilakukan; backend test integrasi per layar tersebut juga belum lengkap.

### Adjustment & Opname — Handoff #5 (9 Nov 2026)

**Status:** implementasi endpoint `items` aditif dan rangkaian Input scanner-first tersedia di worktree. Test API opname terarah, frontend build, dan Vitest lulus. UAT browser pada 375/768/1280 px, uji scanner/perangkat, serta pembatalan sesi fixture belum dilakukan; jangan anggap alur selesai produksi sebelum UAT dan suite backend penuh hijau.

**Pemeriksaan awal dan asumsi yang berbeda:** proyek memakai React/Vite/TypeScript dan Vitest (belum ada harness DOM/browser test); layar mendeteksi sentuhan lewat `matchMedia('(pointer: coarse)')`, dan layout memakai `100dvh`. Getar (`navigator.vibrate`) dan Web Audio tersedia sebagai API opsional dan kegagalannya tidak memblokir hitungan. Perilaku Handoff #4—pemilihan produk, aksi eksplisit ganti/tambah/hapus, UUID `client_request_id`, retry atas hasil simpan tak pasti, serta penanganan lock—dipertahankan. Prasyarat dokumen bahwa #4 sudah di-merge dan suite penuh hijau ternyata belum terpenuhi; atas permintaan pengguna #5 tetap dikerjakan tanpa commit/merge, sehingga perubahan #4/#5 berada dalam worktree yang sama.

**Backend:** `GET /api/stock-opname-sessions/{id}/items` kini menambahkan `only_counted`, urutan `sort=-counted_at`, `exclude_item_ids[]` (maksimal 10), dan `counted_at`; urutan default lama tetap alfabetis. Filter tetap melalui kebijakan display sehingga mode blind tidak mengirim `system_qty`, `variance_count`, atau status `matched`/`variance`. Indeks `(session_id, counted_at)` ditambahkan. Test mencakup urutan dua hitungan terbaru, item clear, rekomendasi tanpa item yang dikecualikan, dan kompatibilitas urutan default.

**UI dan aturan:** `CountingStack` menggantikan panel form lama; `CountEntryForm` menangani prompt scan, pencarian manual, keypad sentuh, input angka read-only, konflik scan saat kuantitas sudah diisi, dan aksi koreksi dari #4. `useScannerCapture` menangkap keyboard di tingkat dokumen (40 ms antar-karakter, minimum 6 karakter, Enter/Tab, dedup 800 ms); `useScanFeedback` menyimpan preferensi suara/getar lokal. Dua hitungan terbaru ditampilkan dengan yang terbaru tepat di atas form; rekomendasi dua item belum dihitung di node kerja mengikuti urutan produk, mengecualikan item form, dan refresh setelah hitung. Node kerja memakai direct-product-first lalu DFS; tersedia kartu node selesai, tombol lanjut, tombol `Mulai` terpisah di Daftar, riwayat 10 hitungan, dan mode padat CSS untuk HP pendek. Blind mode menyembunyikan angka/status selisih pada kartu dan baris produk.

`OpnameWorkspaceContext` kini menyediakan `activeNodeId`, `setActiveNodeId`, `tree`, `selectedItem`, `setSelectedItem`, `loadItem`, `selectItem`, `startNode`, dan `workingNodeId`. `useScannerCapture` memberikan callback `onScan(code, { source: 'keyboard' })`. Scanner fisik harus dikonfigurasi untuk mengirim **Enter** di akhir barcode (Tab juga didukung). Untuk simulasi di build development gunakan `window.__simulateScan('8996000012345')`; helper tidak disertakan pada build produksi.

**Pengukuran dan validasi:** diagnostik terbaru pada 5.000 item: start 1,749 s; tree 0,054 s; items/100 0,127 s; lookup 0,060 s; count 0,109 s; query hitungan terbaru/2 0,109 s; rekomendasi/2 dengan item dikecualikan 0,125 s; guard 20 produk 0,024 s. Kedua query baru di bawah target sekitar 150 ms pada run ini; angka test DB lokal bukan jaminan produksi. `OpnameSessionTest` 17/166 assertions, `OpnameCountTest` 4/88 assertions, dan test benchmark tunggal 1/18 assertions lulus. `npm run build` dan `npm test` lulus (242 test, termasuk uji scanner dan resolusi node kerja; build tetap memberi peringatan chunk utama >500 kB). Suite backend penuh `php artisan test`: 359/365 lulus, enam gagal yang sama dengan baseline #4: dua assertion jumlah tenant `PlatformStoreManagementTest`, fixture kedaluwarsa `ReportTest`, ekspektasi penerimaan PO kedua pada `StockAuthorityTest`, assertion lama `SupplierReturnTest`, dan izin Kasir pada `SupplierTest`.

### Adjustment & Opname — Handoff #6 (9 Nov 2026)

**Status:** implementasi laporan beku, pengajuan/keputusan Owner, dan posting stok selesai. Test workflow opname terarah, suite backend penuh, build frontend, serta Vitest sudah dijalankan. UAT browser pada ukuran 375/768/1280 px dan cetak belum dilakukan; jangan posting stok produksi sebelum UAT.

**Backend dan kontrak:** `GET /api/stock-opname-sessions/{id}/report` mengembalikan laporan hanya setelah semua produk dihitung; laporan memuat metadata sesi, ringkasan total, hierarki kategori/node, baris selisih, revisi hitungan, dan alasan approval. Admin tidak menerima nilai rupiah atau ambang; Owner/Accounting dapat melihat nilai sesuai izin. `POST /api/stock-opname-sessions/{id}/submit` mengajukan sesi, `POST .../{id}/approve` mengonfirmasi sebagai Owner dan memposting, sedangkan `POST .../{id}/reject` memerlukan alasan dan mengembalikan sesi ke `in_progress`. `GET/PUT /api/settings/opname-approval` membaca/menyimpan ambang, dengan perubahan dibatasi ke Owner.

**Aturan dan komponen:** alur dapat langsung `in_progress` → `posted` jika tidak perlu approval atau diposting Owner; jika perlu persetujuan Admin mengajukan `in_progress` → `pending_approval` → `posted`. Penolakan mengembalikan sesi ke `in_progress`. Ambang bawaan adalah Rp25.000 per produk dan Rp200.000 per sesi; kedua perbandingan inklusif, nilai selisih dijumlahkan secara absolut, dan harga pokok kosong atau opname pertama memerlukan Owner. Konfigurasi berada di `OpnameApprovalSettingsService`; `OpnameReportBuilder` membuat laporan/snapshot; `OpnameApprovalEvaluator` memutuskan kebutuhan approval; `OpnameWorkflowService` mengatur audit, notifikasi, submit/approve/reject, dan posting. UI yang tersedia meliputi laporan pohon dan cetak, lembar konfirmasi Owner, alasan penolakan, status persetujuan di daftar sesi, serta pengaturan ambang di halaman Opname.

**Keputusan desain 5.2:** tidak dibuat baris `stock_adjustments` per produk. Posting membuat satu `stock_movement` per produk berselisih dengan `ref_type=stock_opname` dan ID sesi; stok bertambah/berkurang melalui `InventoryService`, sedangkan produk tanpa selisih tidak berubah. Dampaknya, riwayat/rekonsiliasi opname harus membaca movement dan snapshot laporan, bukan tabel adjustment; hasil opname tidak mengubah HPP master.

**Pemeriksaan awal dan perbedaan asumsi:** pemeriksaan menemukan pengecualian lock sebelumnya hanya mengenali `stock_adjustment`; lock sekarang juga mengenali sesi opname aktif tanpa membuka bypass umum. Sumber HPP yang benar adalah `products.unit_cost`. Selisih stok positif tetap memerlukan perhatian untuk produk `track_expiry`, karena data hitungan tidak mencakup tanggal kedaluwarsa lot. Selain itu, mode autentikasi ulang berbasis key belum diselaraskan dengan form UI yang saat ini hanya mengirim `owner_password`; verifikasi ini perlu sebelum mode key dipakai. Performa khusus laporan 5.000 item dan posting 300 selisih belum diukur.

**Validasi:** `OpnameWorkflowTest` lulus 11 test/125 assertions; `php artisan test` menghasilkan 370 lulus dan 6 gagal. Keenam kegagalan (`PlatformStoreManagementTest` dua assertion, `ReportTest`, `StockAuthorityTest`, `SupplierReturnTest`, dan `SupplierTest`) sama dengan baseline sebelum Handoff #6, bukan regresi perubahan ini. `npm run build` dan `npm test` lulus (242 Vitest); build tetap memberi peringatan ukuran chunk utama >500 kB. Perubahan #5 dan #6 tetap di worktree dan belum di-commit.

### Adjustment & Opname — Handoff #7 (10 Nov 2026)

**Status:** implementasi backend/frontend dan validasi otomatis terarah selesai; masih 🟡 karena UAT HP/scanner nyata, pengujian jaringan dua-tab, ukuran sesi maksimum, dan benchmark performa belum dilakukan. Jangan menyatakan kriteria perangkat nyata pada Handoff #7 lulus sebelum UAT.

**Backend dan kontrak:** `POST /api/stock-opname-sessions/{id}/counts/batch` menerima 1–100 operasi hitung/hapus secara berurutan; hasil per operasi berstatus `ok`, `duplicate`, atau `rejected`, sehingga satu operasi yang ditolak tidak menghilangkan hasil operasi lain. `GET /api/stock-opname-sessions/{id}/offline-index?page=...&per_page=...` menyediakan indeks halaman untuk sesi `in_progress`, memakai ETag dan `304 Not Modified`. Indeks hanya berisi identitas produk/kategori serta hitungan petugas, tanpa stok sistem, selisih, atau status cocok/selisih. Log hitungan menyimpan `client_created_at` dan `via_batch`; lookup barcode tidak peka huruf besar-kecil. Test backend menggunakan barcode alfanumerik `ABC-123`.

**Frontend dan perilaku:** `useScannerCapture` mendukung ambang lokal per perangkat, diagnosa burst/akhiran scan, kalibrasi, dan pemulihan fokus; `ScannerTestSheet` menguji scanner dan meminta izin penyimpanan persisten, sedangkan `useScreenWakeLock` menjaga layar tetap aktif saat sesi menghitung. `CountSyncQueue` dan `useOpnameOffline` menyimpan operasi di IndexedDB per pengguna/sesi, mengirim batch FIFO dengan backoff, menerapkan hasil duplikat/penolakan, dan menahan operasi berikutnya di belakang operasi gagal sampai petugas mencoba ulang atau menghapusnya secara eksplisit. Indeks offline dipaginasi dan memakai ETag. Posting mensyaratkan koneksi serta antrean tanpa operasi menunggu/gagal. Navigasi dan penutupan tab memberi peringatan; logout menawarkan sinkronisasi semua antrean pengguna, mempertahankan data bila masih tersisa, dan menghapus indeks lokal hanya jika antrean pengguna kosong.

**Batasan dan hasil pemeriksaan awal:** tidak memakai service worker/PWA; halaman yang dimuat ulang ketika offline tidak didukung. Konflik antarperangkat tetap mengikuti urutan operasi tiba di server. Test menemukan kebutuhan barcode campuran huruf/angka; belum diketahui ukuran sesi terbesar yang realistis. Tidak ada akses HP/scanner nyata dalam sesi ini, sehingga model perangkat dan hasil pairing/scan belum tersedia. Belum ada benchmark indeks/sinkronisasi pada sesi besar atau uji mode pesawat/reload online/dua tab.

**Dokumentasi dan validasi:** panduan operator tersedia di `docs/PANDUAN_SCANNER_BLUETOOTH.md`. `php artisan test --filter=OpnameCountTest` lulus 7 test/128 assertions; `npm test` lulus 252 test pada 38 file; `npm run build` lulus dengan peringatan chunk utama 513.73 kB (>500 kB). Test frontend baru mencakup FIFO/pemblokiran di antrean, deduplikasi, isolasi pengguna, lease, hasil batch, backoff, konfigurasi jeda scanner 10/70 ms, serta burst tanpa akhiran; UAT tetap diperlukan untuk perilaku browser/perangkat.

### Adjustment & Opname — Handoff #8 (10 Nov 2026)

**Status:** implementasi backend/frontend riwayat periode, filter, produk sering berselisih, status terakhir, pengingat, dan CSV tersedia di worktree. Status keseluruhan **🟡**: UAT browser/staging, uji performa skala 60 sesi/5.000 item, dan matriks seluruh endpoint/role belum selesai. Handoff #7 masih berstatus 🟡 untuk UAT perangkat nyata; perubahan tahap sebelumnya belum di-commit/merge atas keputusan pengguna untuk tetap melanjutkan.

**Pemeriksaan awal:** database menyimpan timestamp sebagai UTC; toko menyimpan `timezone` (default `Asia/Jakarta`), dan perhitungan tanggal riwayat memakai zona toko. Tidak ditemukan pustaka CSV yang perlu dipakai; CSV dibuat dengan `fputcsv`, UTF-8 BOM, delimiter pilihan koma/titik koma, dan netralisasi formula. `AuditLogger` tersedia dan mencatat ekspor/perubahan pengingat. Endpoint lama/izin opname dicatat dalam Ikhtisar. Pemeriksaan referensi menemukan `stock_adjustments.source`, `opname_session_id`, serta alasan `opname_result` masih dipakai oleh service, lock, respons, migrasi, atau test; tidak ada kolom yang dihapus.

**Backend:** ditambah `GET /api/stock-opname-sessions/periods`, perluasan filter daftar (`period`, `result`, `scope_type`, rentang tanggal), `GET .../frequent-variance`, `GET /api/stock-opname/last-status`, ekspor sesi/periode CSV, serta pengaturan `opname.reminder.enabled` (default mati), `opname.reminder.interval_days` (default 30), dan `opname.reminder.basis` (default `all`). Periode menggunakan posted_at bagi sesi `posted` dan started_at bagi status lain; agregat hanya memasukkan `posted`. Nilai dan kolom Nilai CSV dihilangkan server kecuali role punya `opname.view_value`. Ekspor diaudit dan sesi selain `posted`/`pending_approval` memperoleh 409.

**Frontend:** tab Opname memiliki pilihan Bulan/Kuartal/Tahun/Semua yang disimpan lokal, tren batang aksesibel, filter, sesi periode yang dimuat saat dibuka, produk sering berselisih, indikator opname terakhir, banner pengingat, dan unduh rekap. Laporan memiliki unduh CSV ringkasan/detail dan pilihan pemisah lokal; cetak peramban yang sudah ada dipertahankan. Pengaturan pengingat ditambahkan pada halaman Pengaturan Opname.

**Validasi:** `php artisan test tests/Feature/OpnameHistoryTest.php` lulus 8 test/81 assertions; `OpnameCountTest` lulus 7 test/128 assertions. Test baru meliputi batas WIB Oktober/November, sesi non-posted, ranking/snapshot produk, nilai berdasarkan izin, CSV BOM/delimiter/formula injection termasuk kategori bersih, 409 sesi berjalan, pengingat/audit, blind metadata/offline-index, guard simulasi produksi, serta akses login/izin pada endpoint riwayat/ekspor. Pint lulus; `npm run typecheck`, `npm test` (252 test/38 file), dan `npm run build` lulus. Production build tidak memuat `window.__simulateScan`; simulator menolak `APP_ENV=production`. Full `php artisan test`: 381/387 test lulus (3.795 assertions); enam kegagalan sama dengan baseline sebelum Handoff #8: dua assertion di `PlatformStoreManagementTest`, fixture kedaluwarsa `ReportTest`, aturan penerimaan kedua di `StockAuthorityTest`, assertion lama `SupplierReturnTest`, dan izin Kasir di `SupplierTest`. Tidak ada kegagalan test opname. Build masih memperingatkan chunk utama 514.20 kB (>500 kB). Benchmark riwayat/ekspor pada fixture 60 sesi/5.000 item, siklus end-to-end lintas fitur, migrasi DB bersih dan berisi data, serta browser UAT 375/768/1280 px belum dijalankan; jangan menandai seri selesai/produksi sebelum verifikasi tersebut.

**Batasan dan tindak lanjut:** Handoff #7 full-suite benchmark yang turut berjalan pada validasi ini mencatat start 1.683 s, tree 0.050 s, items/100 0.140 s, lookup 0.053 s, count 0.096 s, hitungan terbaru/2 0.096 s, rekomendasi/2 0.125 s, dan guard 20 produk 0.005 s; metrik ini bukan benchmark endpoint Handoff #8. UAT staging dua perangkat/scanner belum dilakukan. Rekomendasi 5.8: pertahankan kolom/reason yang masih dipakai; bila ingin dihapus, lakukan audit consumer+data dan migrasi terpisah setelah persetujuan pengguna. Panduan operator ditambahkan di `docs/PANDUAN_OPNAME.md`.

**Terbaru (28 Okt 2026): backend suite lulus 238 test; UI Dashboard dan Tagihan HRD telah dikonfirmasi pengguna, Manajemen Pengguna dan Transfer Stok siap diuji.** UI kas nonpenjualan, Draft setoran parsial, dan Riwayat Penjualan juga sudah diuji pengguna. `/goods-receipts` mendukung lokasi gudang backend 4.4 dan lampiran dokumen backend 4.5; UI pemilih lokasi/putaway belum dibuat, sementara unggah/unduh lampiran tersedia dan menunggu uji klik. Penerimaan, UI PR/PO dan Adjustment/Opname menunggu uji klik. Akses Finance receive-only pada antrean setoran lulus test backend; UAT UI Finance masih belum dikonfirmasi. Kontrak adjustment ada di `BACKEND_PROGRESS.md` bagian 1.

| Modul | Bagian `BACKEND_PROGRESS.md` | Status backend | Folder UI terlihat di zip terakhir |
|---|---|---|---|
| Auth, kategori, supplier, produk | HANDOFF bagian 6 | ✅ | auth, categories, suppliers, products |
| Inventory (stok awal, stok per batch, pergerakan) | 1 | ✅ | inventory |
| Adjustment & Opname | Handoff #2 | ✅ backend / ✅ UI fondasi | `inventory/AdjustmentsPage.tsx`, daftar dan detail sesi Opname; UAT browser menunggu |
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
