# Peta Jalan & Progres — POS Retail SMK

**Diperbarui:** 24 Oktober 2026 · **Berkas ini = pedoman progres proyek.** Untuk kontrak endpoint dan layar yang bisa dibuatkan UI, rujukannya `BACKEND_PROGRESS.md`; untuk aturan kerja dan arsitektur, `HANDOFF_POS_RETAIL_SMK.md`.

| Tanda | Arti |
|---|---|
| ✅ | Selesai **dan** `php artisan test` sudah dijalankan pengguna dengan hasil hijau |
| 🟡 | Kode + test sudah ditulis, **belum dijalankan** (agent tidak punya PHP). Boleh dibuatkan UI terhadap kontraknya, tetapi respons nyata bisa sedikit berbeda sampai test hijau |
| ⏳ | Belum dikerjakan |
| ⏸ | Ditunda: menunggu klien atau di luar cakupan 1 bulan (Paket 2/3) |

---

## 1. Posisi saat ini

**Backend Paket 1 (Fase 0–6; tidak termasuk hardening/UAT/go-live dan Paket 2/3): 34 tahap — 9 ✅ selesai · 10 🟡 kode selesai, menunggu test · 15 ⏳ belum.**

| Fase | ✅ | 🟡 | ⏳ | ⏸ |
|---|---|---|---|---|
| Fase 0 — Analisis & desain | 2 | 0 | 0 | 0 |
| Fase 1 — Fondasi backend (tahap 1a–1c) | 7 | 0 | 0 | 0 |
| Fase 2 — Inventory & karyawan | 0 | 4 | 3 | 0 |
| Fase 3 — POS & kas | 0 | 3 | 4 | 1 |
| Fase 4 — Pembelian | 0 | 3 | 2 | 0 |
| Fase 5 — Tagihan HRD | 0 | 0 | 3 | 0 |
| Fase 6 — Cetak, laporan, dashboard | 0 | 0 | 3 | 0 |
| Fase 7 — Hardening & UAT | 0 | 0 | 5 | 0 |
| Fase 8 — Cut-over & go-live | 0 | 0 | 3 | 1 |
| Di luar Paket 1 (setelah go-live) | 0 | 0 | 0 | 2 |
| **Total semua fase** | **9** | **10** | **23** | **4** |

### Aplikasi sekarang sudah bisa apa (menurut kode; yang bertanda 🟡 menunggu test hijau)

- **Masuk dan hak akses:** login/logout, role Admin dan Kasir, izin yang bisa didelegasikan, persetujuan dengan mengetik ulang password pemberi persetujuan. ✅
- **Master data:** kategori, supplier, produk (harga + riwayat harga, barcode otomatis, status stok). ✅
- **Stok:** Admin memasukkan stok awal; stok dilihat per batch dengan urutan FEFO dan lencana kedaluwarsa; riwayat pergerakan stok. 🟡
- **Karyawan:** Kasir menambah karyawan (menunggu verifikasi, hanya tunai), Admin memverifikasi dan menetapkan batas kredit, notifikasi ke Admin. 🟡
- **Kasir:** buka shift (hitung buta), jual tunai atau kredit potong gaji (FEFO, diskon, PPN opsional, batas kredit + pengecualian Admin dengan re-auth, anti transaksi ganda), cetak ulang berlabel SALINAN, tutup shift dengan selisih kas, tinjau oleh Admin. 🟡
- **Pembelian:** PR → pemeriksaan Finance → persetujuan Owner → PO → kirim → penerimaan barang (stok bertambah, HPP rata-rata), verifikasi surat jalan/faktur. 🟡 (paket kode baru; baru bisa dipakai setelah dipasang)

### Belum bisa

Void/pembatalan penjualan · setoran dan endapan resmi (saat tutup shift, seluruh kas sementara menjadi endapan) · kas masuk/keluar lain · atur diskon dan PPN lewat layar · transfer, adjustment, opname · denah rak · penerimaan ke gudang · tagihan HRD dan invoice · cetak struk/invoice · dashboard dan laporan · lampiran foto surat jalan.

### Langkah berikutnya (urut)

1. **Pasang paket WS-C dan jalankan `php artisan test`** (seluruh suite). Laporkan yang gagal; ubah status 🟡 → ✅ di berkas ini untuk yang hijau. Ini membuka semua kontrak untuk dipercaya frontend.
2. **Void + setoran/endapan** (tahap 3.4–3.5): tanpa ini shift hanya bisa ditutup "sementara" dan koreksi transaksi belum mungkin.
3. **Tagihan HRD** (Fase 5): tujuan akhir sistem kredit karyawan; bergantung pada penjualan kredit yang sudah ada.
4. Kas masuk/keluar lain (3.6) dan pengaturan diskon/PPN lewat layar (3.7).
5. Adjustment/opname + transfer (2.6–2.7), lalu cetak, dashboard, hardening, UAT (Fase 6–8).

**Jika jadwal mundur, potong dalam urutan ini** (dari `HANDOFF` bagian 7): denah rak visual (pakai daftar) → UI adjustment/opname → transfer antar-rak → UI langkah pemeriksaan Finance (jadikan satu tombol Admin) → dashboard. **Jangan dipotong:** posting penjualan atomik, aturan kredit/batas, FEFO, shift + endapan, invoice HRD.

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

### Fase 2 — Inventory & karyawan

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 2.1 | `InventoryService`: saldo, pergerakan (append-only), batch, FEFO, anti-stok-negatif, HPP rata-rata bergerak | 🟡 | InventoryServiceTest |
| 2.2 | Stok awal (Admin), lihat stok per batch, riwayat pergerakan | 🟡 | OpeningBalanceTest |
| 2.3 | Data karyawan: input Kasir, verifikasi + batas kredit Admin, riwayat batas | 🟡 | CustomerTest |
| 2.4 | Notifikasi (`customer.limit_needed`, daftar, tandai baca) | 🟡 | NotificationTest |
| 2.5 | Denah rak (CRUD rak dan posisi) — prioritas terendah, daftar sudah cukup untuk MVP | ⏳ |  |
| 2.6 | Transfer antar posisi / kelompok stok (putaway) | ⏳ |  |
| 2.7 | Adjustment dan opname dengan persetujuan (re-auth) | ⏳ |  |

### Fase 3 — POS & kas

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 3.1 | Shift kasir: buka, hitung buta, tutup, tinjau; saldo awal = endapan sebelumnya | 🟡 | ShiftTest |
| 3.2 | Posting penjualan atomik: tunai + kredit potong gaji, FEFO, diskon, PPN opsional, batas kredit + pengecualian Admin, idempotensi | 🟡 | SaleTest |
| 3.3 | Riwayat penjualan dan cetak ulang berlabel SALINAN | 🟡 | SaleTest |
| 3.4 | Void / pembatalan penjualan (endpoint + aturan; `InventoryService::voidSale` sudah ada) | ⏳ |  |
| 3.5 | Setoran dan endapan (parsial / final), kebijakan endapan | ⏳ |  |
| 3.6 | Kas masuk / keluar lain (`cash_movements`) | ⏳ |  |
| 3.7 | Pengaturan diskon dan PPN lewat API/UI (saat ini diisi langsung ke tabel `discounts` / `settings`) | ⏳ |  |
| 3.8 | Retur pelanggan dan credit note | ⏸ | Paket 2 |

### Fase 4 — Pembelian

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 4.1 | PR: draft, ajukan, pemeriksaan Finance, persetujuan Owner (re-auth, tanda swa-persetujuan) | 🟡 | PurchaseRequisitionTest |
| 4.2 | PO: dari PR, otomatis/konfirmasi Owner, kirim, batal, tutup | 🟡 | PurchaseOrderTest |
| 4.3 | Penerimaan barang: posting menambah stok, selisih/rusak, verifikasi surat jalan + faktur | 🟡 | GoodsReceiptTest |
| 4.4 | Penerimaan ke gudang + putaway (saat ini `warehouse_enabled` aktif ditolak) | ⏳ |  |
| 4.5 | Lampiran dokumen (foto surat jalan) — tabel `attachments` sudah ada | ⏳ |  |

### Fase 5 — Tagihan HRD

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 5.1 | Periode tagihan: buka / tutup periode | ⏳ |  |
| 5.2 | Invoice gabungan ke HRD + rincian per karyawan (PPN kredit dihitung saat invoice) | ⏳ |  |
| 5.3 | Catat pembayaran HRD (potong gaji) | ⏳ |  |

### Fase 6 — Cetak, laporan, dashboard

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 6.1 | Struk thermal 58/80 mm (CSS print browser; data struk sudah dari API) | ⏳ | frontend |
| 6.2 | Cetak invoice HRD | ⏳ | frontend + 5.2 |
| 6.3 | Dashboard minimal dan laporan dasar (penjualan harian, stok menipis/kedaluwarsa, ringkasan kas) | ⏳ |  |

### Fase 7 — Hardening & UAT

| # | Tahap | Status | Test / catatan |
|---|---|---|---|
| 7.1 | Seluruh `php artisan test` hijau (semua tahap 🟡 di atas menjadi ✅) | ⏳ | tugas pengguna |
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

| Suite | Status | Dikonfirmasi oleh |
|---|---|---|
| SeederTest, AuthTest, RbacTest, ReauthServiceTest, CategoryTest, SupplierTest, ProductTest, NumberSequenceTest, DecimalTest, Ean13Test, StockStatusTest | ✅ | pengguna (tahap 1c) |
| InventoryServiceTest, OpeningBalanceTest, CustomerTest, NotificationTest | 🟡 | belum ada konfirmasi |
| ShiftTest, SaleTest | 🟡 | belum ada konfirmasi |
| PurchaseRequisitionTest, PurchaseOrderTest, GoodsReceiptTest (+ `tests/Concerns/BuildsPurchasing.php`) | 🟡 | baru ditulis |

Perintah: `php artisan test` (semua) atau `php artisan test --filter=GoodsReceiptTest` (satu kelas). Test memakai database `pos_retail_test`; `tests/TestCase.php` menolak berjalan di database yang namanya tidak berakhiran `_test`. Kegagalan paling mungkin: salah ketik nama kolom atau perbedaan format respons kecil — kirim keluaran lengkapnya ke agent yang menulis kodenya.

---

## 4. Untuk agent frontend

**Terbaru (24 Okt 2026): backend menyelesaikan WS-C — Pembelian (PR → PO → Penerimaan barang).** Kontrak lengkap: `BACKEND_PROGRESS.md` bagian 6 (endpoint, bentuk permintaan/respons, kunci error, notifikasi baru, urutan layar).

| Modul | Bagian `BACKEND_PROGRESS.md` | Status backend | Folder UI terlihat di zip terakhir |
|---|---|---|---|
| Auth, kategori, supplier, produk | HANDOFF bagian 6 | ✅ | auth, categories, suppliers, products |
| Inventory (stok awal, stok per batch, pergerakan) | 1 | 🟡 | inventory |
| Karyawan + batas kredit | 2 | 🟡 | customers |
| Notifikasi | 3 | 🟡 | notifications |
| Shift kasir | 4 | 🟡 | shifts |
| Penjualan (POS) | 5 | 🟡 | belum ada folder |
| **Pembelian (PR, PO, penerimaan)** | **6** | 🟡 | belum ada folder |

Folder UI dibaca dari struktur `frontend/src/features/` pada zip; **isi layarnya belum saya tinjau**.

**Pesan siap salin untuk agent frontend:**

> Backend baru menyelesaikan **Pembelian** (PR → PO → penerimaan barang). Baca `docs/BACKEND_PROGRESS.md` bagian 6. Layar yang sekarang bisa dibuat, urut prioritas: (1) penerimaan barang oleh Kasir (`GET /api/purchase-orders?receivable=1` → `POST /api/goods-receipts` dengan `post: true`), (2) daftar/form PR untuk Kasir, (3) antrean pemeriksaan Finance dan dialog persetujuan Owner (input username + password; salah → 422 `approver_password`), (4) PO untuk Admin, (5) verifikasi dokumen penerimaan. Catatan: Kasir tidak menerima harga beli (`unit_price`, `unit_cost`, `total` = `null`); `qty_damaged` hanya dicatat, tidak menambah stok; mode gudang belum didukung. Status backend 🟡 (belum dijalankan) — jangan menganggap bentuk respons final sebelum berkas ini menandai ✅. **Layar kasir (penjualan, bagian 5) masih menjadi prioritas utama** bila belum dibuat.

---

## 5. Cara memperbarui berkas ini

1. Setiap tahap selesai ditulis: ubah statusnya ke 🟡, tambahkan baris di `BACKEND_PROGRESS.md` (Riwayat + kontrak), dan perbarui angka di bagian 1.
2. Setelah pengguna menjalankan `php artisan test` dan hijau: ubah 🟡 → ✅ (tahap dan baris suite di bagian 3).
3. Keputusan klien yang masuk (R-04, Q-xx): catat di `HANDOFF` bagian 9 dan hapus dari daftar tahap 7.3 bila selesai.
4. Jangan menandai ✅ sebelum test dijalankan (aturan kerja `HANDOFF` bagian 8 butir 5).
