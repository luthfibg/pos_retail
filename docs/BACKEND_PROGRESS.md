# Progres Backend → untuk Agent Frontend

**Satu-satunya berkas progres backend.** Setiap pekerjaan backend baru ditambahkan di sini (entri terbaru di atas bagian "Riwayat"), agar agent frontend tahu fitur mana yang sudah bisa dibuatkan UI-nya. Agent baru cukup membaca berkas ini + `HANDOFF_POS_RETAIL_SMK.md`.

****Diperbarui:** 10 November 2026 · Handoff #7: endpoint batch hitungan dan indeks offline; `OpnameCountTest` 7/128 lulus. Handoff #8: riwayat, ekspor, pengingat, dan filter tersedia; kontrak dan batas validasi ada di `docs/ROADMAP_PROGRESS.md`, status suite penuh dan UAT masih terbuka. · **Dikerjakan:** WS-B (Inventory inti, transfer, adjustment/opname, retur supplier/write-off), WS-A (Data karyawan + notifikasi), WS-D (Shift + Penjualan + kas nonpenjualan), WS-C (Pembelian + lampiran penerimaan), WS-F (Diskon dan PPN), WS-G (Manajemen Pengguna), Management Retail

Progres implementasi Adjustment langsung Handoff #1: lihat `docs/ROADMAP_PROGRESS.md`, bagian 4 “Adjustment & Opname — Handoff #1”.
Sesi opname Handoff #2 (skema, service, endpoint, izin, test, dan kontrak UI): lihat `docs/ROADMAP_PROGRESS.md`, bagian 4 “Adjustment & Opname — Handoff #2”.
Peta progres opname, kebijakan hitung buta, pengaturan, dan kontrak UI Handoff #3: lihat `docs/ROADMAP_PROGRESS.md`, bagian 4 “Adjustment & Opname — Handoff #3”.
Input hitungan, log, lookup, dan penguncian stok Handoff #4: lihat `docs/ROADMAP_PROGRESS.md`, bagian 4 “Adjustment & Opname — Handoff #4” (UAT dan test suite penuh masih terbuka).
Perluasan daftar item untuk rangkaian scan Handoff #5 (`only_counted`, urutan `-counted_at`, `exclude_item_ids[]`, dan `counted_at`): lihat `docs/ROADMAP_PROGRESS.md`, bagian 4 “Adjustment & Opname — Handoff #5”.
Laporan beku, persetujuan Owner, posting melalui inventory movements, dan pengaturan ambang Handoff #6: lihat `docs/ROADMAP_PROGRESS.md`, bagian 4 “Adjustment & Opname — Handoff #6” (UAT browser dan validasi performa laporan/posting masih terbuka).
Batch hitungan, indeks offline, antrean sinkronisasi dan scanner Bluetooth Handoff #7: lihat `docs/ROADMAP_PROGRESS.md`, bagian 4 “Adjustment & Opname — Handoff #7” (UAT perangkat nyata masih terbuka).
Laporan Piutang Tahunan: `GET /api/annual-receivable-reports[/{year}]` dan `GET/PUT /api/settings/annual-receivable-report`; laporan live untuk tahun berjalan, tagihan mengikuti periode billing, pembayaran mengikuti batas laporan (31 Desember untuk tahun terdahulu), dan cetak diaktifkan sesuai pengaturan tanggal. Validasi terarah: 3 test tahunan dan seluruh `BillingTest` (17 test) lulus; Pint lulus. UAT browser masih terbuka.

> **Untuk layar kasir (POS):** baca bagian 4 (Shift) dan 5 (Penjualan) dulu. Urutan alur kasir: `GET /api/shifts/current` → (bila `data` null) `POST /api/shifts/open` → cari produk (`GET /api/products/by-barcode/...`) → `POST /api/sales`.

## Cara membaca status

| Tanda | Arti |
|---|---|
| ✅ Lolos | Test untuk fitur terkait sudah dijalankan dan hijau; status suite penuh terbaru dirangkum di header |
| 🟡 Belum dijalankan | Kode + test sudah ditulis, **belum** dijalankan (agent tidak punya PHP). Boleh dibuatkan UI terhadap kontrak ini, tapi respons nyata bisa sedikit berbeda sampai test hijau |
| ⏳ Belum | Belum dikerjakan |

## Konvensi singkat (berlaku semua endpoint)

- Header wajib `Accept: application/json`; autentikasi `Authorization: Bearer <token>`.
- Sukses `{ "data": ... }`; daftar berpaginasi memakai bentuk Laravel (`data`, `current_page`, `last_page`, `per_page`, `total`, `links`).
- Validasi gagal → 422 `{ "message", "errors": { "field": ["pesan"] } }`; tanpa izin → 403 `{ "message" }`; tidak ada → 404.
- **Uang dan qty = string desimal** (`"3500.00"`, `"12.500"`). Jangan `Number`. Qty maksimal 3 desimal; uang 2 desimal (HPP 4).
- Waktu = UTC (`"2026-10-23 03:15:00.123"`), tampilkan WIB. Tanggal kadaluarsa = tanggal murni `YYYY-MM-DD` (WIB).
- Izin di UI hanya menyembunyikan menu/tombol; backend tetap menolak (tangani 403/422).

---

## Management Retail (operator platform)

API ini khusus operator sistem, terpisah dari RBAC toko. Admin toko tidak otomatis mendapat akses. Operator platform dibuat lewat CLI setelah migration dan seeder dijalankan:

```sh
php artisan platform:operator-create <username> "<nama>"
```

Password dimasukkan dan dikonfirmasi secara interaktif (minimal 12 karakter), tidak sebagai argumen. Akun disimpan terpisah pada `platform_operators`; operator tidak perlu ditugaskan ke toko. Login tetap memakai `/api/auth/login` dan respons menyertakan `platform_operator`. `/api/auth/me` operator tanpa penugasan toko mengembalikan `store: null`, `roles: []`, dan `permissions: []`. Lindungi kredensial operator seperti akses administratif tingkat sistem.

Semua endpoint berikut memerlukan `auth:sanctum` dan status operator platform aktif:

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/platform/stores` | Daftar tenant; filter opsional `q`, `status=active|inactive`, `per_page` (1–100, default 25) |
| POST | `/api/platform/stores` | Buat tenant serta akun Admin awal secara atomik |
| GET | `/api/platform/stores/{id}` | Detail tenant, daftar `admin_users`, dan `user_count` |
| PATCH | `/api/platform/stores/{id}/status` | Aktifkan/nonaktifkan tenant tanpa menghapus datanya |

Contoh onboarding:
```json
{
  "code": "CLIENT-01",
  "name": "Toko Klien",
  "timezone": "Asia/Jakarta",
  "currency": "IDR",
  "owner": {
    "name": "Pemilik Toko",
    "username": "pemilik",
    "email": "pemilik@example.com",
    "password": "minimal-12-karakter"
  }
}
```

`timezone` dan `currency` opsional (default `Asia/Jakarta` dan `IDR`); email owner opsional. Username dan kode tenant unik. Provisioning membuat toko aktif, akun owner dengan role `Admin`, lokasi toko dan gudang (gudang nonaktif), register, akun dana, serta setting default termasuk `warehouse_enabled=false`. Respons onboarding mengembalikan `initial_owner` untuk ditampilkan sekali saat setup; jangan menyimpan atau mencatat password di log/UI.

Ubah status dengan `{ "is_active": false, "reason": "..." }`. Tenant nonaktif tidak dapat dipilih sebagai konteks toko dan permintaan pengguna toko akan ditolak, tetapi akun maupun data tenant tetap utuh. Perubahan status dan onboarding dicatat dalam audit log. Operator platform mengelola tenant lewat prefix API ini; endpoint toko tetap memakai authorization toko biasa.

Frontend mengarahkan operator yang berhasil login ke layar `/platform/stores`. Pemulihan username/password operator tidak mempunyai endpoint publik: pada login gagal, UI menawarkan instruksi untuk menghubungi administrator server dan menjalankan `php artisan platform:operator-credentials-reset`. Command menampilkan operator aktif untuk dipilih berdasarkan ID, menetapkan username/password baru, mencabut semua token operator, dan mencatat audit tanpa menyimpan password.

Login langsung dari CLI tersedia melalui `php artisan platform:operator-login`: command meminta username/password tersembunyi, memverifikasi operator aktif, lalu membuka `PLATFORM_UI_URL/platform/cli-login`. Handoff memakai tiket acak sekali pakai (hash disimpan di database, berlaku 5 menit) dan endpoint `POST /api/platform/cli-login/exchange` yang ber-rate-limit; frontend menukar tiket dan mengarahkan browser ke `/platform/stores`. Lookup tiket secara eksplisit memakai PDO writer agar tidak terkena lag replica. Jika exchange gagal, login page menampilkan status HTTP/pesan API atau petunjuk koneksi, tanpa membocorkan tiket. Atur `PLATFORM_UI_URL` pada environment backend sesuai origin frontend (default `http://localhost:5173`). Jangan gunakan tiket handoff sebagai alur login umum.

Troubleshooting exchange 401: backend menulis `Platform CLI login ticket issued.` lalu `Platform CLI login ticket exchange rejected.` ke Laravel log. Entri mencatat fingerprint hash pendek (bukan tiket), `reason` (`ticket_not_found_or_already_used`, `ticket_expired`, `user_inactive_or_missing`, atau `operator_inactive`), user ID bila tiket ditemukan, waktu kedaluwarsa, host request, serta connection/host/port/nama database; tiket/password tidak dicatat. Cocokkan fingerprint dan konfigurasi DB kedua entri. Jika fingerprint berbeda, UI mengirim tiket lain; jika fingerprint sama tetapi alasan tidak ditemukan, proses CLI dan web tidak berbagi tabel/database atau tiket sudah dipakai.

## 1. Inventory ✅

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/inventory/products/{product}/stock` | `inventory.view` | Stok satu produk per batch/posisi + total |
| GET | `/api/inventory/expiry-monitoring` | `inventory.view` | Jumlah batch layak jual yang kedaluwarsa/akan kedaluwarsa; `product_ids[]` opsional untuk status per produk |
| GET | `/api/inventory/movements` | `inventory.view` | Riwayat pergerakan stok (terbaru dulu) |
| POST | `/api/inventory/opening-balances` | `inventory.adjust.approve` (Admin) | **Stok eksisting toko** (satu dokumen, banyak baris, atomik) |
| GET | `/api/inventory/transfers` | `stock_transfer.create` | Daftar/filter dokumen transfer |
| POST | `/api/inventory/transfers` | `stock_transfer.create` | Buat draft transfer stok |
| GET | `/api/inventory/transfers/{id}` | `stock_transfer.create` | Detail draft/posted/cancelled |
| POST | `/api/inventory/transfers/{id}/post` | `stock_transfer.create` | Posting atomik dan memindahkan saldo |
| POST | `/api/inventory/transfers/{id}/cancel` | `stock_transfer.create` | Batalkan draft (opsional `reason`) |
| GET | `/api/inventory/adjustments/meta` | Admin, Owner, Kasir | Metadata jenis dan alasan adjustment langsung |
| GET | `/api/inventory/adjustments` | Admin, Owner, Kasir | Daftar adjustment langsung yang sudah mengubah stok |
| POST | `/api/inventory/adjustments` | Admin, Owner, Kasir | Catat adjustment langsung dan posting stok secara atomik |
| GET | `/api/inventory/adjustments/{id}` | Admin, Owner, Kasir | Detail dokumen adjustment |

Daftar produk (`GET /api/products`) sudah memuat `stock_sellable` dan `stock_status`; angka itu kini terisi dari saldo nyata.

Master produk menyimpan satu nilai biaya kanonis, `unit_cost` (`DECIMAL(18,4)`; label UI **Harga Modal**). Field ini wajib bernilai lebih dari nol saat `POST /api/products`, dapat dikoreksi melalui `PATCH /api/products/{id}` oleh pemegang `price.change`, serta dikembalikan pada detail/daftar produk. Saat stok masuk dengan biaya, `unit_cost` diganti dengan biaya terbaru; perubahan manual dan otomatis dicatat pada audit produk. Nilai ini dipakai untuk snapshot HPP penjualan dan estimasi harga PR.

Produk dapat ditautkan ke satu atau lebih supplier melalui pivot `product_suppliers`. `POST /api/products` mewajibkan `supplier_ids` berisi minimal satu supplier aktif pada toko yang sama; `PATCH /api/products/{id}` menerima field tersebut untuk mengganti relasi. Daftar/detail produk mengembalikan `suppliers[]` (`id, code, name, is_active, default_payment_terms`). Produk lama tanpa relasi tetap perlu dilengkapi lewat edit master produk. PR otomatis tetap mengikuti pemantauan stok untuk produk lama yang belum ditautkan, tetapi item tersebut belum dapat dimasukkan ke PO sampai memiliki supplier aktif.

### POST `/api/inventory/opening-balances` — layar "Stok Eksisting Toko" (Admin)

Permintaan:
```json
{
  "note": "Stok eksisting sebelum POS digunakan",
  "items": [
    { "product_id": 12, "qty": "24", "unit_cost": "2000", "expiry_date": "2027-03-01", "batch_code": "L1" },
    { "product_id": 15, "qty": "10.5", "unit_cost": "1000" }
  ]
}
```
- `items`: 1–200 baris. `qty` wajib, > 0, maks 3 desimal. `unit_cost` opsional sebagai biaya barang masuk (maks. 4 desimal); bila diisi, nilai itu menjadi Harga Modal master terbaru untuk produk tersebut. Bila kosong, Harga Modal master yang sudah ada dipertahankan. `expiry_date` opsional (`YYYY-MM-DD`; stok eksisting boleh tanpa tanggal, produk `track_expiry` pun). `batch_code`, `shelf_position_id` opsional.
- Produk yang sama boleh muncul di beberapa baris (batch/kadaluarsa berbeda).

Respons 201:
```json
{ "data": { "document_no": "OPEN-000001",
            "items": [ { "product_id": 12, "batch_id": 7, "qty": "24.000" },
                       { "product_id": 15, "batch_id": 8, "qty": "10.500" } ] } }
```
Kesalahan 422 menunjuk baris: `errors["items.1.product_id"]` (produk tidak ada / nonaktif / **sudah punya pergerakan operasional → pakai adjustment**), `items.N.qty`, `items.N.expiry_date`. Semua baris atau tidak sama sekali. Kasir mendapat 403.

### GET `/api/inventory/products/{product}/stock` — panel "Stok & Batch" di detail produk
```json
{ "data": {
    "product_id": 12, "sku": "P-000012", "name": "Air Mineral 600ml", "unit_name": "pcs",
    "track_expiry": true, "unit_cost": "2000.0000",
    "totals": { "qty_sellable": "24.000", "qty_quarantine": "0.000", "qty_damaged": "0.000" },
    "batches": [
      { "balance_id": 5, "batch_id": 7, "batch_code": "L1", "expiry_date": "2027-03-01",
        "expiry_status": "ok", "is_opening": true, "received_at": "2026-10-23 03:15:00.123",
        "location_id": 1, "shelf_position_id": null,
        "qty_sellable": "24.000", "qty_quarantine": "0.000", "qty_damaged": "0.000" } ] } }
```
- `expiry_status`: `none` (tanpa tanggal) · `ok` · `near_expiry` (≤ ambang, default 30 hari) · `expired`. Gunakan untuk lencana warna **sekaligus teks** (jangan hanya warna).
- Urutan array = urutan FEFO (yang akan dijual lebih dulu di atas). Kasir **tidak** memilih batch.
- `unit_cost` (Harga Modal) sensitif secara bisnis; tampilkan hanya kepada pengguna berizin.

`GET /api/inventory/expiry-monitoring` memakai ambang toko `expiry_warning_days` (default 30 hari). Tanpa filter produk, respons memberi jumlah batch layak jual yang sudah kedaluwarsa dan yang akan kedaluwarsa dalam ambang. Dengan `product_ids[]`, respons juga memberi status per produk; prioritas tampilan: expired → near_expiry → tanpa tanggal → ok → tanpa stok → tidak dilacak. Snackbar global menampilkan jumlah tersebut dan dapat ditutup sampai sesi aplikasi berakhir.

### GET `/api/inventory/movements`
Query: `product_id`, `movement_type` (`opening_balance|receipt|putaway|transfer|sale|sale_void|customer_return|supplier_return_out|supplier_replacement_in|adjustment|write_off`), `date_from`, `date_to` (`YYYY-MM-DD`, tanggal WIB), `per_page` (1–100, default 25).
Item: `id, product_id, sku, product_name, batch_id, batch_code, expiry_date, movement_type, qty, unit_cost, from_location_id, from_bucket, to_location_id, to_bucket, ref_type, ref_id, occurred_at, created_by, created_by_name`.
Arah: ada `to_bucket` = barang masuk; ada `from_bucket` = barang keluar.

### Transfer stok antar lokasi/posisi (tahap 2.6) ✅

Semua endpoint transfer memakai permission `stock_transfer.create` (role Kasir/Admin). Dokumen dibatasi ke toko pengguna.

`POST /api/inventory/transfers` menerima:
```json
{
  "from_location_id": 1,
  "to_location_id": 1,
  "items": [
    { "product_id": 12, "batch_id": 7, "from_position_id": 3, "to_position_id": 4, "qty": "5" }
  ]
}
```
- `items`: 1–200 baris; `qty` wajib lebih dari nol, maksimal 3 desimal. `batch_id`, `from_position_id`, dan `to_position_id` opsional.
- Kedua lokasi harus aktif dan milik toko yang sama. Bila `warehouse_enabled=false`, transfer yang melibatkan lokasi gudang ditolak. Posisi asal, jika diisi, harus berada di lokasi asal; posisi tujuan, jika diisi, harus pada rak aktif di lokasi tujuan.
- Draft diberi nomor `TRF-...`; pembuatan draft tidak mengubah atau mereservasi stok. Tidak ada endpoint edit: draft yang keliru dibatalkan dan dibuat ulang.
- `POST .../{id}/post` hanya menerima draft. Saat posting, stok sumber yang tersedia diperiksa secara agregat (termasuk beberapa baris untuk produk/batch/posisi yang sama); jika tidak cukup, operasi gagal tanpa perubahan stok dan draft tetap utuh.
- Posting memindahkan bucket `sellable` secara atomik melalui `InventoryService`, mempertahankan produk, batch, qty dan HPP, serta membuat movement keluar dan masuk bertipe `transfer` dengan referensi dokumen yang sama. HPP produk tidak berubah.
- `POST .../{id}/cancel` hanya membatalkan draft; `reason` opsional (maksimum 500 karakter). Dokumen posted tidak dapat diedit atau dibatalkan.
- Pembuatan, posting, dan pembatalan dicatat pada audit log (`stock_transfer.create|post|cancel`).
- Daftar menerima filter `status` (`draft|posted|cancelled`), awalan nomor dokumen melalui `q`, dan `per_page` (1–100, default 25). Detail memuat nama lokasi, pembuat/pemosting, waktu posting, serta rincian produk, batch, posisi dan qty.
- Error validasi mengikuti format 422 standar; kegagalan stok menunjuk `items.N.qty`.

### Adjustment langsung (Handoff #1) ✅

Adjustment manual langsung memperbarui stok ketika disimpan; dokumen tidak memiliki tahap draft/pengajuan/persetujuan dan tidak dapat diedit atau dibatalkan. Endpoint utama hanya tersedia pada `/api/inventory/adjustments`; route `/api/stock-adjustments` dan endpoint workflow legacy telah dihapus.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/inventory/adjustments/meta` | Jenis dan alasan yang dapat dipilih |
| GET | `/api/inventory/adjustments` | Daftar terpaginasikan; filter `q`, `type`, `reason_code`, `source`, `date_from`, `date_to`, `sort`, `per_page` |
| POST | `/api/inventory/adjustments` | Mencatat adjustment dan pergerakan stok secara atomik |
| GET | `/api/inventory/adjustments/{id}` | Detail dokumen dan movement terkait |

Body POST menerima `product_id`, `type` (`increase|decrease`), integer `quantity` positif, `reason_code`, `notes?`, `expiry_date?`, dan UUID wajib `client_request_id`. Alasan tersedia: `damaged`, `expired`, `lost`, `found`, `input_correction`, `own_use`, `sample`, dan `other` (catatan wajib); `opname_result` hanya untuk pencatatan internal sesi opname. Produk yang melacak kedaluwarsa wajib diberi tanggal saat stok ditambah. Pengurangan memakai alokasi FEFO dan gagal tanpa perubahan bila stok tidak cukup. HPP tidak berubah. POST sukses `201`; kunci idempotensi yang sama mengembalikan dokumen yang sudah tercatat dengan `200`.

Adjustment langsung hanya dapat digunakan Admin, Owner, atau Kasir pada toko aktif. Izin `inventory.adjust.request` dan relasi grant/override-nya dihapus melalui migration. Izin `inventory.adjust.approve` tetap dipakai untuk write-off retur supplier. Migration pembersihan menghapus header dan item adjustment legacy yang `reason_code`-nya `NULL`; adjustment baru serta data opname dengan reason code, audit log, dan riwayat movement tetap dipertahankan.

### Yang belum ada untuk Inventory
Denah rak ⏳. Retur supplier dan write-off kini tersedia di bagian 15. `InventoryService` menyediakan penerimaan, penjualan FEFO, void penjualan, transfer, dan pencatatan stok adjustment langsung; penerimaan dari PO sudah melalui alur Pembelian (bagian 6).

---

## 2. Data Karyawan (customers) ✅

Status karyawan: `pending_verification` (input Kasir, hanya tunai) → `active` (diverifikasi Admin) ⇄ `inactive`.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/customers` | `customer.select` | Daftar/cari (`q` nama atau NIK-awalan, `status`, `per_page`) |
| GET | `/api/customers/{id}` | `customer.select` | Detail |
| POST | `/api/customers` | `customer.create` | Tambah karyawan (Kasir atau Admin) → selalu `pending_verification` |
| PATCH | `/api/customers/{id}` | `customer.update` (Admin) | Ubah `customer_no`, `name`, `department`; ganti `status` `active↔inactive` (+`reason`) |
| POST | `/api/customers/{id}/verify` | `customer.verify` (Admin) | Verifikasi; boleh sekaligus `credit_limit` |
| PUT | `/api/customers/{id}/credit-limit` | `customer.set_limit` (Admin) | Tetapkan/ubah batas kredit bulanan |
| GET | `/api/customers/{id}/credit-limits` | `customer.set_limit` (Admin) | Riwayat batas (terbaru dulu) |

### Bentuk respons (`data`)
Untuk **Kasir** (tanpa `customer.set_limit`):
```json
{ "id": 3, "customer_no": "NIK-100", "name": "Budi", "department": "Produksi",
  "status": "active", "credit_state": "available", "credit_remaining": "900000.00",
  "verified_at": "2026-10-23 03:20:00.000" }
```
Untuk **Admin** ditambah: `"credit_limit": "1500000.00"` (null bila belum diisi) dan `"credit_used": "450000.00"`.
**Kasir tidak pernah menerima nilai batas.**

`credit_state` — dasar untuk tombol "Kredit" di layar kasir:

| Nilai | Arti | UI |
|---|---|---|
| `not_verified` | Belum diverifikasi Admin | Hanya tunai; beri keterangan "menunggu verifikasi" |
| `limit_not_set` | Terverifikasi tapi batas belum diisi | Kredit **ditahan** (R-09); hanya tunai |
| `available` | Bisa kredit, ada sisa | Tampilkan `credit_remaining` |
| `exhausted` | Sisa batas habis (`credit_remaining` = `"0.00"`) | Tawarkan tunai; pengecualian hanya Admin |
| `inactive` | Karyawan nonaktif | Tidak bisa dipilih untuk kredit |

`credit_remaining` bernilai `null` kecuali status `available`/`exhausted`. Pemakaian dihitung dari struk kredit terposting yang belum ditagih (struk baru ada setelah modul penjualan; sebelum itu selalu 0). Estimasi PPN belum dihitung (R-04).

### POST `/api/customers`
`{ "customer_no": "NIK-100", "name": "Budi", "department": "Produksi" }` → 201 `{data}` status `pending_verification`.
422 bila `customer_no` sudah terdaftar atau mengandung karakter di luar huruf/angka/`. _ - /`.
Backend otomatis membuat **notifikasi** untuk setiap pemegang `customer.set_limit` (kecuali pembuatnya).

### POST `/api/customers/{id}/verify`
Body opsional `{ "credit_limit": "1500000", "note": "60% gaji sesuai HRD" }`. 422 bila sudah diverifikasi. Tanpa `credit_limit` → `credit_state: "limit_not_set"`. Mengirim `credit_limit` tanpa izin `customer.set_limit` → 403.

### PUT `/api/customers/{id}/credit-limit`
`{ "limit_amount": "1500000", "note": "naik gaji" }` (≥ 0, maks 2 desimal). 422 bila karyawan belum `active`. Nilai yang sama dengan yang berlaku tidak membuat catatan baru. Menyelesaikan (menandai terbaca) notifikasi "perlu batas" untuk karyawan itu.

Layar yang bisa dibuat: daftar karyawan + filter status, form tambah (Kasir), antrean "menunggu verifikasi" (Admin), dialog verifikasi + batas, riwayat batas, pemilih karyawan di POS (memakai `credit_state`).

---

## 3. Notifikasi ✅

Notifikasi milik pengguna yang login (tanpa izin khusus; hanya data sendiri).

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/notifications?unread=1&per_page=20` | Daftar; respons paginasi **+ `unread_count`** di tingkat atas (untuk badge lonceng) |
| POST | `/api/notifications/{id}/read` | Tandai satu terbaca → `{ "data": { "id": 4, "read": true } }`; milik orang lain → 404 |
| POST | `/api/notifications/read-all` | Tandai semua terbaca → `{ "data": { "marked": 3 } }` |

Item: `{ "id", "type", "entity_type", "entity_id", "message", "read_at", "created_at" }`.
Tipe saat ini: `customer.limit_needed` (`entity_type: "customer"`) → arahkan klik ke detail karyawan `entity_id` untuk mengisi batas. Notifikasi ini otomatis terbaca saat batas diisi, jadi lonceng bersih sendiri. Disarankan polling ringan (mis. 60 detik) — belum ada push.

---

## 4. Shift Kasir ✅

Alur: `open` → `counting` (penjualan baru **diblokir**) → `closed` → `reviewed`. Setiap mesin kasir memiliki laci/akun Kas Kecil sendiri; setiap mesin dan setiap kasir hanya dapat memiliki satu shift aktif. Kasir hanya mengelola shift sendiri, Admin (`shift.review`) boleh semua.

Mesin kasir adalah entitas `registers` yang **sudah ada** dan sudah direlasikan ke shift. Tidak ada tabel mesin baru. API pengelolaan memakai izin `register.manage` (Owner/Admin); menghapus dilakukan dengan menonaktifkan mesin, bukan menghapus riwayat/akun kas.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/registers` | `register.manage` | Daftar mesin, status, shift aktif, dan akun laci |
| POST | `/api/registers` | `register.manage` | Buat mesin dan akun Kas Kecil tersendiri secara atomik (`{"name":"Kasir Depan"}`) |
| GET | `/api/registers/{id}` | `register.manage` | Detail mesin |
| PATCH | `/api/registers/{id}` | `register.manage` | Ubah nama atau status (`is_active`); alasan wajib saat menonaktifkan |
| DELETE | `/api/registers/{id}` | `register.manage` | Nonaktifkan dengan alasan; tidak menghapus riwayat atau saldo |
| GET | `/api/registers/available` | `shift.open` | Mesin aktif dan ketersediaannya untuk pemilihan kasir |

`POST /api/shifts/open` menerima `register_id`. Bila toko hanya memiliki satu mesin aktif, field boleh dihilangkan demi kompatibilitas; bila lebih dari satu, pemilihan wajib eksplisit. Mesin yang sedang dipakai atau masih memiliki setoran akhir draft tidak tersedia. Mesin yang memiliki shift aktif tidak dapat dinonaktifkan. `register_name` ikut dikembalikan pada respons shift dan daftar laporan.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/shifts/current` | `shift.open` | Shift aktif milik saya; `{"data": null}` bila belum ada → tampilkan layar "Buka Shift" |
| POST | `/api/shifts/open` | `shift.open` | Buka shift. Body opsional `{"counted_opening_cash": "0"}` (hitungan uang di laci; selisih dengan saldo awal dicatat di audit) |
| GET | `/api/shifts/{id}` | `shift.open` | Detail (Kasir: hanya miliknya, selain itu 404) |
| POST | `/api/shifts/{id}/start-count` | `shift.close` | Mulai penutupan: status `counting`, penjualan baru ditolak |
| POST | `/api/shifts/{id}/close` | `shift.close` | Tutup: `{"counted_cash": "44000", "variance_note": "..."}` |
| POST | `/api/shifts/{id}/review` | `shift.review` (Admin) | Tinjau shift `closed` → `reviewed` (`{"note"}` opsional) |
| GET | `/api/shifts` | `shift.review` (Admin) | Daftar: `status`, `cashier_id`, `date_from`, `date_to`, `per_page` |

Nomor shift baru memakai `KASIR-JAGA-DDMMYYYY-slug-nama-kasir` (tanggal WIB), misalnya `KASIR-JAGA-03112026-kasir-jual`. Jika nama kasir yang sama membuka lebih dari satu shift pada tanggal yang sama, nomor berikutnya mendapat akhiran `-2`, `-3`, dan seterusnya. Nomor shift lama tidak diubah.

Respons shift (`data`):
```json
{ "id": 1, "doc_number": "KASIR-JAGA-03112026-kasir-jual", "register_id": 1, "register_name": "Kasir Depan", "cashier_id": 4, "cashier_name": "Kasir-jual",
  "status": "open", "opening_balance": "0.00", "opened_at": "2026-10-23 03:00:00.000", "closed_at": null,
  "summary": { "cash_sales_count": 1, "cash_sales_total": "27500.00", "credit_sales_count": 0,
               "credit_sales_total": "0.00", "cash_in": "0.00", "cash_out": "0.00" },
  "expected_cash": null, "counted_cash": null, "variance": null, "variance_note": null,
  "float_kept": null, "reviewed_at": null }
```
- **Hitung buta:** selama shift `open`/`counting`, `expected_cash` dan `variance` bernilai `null` untuk Kasir (hanya Admin melihatnya). Setelah `closed`, keduanya terisi. Jangan tampilkan perkiraan kas di layar hitung kasir.
- `opening_balance` = endapan shift sebelumnya (0 untuk shift pertama). Gagal membuka shift → 422 `errors.shift` (sudah punya shift / laci sedang dipakai kasir lain, pesan menyebut namanya).
- Tutup shift: bila selisih ≠ 0, `variance_note` **wajib** (422 `errors.variance_note`). Selisih = terhitung − diharapkan (negatif = kurang).
- **Tutup shift + setoran (🟡, bagian 7):** `float_kept` kini = endapan menurut kebijakan Admin, dan bila ada yang harus disetor, respons memuat `deposit` (setoran akhir berstatus `draft`). **Tanpa kebijakan aktif perilakunya sama seperti sebelumnya** (seluruh kas jadi endapan, `deposit: null`, `float_flags: ["no_policy"]`).
- Respons `POST /api/shifts/{id}/close` menambah `float_flags` (array: `no_policy`, `below_minimum`, `nothing_to_deposit`); respons shift mana pun menambah `deposit` (setoran akhir atau `null`) dan `summary.partial_deposits`.
- `POST /api/shifts/open` ditolak (`errors.shift`) bila setoran akhir shift sebelumnya masih `draft`.
- Kas masuk/keluar lain (`cash_movements`) ikut dihitung di kas diharapkan, tetapi belum ada endpoint untuk mencatatnya ⏳.

---

## 5. Penjualan (POS) ✅

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| POST | `/api/sales/preview` | `sales.create` | Pratinjau read-only: total, diskon, PPN, stok FEFO, dan batas kredit (FR-01) |
| POST | `/api/sales` | `sales.create` | **Posting penjualan** (tunai atau kredit potong gaji) |
| GET | `/api/sales` | `sales.create` | Riwayat. Kasir: hanya miliknya; Admin: semua. Filter `q` (nomor struk), `shift_id`, `customer_id`, `status`, `payment_mode`, `date_from`, `date_to`, `per_page` |
| GET | `/api/sales/{id}` | `sales.create` | Struk lengkap (item, pembayaran, `receipt`) |
| POST | `/api/sales/{id}/reprint` | `receipt.reprint` | Cetak ulang: struk sama dengan `receipt.is_copy = true`, `copy_label = "SALINAN"`; tercatat di log cetak + audit |

Void: lihat bagian 7.2. Retur pelanggan dan credit note ⏳ (Paket 2).

### POST `/api/sales/preview` ✅ FR-01

Endpoint read-only untuk kasir/administrator yang memiliki `sales.create`, dengan throttle 120 permintaan per menit:

```json
{ "payment_mode": "cash", "customer_id": null,
  "items": [ { "product_id": 12, "qty": "2" }, { "product_id": 15, "qty": "0.5" } ] }
```

Respons memuat baris tergabung, nama diskon terpilih, subtotal, diskon, PPN tunai, total, stok layak jual FEFO saat ini, dan status kecukupan stok. Untuk kredit potong gaji, respons juga memuat `credit.remaining_before`, `remaining_after`, dan `exceeds_limit` tanpa mengirim batas kredit mentah. Melebihi batas adalah sinyal UI (`exceeds_limit: true`) dan bukan error; pengecualian Admin tetap dilakukan hanya saat posting.

Semua aturan harga, diskon, PPN, pembulatan, dan penggabungan baris memakai sumber perhitungan yang sama dengan `POST /api/sales`. Pratinjau tidak memeriksa shift, tidak mengunci/menurunkan stok, tidak membuat nomor dokumen, sale/item/payment, ledger, idempotensi, atau audit. Nomor baris dipertahankan sebagai indeks baris pertama agar kunci error tetap sama, misalnya `items.N.product_id`. Stok kadaluarsa tidak dihitung sebagai tersedia, tetapi stok kurang tidak menolak pratinjau.

Contoh respons:

```json
{ "data": {
  "payment_mode": "cash",
  "lines": [ { "index": 0, "product_id": 12, "sku": "P-000012", "name": "Air Mineral", "unit_name": "pcs",
    "qty": "2.000", "unit_price": "10000.00", "gross": "20000.00", "discount_amount": "0.00",
    "discount_name": null, "line_total": "20000.00", "stock_available": "24.000", "stock_sufficient": true } ],
  "subtotal": "20000.00", "discount_total": "0.00", "tax_rate": null, "tax_amount": "0.00", "total": "20000.00",
  "credit": null, "computed_at": "2026-10-28 10:15:00.000"
} }
```

Validasi dan error 422 sama dengan posting untuk `payment_mode`, `customer_id`, dan `items.*`, kecuali field posting `idempotency_key`, `amount_tendered`, dan `credit_exception` tidak diperlukan. `SalePreviewTest` memeriksa paritas dengan posting, diskon PPN tunai, sinyal batas kredit, stok kadaluarsa, serta sifat read-only.

### POST `/api/sales`

Tunai:
```json
{ "idempotency_key": "6f1c...-uuid", "payment_mode": "cash", "amount_tendered": "50000",
  "customer_id": null,
  "items": [ { "product_id": 12, "qty": "2" }, { "product_id": 15, "qty": "0.5" } ] }
```
Kredit potong gaji:
```json
{ "idempotency_key": "…uuid…", "payment_mode": "payroll_credit", "customer_id": 3,
  "items": [ { "product_id": 12, "qty": "1" } ] }
```
Kredit dengan pengecualian Admin (hanya dikirim setelah Kasir melihat error `credit_limit` dan Admin mengetik kredensial sendiri di dialog):
```json
{ "...": "...", "credit_exception": { "approver_username": "admin", "approver_password": "…", "note": "Disetujui HRD, kebutuhan mendesak" } }
```
Aturan frontend:
- **`idempotency_key` wajib UUID dan dibuat sekali per keranjang** (buat saat mulai transaksi, kirim ulang kunci yang SAMA bila jaringan putus/timeout). Kirim ulang → `200` dengan `"replayed": true` dan struk yang sama; transaksi tidak ganda. Struk baru → `201`, `"replayed": false`. Kunci baru hanya untuk keranjang baru.
- Kirim hanya `product_id` dan `qty`. Harga, diskon, PPN, HPP dan batch FEFO **dihitung server**; tampilkan angka dari respons, jangan menghitung ulang. Kasir tidak bisa mengubah harga/diskon (diskon = aturan Admin).
- Produk sama di beberapa baris digabung server. `qty` maks 3 desimal, maks 99.999.
- Hanya produk berstatus `active` dengan harga yang bisa dijual (`pending_price`/`inactive` ditolak).

Respons (`data`):
```json
{ "id": 21, "doc_number": "SALE-202610-000001", "shift_id": 1, "cashier_id": 4, "cashier_name": "Kasir-jual",
  "customer_id": null, "customer_name": null, "customer_no": null,
  "payment_mode": "cash", "subtotal": "27500.00", "discount_total": "0.00",
  "tax_rate": null, "tax_amount": "0.00", "total": "27500.00",
  "status": "posted", "billing_status": "not_applicable", "over_limit": false, "posted_at": "2026-10-23 03:10:00.000",
  "items": [ { "id": 40, "product_id": 12, "sku": "P-000012", "name": "Air Mineral 600ml", "unit_name": "pcs",
               "qty": "2.000", "unit_price": "10000.00", "discount_amount": "0.00", "line_total": "20000.00" } ],
  "payment": { "method": "cash", "amount_tendered": "50000.00", "change_given": "22500.00", "amount_applied": "27500.00" },
  "receipt": { "store_name": "…", "is_copy": false, "copy_label": null, "note": null } }
```
Kredit: `payment` = `null`, `billing_status` = `"unbilled"`, `receipt.note` = "Belum dibayar. Ditagihkan lewat potong gaji." (struk kredit hanya menampilkan subtotal barang; PPN kredit dihitung saat invoice).

### Error yang perlu penanganan khusus (422, `errors.<kunci>`)
| Kunci | Arti | Tindakan UI |
|---|---|---|
| `shift` | Belum buka shift, atau shift sedang `counting` | Arahkan ke Buka Shift / tunggu penutupan |
| `items.N.qty` | Stok tidak mencukupi (pesan menyebut tersedia dan diminta) | Tandai baris N; seluruh transaksi **tidak** terposting |
| `items.N.product_id` | Produk tidak ada / belum bisa dijual | Hapus baris N |
| `amount_tendered` | Uang diterima kurang dari total | Minta nominal baru |
| `customer_id` | Kredit tapi karyawan belum dipilih / belum diverifikasi / nonaktif / batas belum diisi | Tawarkan tunai |
| `credit_limit` | **Melebihi batas kredit** (pesan memuat sisa batas dan total) | Tawarkan: ganti ke tunai, atau dialog pengecualian Admin |
| `approver_password` | Kredensial penyetuju salah / tidak berwenang / terlalu banyak percobaan | Ulangi dialog |
| `credit_exception.note` | Catatan pengecualian kosong | Wajibkan catatan |
| `idempotency_key` | Kunci sudah dipakai kasir lain | Buat kunci baru |
| `payment_mode` | Konfigurasi PPN belum lengkap (bila PPN diaktifkan) | Hubungi Admin |

Pengecualian berhasil → `over_limit: true` pada struk (label "melebihi batas" dipakai di rincian invoice dan laporan).

### Catatan perilaku
- Stok FEFO: Kasir tidak memilih batch; batch kadaluarsa tidak terjual (stok tampak "ada" di `stock_sellable` tetapi bisa ditolak `items.N.qty`).
- PPN tunai hanya aktif bila Admin mengaktifkan (`vat_enabled`) dan tarif dikonfigurasi (R-04 belum dikonfirmasi klien); default mati.
- Tunai masuk ledger kas kecil otomatis; kredit tidak menyentuh laci.
- Tidak ada endpoint pencarian produk baru: pakai pencarian/`by-barcode` produk yang sudah ada dan pemilih karyawan (`GET /api/customers?q=`, perhatikan `credit_state`).

---

## 6. Pembelian: PR → PO → Penerimaan barang ✅

Alur bisnis terbaru: **Kasir** meneruskan PR otomatis → **Finance** memeriksa → **Admin/Purchasing** memilih supplier, item, dan rekening serta mengautentikasi **Owner satu kali** saat membuat PO langsung berstatus disetujui → PO dicetak lalu dikonfirmasi terkirim ke supplier → **Kasir** menerima barang (surat jalan) → **posting** menambah stok → Admin memverifikasi surat jalan/faktur. Rekening hanya menjadi data pada PO (nama bank, pemilik, nomor); sistem tidak menyimpan saldo atau mengalokasikan dana. Pengaturan mengelola maksimal lima rekening dan visibilitas menu Inventory.

> Status: ✅ lulus test (24 Okt 2026). Uang/qty tetap string desimal. Waktu UTC. Format sukses `{ "data": ... }`.

### 6.1 Purchase Requisition (PR)

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/purchase-requisitions` | Salah satu: `purchase_requisition.create`, `purchase_requisition.finance_check`, `purchase_requisition.approve`, `purchase_order.create`, `purchase_order.send` | Daftar. Pemohon melihat PR sendiri; pemegang permission alur melihat antrean seluruh toko. Query: `status`, `q` (awalan nomor), `mine=1`, `per_page` |
| POST | `/api/purchase-requisitions` | `purchase_requisition.create` | Buat PR **draft** |
| GET | `/api/purchase-requisitions/{pr}` | Sama dengan izin daftar | Detail + item + riwayat keputusan + PO turunan |
| GET | `/api/purchase-requisitions/{pr}/purchase-order-items` | `purchase_order.create` | Item PR yang lolos pemeriksaan Finance (`approved`, atau `finance_checked` untuk kompatibilitas data lama) dan masih dapat dialokasikan ke PO (`qty_available`, `est_price`) |
| PATCH | `/api/purchase-requisitions/{pr}` | `purchase_requisition.create` | Ubah saat `draft`/`returned` (pembuat atau Admin). `items` menggantikan seluruh item |
| POST | `/api/purchase-requisitions/{pr}/submit` | `purchase_requisition.create` | `draft`/`returned` → `submitted` (notifikasi ke Finance) |
| POST | `/api/purchase-requisitions/{pr}/finance-check` | `purchase_requisition.finance_check` | `{ "decision": "pass" \| "return", "note": "..." }` — `note` wajib bila `return` |
| POST | `/api/purchase-requisitions/{pr}/approve` | `purchase_requisition.approve` | Tahap persetujuan PR lama; UI alur baru tidak memanggil endpoint ini. Otorisasi Owner dilakukan saat PO dibuat |
| POST | `/api/purchase-requisitions/{pr}/cancel` | `purchase_requisition.create` | `{ "reason"? }` — saat `draft`/`returned`/`submitted` (pembuat atau Admin) |

Status PR baru: `draft` → `submitted` → `approved` (Finance meloloskan PR) → `converted` (otomatis saat seluruh item sudah masuk PO) · cabang: `returned` (dikembalikan Finance, **boleh diedit lalu diajukan lagi**), `cancelled`. `finance_checked` dan persetujuan Owner terpisah tetap dikenali untuk kompatibilitas PR lama.

Permintaan buat/ubah:
```json
{ "reason": "Stok menipis",
  "items": [ { "product_id": 12, "qty": "10", "est_price": "2500", "note": "merk bebas" } ] }
```
`items` 1–100 baris; `qty` > 0 (maks 99999, 3 desimal); `est_price` opsional (maks 2 desimal); produk nonaktif/ganda ditolak. Produk `pending_price` boleh diajukan.

Detail PR (`data`): `id, doc_number ("PR-202610-000001"), status, reason, est_total, requested_by, requester_name, submitted_at, created_at`, `items[]` (`id, product_id, sku, name, unit_name, qty, est_price, note`), `approvals[]` (`step: finance_check|owner_auth, decision: approved|returned|rejected, decided_by_name, note, is_self_approval, decided_at`), `purchase_orders[]` (`id, doc_number, status, total`). `qty` adalah satu-satunya kuantitas permintaan; informasi sisa alokasi PO disediakan terpisah di endpoint item PO.

Daftar item PO yang tersedia (`GET /api/purchase-requisitions/{pr}/purchase-order-items`, hanya PR `approved`): `{ "pr_id": 5, "items": [{ "product_id": 12, "sku": "…", "name": "…", "unit_name": "pcs", "qty_available": "4.000", "est_price": "2500.00", "suppliers": [{ "id": 2, "code": "SUP-02", "name": "Supplier", "default_payment_terms": "credit" }] }] }`. `qty_available` menghitung jumlah PR dikurangi kuantitas PO aktif; PO dibatalkan tidak mengurangi jumlah tersedia. `suppliers` hanya berisi supplier aktif yang terhubung ke produk.

Untuk PO baru, akun Owner ditetapkan per toko: `GET /api/settings/purchase-order-owner` dapat dibaca oleh `settings.manage` atau `purchase_order.create`, sedangkan `PUT` hanya oleh `settings.manage` dengan `{ "owner_user_id" }`. Kandidat harus aktif dan memiliki `purchase_requisition.approve`. Pengguna pembuat PO dapat membaca nama akun terpilih untuk ditampilkan pada form. Form mengirim `approver_user_id`; backend mencocokkannya dengan konfigurasi, lalu melakukan autentikasi ulang terhadap akun tersebut tanpa menerima identitas autentikasi dari klien. (Klien lama dapat mengirim `approver_username`, tetapi harus cocok dengan akun terpilih.) Kredensial `approver_password` atau `approver_key` tetap diketik oleh pemberi persetujuan; salah → 422. Wajib selama setting `approval_reauth_required` aktif (default aktif). Bila pembuat PR = pemberi otorisasi, aturan `sod_owner_self_approve` (Owner) atau `sod_pr_creator_approver` (non-Owner) tetap diberlakukan; penandaan swa-persetujuan dicatat pada audit PO. Autentikasi dan persetujuan PR terpisah tetap berlaku untuk PR lama. Jika terdapat beberapa kandidat dan belum ada akun yang ditetapkan, pembuatan PO ditolak sampai admin memilihnya di Pengaturan.

### 6.2 Purchase Order (PO)

Daftar supplier dapat dibaca oleh pemegang `supplier.manage`, `purchase_order.create`, `product.create`, atau `product.update` agar supplier dapat dipilih pada master produk dan PO. Membuat/mengubah supplier tetap memerlukan `supplier.manage`.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/purchase-orders` | Salah satu: `purchase_order.create`, `purchase_order.send`, `purchase_requisition.approve`, `goods_receipt.create` | Daftar. Pengelola PO: semua; **Kasir: hanya PO yang bisa menerima barang, tanpa harga** (`unit_price`/`total` = `null`). Query: `status`, `receipt_status`, `supplier_id`, `pr_id`, `receivable=1`, `q`, `per_page` |
| GET | `/api/purchase-orders/{po}` | Sama dengan izin daftar | Detail + item, rekening tersamarkan, dan daftar penerimaan; pembatasan status untuk Kasir tetap berlaku |
| POST | `/api/purchase-orders` | `purchase_order.create` | Buat PO langsung `approved` secara atomik dari PR lolos Finance; request mewajibkan rekening aktif (`bank_account_id`), item, akun Owner terpilih (`approver_user_id`), dan autentikasi ulang sesuai mode. Tidak memeriksa saldo atau membuat alokasi |
| PATCH | `/api/purchase-orders/{po}` | `purchase_order.create` | Ubah hanya PO `draft` lama (`pr_id` tidak dapat diubah); PO baru tidak memiliki tahap draft |
| POST | `/api/purchase-orders/{po}/submit` | `purchase_order.create` | Endpoint kompatibilitas untuk PO draft lama; draft menjadi `pending_confirmation` tanpa alokasi dana |
| POST | `/api/purchase-orders/{po}/confirm` | `purchase_requisition.approve` | Endpoint kompatibilitas untuk PO lama berstatus `pending_confirmation`; PO baru sudah disetujui saat dibuat |
| POST | `/api/purchase-orders/{po}/send` | `purchase_order.send` | `approved` → `sent` |
| POST | `/api/purchase-orders/{po}/cancel` | `purchase_order.create` | `{ "reason" }` wajib; sebelum ada penerimaan |
| POST | `/api/purchase-orders/{po}/close` | `purchase_order.create` | `{ "reason" }` wajib; tutup manual PO yang sebagian diterima |

Permintaan buat:
```json
{ "pr_id": 5, "supplier_id": 2, "bank_account_id": 1, "approver_user_id": 3, "approver_password": "…",
  "payment_terms": "top", "payment_term_days": 30, "order_date": "2026-10-24", "expected_date": "2026-10-30",
  "items": [ { "product_id": 12, "qty_ordered": "10", "unit_price": "2400" } ] }
```
`payment_terms` adalah `top|cbd|cod`; TOP wajib menyertakan `payment_term_days` (1–65535), sedangkan CBD/COD tidak memakai jumlah hari. Nilai termin bawaan supplier lama dipetakan: `credit` → TOP, `prepaid` → CBD, `cod` → COD. `order_date` default hari ini (WIB).

Setiap produk dalam PO harus terhubung ke `supplier_id` PO. Validasi ini berlaku di backend saat membuat PO maupun mengubah item/supplier pada PO draft. Untuk membagi Permintaan lintas supplier, buat PO terpisah untuk masing-masing supplier dan hanya masukkan produk yang terhubung dengannya.

Status PO baru: `approved` → `sent` → `partially_received` → `received`; cabang `cancelled`. PO lama dapat tetap berstatus `draft` atau `pending_confirmation` dan memakai endpoint kompatibilitas. Semua PO baru memerlukan autentikasi Owner saat dibuat, tanpa auto-approval berdasarkan estimasi PR. Status penerimaan terpisah: `receipt_status` = `none|partial|complete`; `payment_status` = `unpaid` (pembayaran = Paket 2).

Aturan: PO **wajib dari PR `approved`**; satu PR boleh dipecah ke beberapa PO (per supplier); qty per produk **kumulatif** tidak boleh melebihi qty PR (422 `errors["items.N.qty_ordered"]` memuat sisa); PR otomatis menjadi `converted` bila semua item sudah tercakup dan kembali `approved` bila PO dibatalkan.

Detail PO (`data`): `id, doc_number ("PO-…"), status, receipt_status, payment_status, payment_terms, payment_term_days|null, pr_id, pr_doc_number, supplier_id, supplier_name, order_date, expected_date, total, bank_account|null, created_by_name`, `bank_account` (`id, bank_name, account_name, account_number_masked`), `items[]` (`id` = **`po_item_id`** untuk penerimaan, `product_id, sku, name, unit_name, qty_ordered, qty_received, qty_remaining, unit_price, line_total`), `receipts[]` (`id, doc_number, status, document_status, posted_at`). `payment_term_days` hanya digunakan TOP; PO lama yang dahulu memakai kredit tetap bernilai `null` karena jumlah hari sebelumnya tidak tercatat. `bank_account` dapat `null` pada PO lama yang tidak memiliki catatan rekening.

### 6.2.1 Rekening bank dan pengaturan menu Inventory

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/bank-accounts` | `purchase_order.create` | Daftar rekening aktif untuk PO; nomor rekening dimasking. Tidak ada data saldo |
| GET | `/api/settings/bank-accounts` | `settings.manage` | Daftar rekening untuk Pengaturan, termasuk nomor penuh dan status aktif |
| POST | `/api/settings/bank-accounts` | `settings.manage` | `{ "bank_name", "account_name", "account_number" }`; buat rekening, nomor unik per toko dan maksimal lima rekening |
| PATCH | `/api/settings/bank-accounts/{account}` | `settings.manage` | Ubah nama bank, pemilik, nomor, atau status aktif. Rekening nonaktif tidak bisa dipilih untuk PO |
| GET | `/api/settings/inventory/menus` | Pengguna terautentikasi | Nilai `show_opening_balance` dan `show_stock_transfer`, default `false` |
| PUT | `/api/settings/inventory/menus` | `settings.manage` | Simpan kedua boolean visibilitas menu |

Ledger rekening dan tabel alokasi lama tetap disimpan sebagai riwayat database, tetapi tidak lagi dibaca atau ditulis oleh alur PO. Permission lama `purchase_fund.view`, `purchase_fund.allocate`, dan `bank_account.manage` tidak lagi dipakai oleh katalog peran maupun endpoint aktif.

### 6.3 Penerimaan barang (Goods Receipt)

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/goods-receipts` | `goods_receipt.create` | Daftar. Kasir: miliknya; Admin: semua. Query: `document_status`, `po_id`, `q`, `per_page`; respons tidak menampilkan status GR |
| GET | `/api/goods-receipts/receiving-locations` | `goods_receipt.create` | Lokasi penerimaan aktif pada toko; gudang hanya ditampilkan saat `warehouse_enabled=true` |
| POST | `/api/goods-receipts` | `goods_receipt.create` | `complete_po: true` menutup satu PO dalam satu GR, menghitung qty diterima otomatis, membuat Retur Barang untuk qty rusak, lalu memposting stok atomik. PO yang sudah memiliki GR aktif ditolak. |
| GET | `/api/goods-receipts/{gr}` | `goods_receipt.create` | Detail + baris |
| POST | `/api/goods-receipts/{gr}/post` | `goods_receipt.create` | **Posting**: stok bertambah, PO diperbarui (atomik) |
| POST | `/api/goods-receipts/{gr}/cancel` | `goods_receipt.create` | Batalkan penerimaan **draft** |
| POST | `/api/goods-receipts/{gr}/verify-documents` | `goods_receipt.verify_documents` | Verifikasi surat jalan + faktur (Admin) |

Permintaan final:
```json
{ "po_id": 9, "complete_po": true, "post": true, "receiving_location_id": 3, "delivery_note_no": "SJ-001", "invoice_no": "INV-77", "note": null,
  "items": [
    { "po_item_id": 31, "qty_damaged": "2", "qty_short": "1", "expiry_date": "2027-03-01", "note": null }
  ] }
```
- Pada `complete_po: true`, setiap baris PO dikirim tepat sekali. `qty_received` dihitung server = sisa PO - `qty_damaged` - `qty_short`; tidak boleh negatif. Nilai yang tidak dikirim ditutup/dibatalkan, PO berstatus `received`, dan receipt status `partial` jika ada qty short. GR dibuat final dan diposting dalam transaksi yang sama.
- Satu PO hanya boleh memiliki satu penerimaan GR aktif. PO yang sudah memiliki GR non-cancelled tidak dapat diterima ulang; PO tersebut juga tidak ditampilkan dalam daftar receivable.
- Untuk kompatibilitas dokumen lama, permintaan tanpa `complete_po` masih dapat membuat/posting GR dengan kontrak lama. Alur baru pada UI selalu memakai `complete_po: true`.
- Produk `track_expiry` **wajib** `expiry_date` (untuk qty diterima); produk lain **tidak boleh**; tanggal yang sudah lewat ditolak (catat sebagai rusak).
- Harga beli = harga di PO. `unit_cost` hanya boleh diubah pemegang `goods_receipt.verify_documents` (Kasir mengirim nilai berbeda → 403). Kasir **tidak** menerima `unit_cost`/`price_variance` pada respons (`null`).
- `qty_damaged` otomatis dibuatkan dokumen Retur Barang berstatus Draft yang tertaut ke GR, dan masuk bucket karantina saat stok diposting. Dokumen retur dapat diajukan ke supplier setelah penerimaan tersimpan.
- Respons `data` tidak mengirim status GR; memuat `id, doc_number ("GR-…"), po_id, po_doc_number, supplier_name, receiving_location_id, receiving_location_name, delivery_note_no, invoice_no, document_status (pending|verified), attachments_open, received_by_name, posted_at, verified_by_name, verified_at`, `items[]` (`po_item_id, product_id, sku, name, qty_ordered, qty_received, qty_damaged, qty_short, unit_cost, po_unit_price, price_variance, expiry_date, batch_code, shelf_position_id`). Pada GR final, `qty_short` adalah jumlah yang tidak dikirim; pada data GR legacy nilainya tetap sesuai snapshot kekurangan saat dibuat.
- Efek posting final: batch baru + saldo + pergerakan `receipt` + pembaruan Harga Modal ke biaya masuk terbaru, qty PO diterima sesuai barang datang (baik maupun rusak), PO ditutup, dan qty tidak dikirim dibatalkan. Bila ada barang rusak, retur dan notifikasi `goods_receipt.damaged` dibuat.
- Bila lokasi tujuan bertipe gudang, lokasi tersebut harus aktif dan `warehouse_enabled=true`; aturan diperiksa saat membuat **dan** memposting draft. Posisi rak per item opsional, tetapi bila diisi harus berada pada rak aktif di lokasi penerimaan. Stok tanpa posisi dapat dipindahkan/di-putaway memakai alur transfer stok.
- UI dapat mengambil pilihan lokasi lewat `GET /api/goods-receipts/receiving-locations`; endpoint hanya mengembalikan lokasi aktif milik toko dan menyembunyikan gudang saat konfigurasi nonaktif.

### Lampiran dokumen penerimaan (tahap 4.5) ✅

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| POST | `/api/goods-receipts/{gr}/attachments` | `goods_receipt.create` | Unggah satu berkas per permintaan melalui `multipart/form-data` dengan field `file` |
| GET | `/api/goods-receipts/{gr}/attachments/{attachment}` | `goods_receipt.create` | Unduh lampiran secara privat; akses hanya untuk pembuat penerimaan atau pemegang `goods_receipt.verify_documents` |

- Format yang diterima: JPEG, PNG, WebP, atau PDF; ukuran maksimum 10 MB per berkas.
- Upload dapat dilakukan pada GR draft atau posted selama belum dibatalkan atau diverifikasi. Lampiran bersifat append-only; verifikasi dokumen yang sudah ada tidak diubah dan tidak mensyaratkan lampiran.
- Detail `GET /api/goods-receipts/{gr}` menyertakan `attachments[]`: `id, original_name, mime_type, size_bytes, uploaded_by_name, created_at`. Path fisik tidak dikirim ke klien dan berkas tidak disajikan dari disk publik.
- File disimpan di disk privat Laravel dan metadata disimpan pada tabel `attachments` dengan `entity_type = goods_receipt`; setiap upload diaudit sebagai `goods_receipt.attach`.

### 6.4 Kunci error yang perlu penanganan khusus (422 `errors.<kunci>`)

| Kunci | Arti | Tindakan UI |
|---|---|---|
| `status` | Aksi tidak cocok dengan status dokumen saat ini | Muat ulang dokumen, tampilkan pesan |
| `approver_password` | Autentikasi ulang kosong/salah/terkunci (5x salah) | Tampilkan di dialog persetujuan, jangan tutup dialog |
| `approver_username` | Pembuat tidak boleh menyetujui sendiri (setting SoD) | Minta Owner lain |
| `note` / `reason` | Alasan wajib (kembalikan, tolak, batal, tutup) | Fokus ke kolom alasan |
| `pr_id` | PR belum `approved` / sudah seluruhnya jadi PO | Muat ulang PR |
| `items.N.qty_ordered` | Melebihi jumlah PR yang masih tersedia | Muat ulang daftar item PO dari endpoint ketersediaan |
| `po_id` | PO belum/tidak lagi bisa menerima barang | Tampilkan pesan |
| `receiving_location_id` | Lokasi tidak aktif/tidak dimiliki toko, atau gudang tidak diizinkan oleh `warehouse_enabled` | Pilih lokasi toko aktif atau aktifkan konfigurasi gudang |
| `items.N.qty_received` | Melebihi sisa pesanan / kedua jumlah kosong | Tampilkan sisa dari pesan |
| `items.N.expiry_date` | Wajib / tidak berlaku / sudah kedaluwarsa | Fokus ke kolom tanggal baris itu |
| `items` (pada posting) | Penerimaan lain sudah memakai sisa PO | Muat ulang PO dan penerimaan |
| `delivery_note_no`, `invoice_no`, `document_status` | Verifikasi dokumen belum lengkap / sudah terverifikasi | Tampilkan pesan |

### 6.5 Notifikasi baru (`type`)
`pr.submitted` (ke Finance), `pr.finance_checked` (ke pemegang `purchase_order.create`, untuk menyiapkan PO), `pr.returned` (ke pembuat), `pr.approved` / `pr.rejected` / `pr.ready_for_po` (alur PR lama), `po.needs_confirmation` / `po.confirmed` (alur PO lama), `goods_receipt.damaged`. Semua memakai `entity_type` (`purchase_requisition|purchase_order|goods_receipt`) + `entity_id` untuk tautan ke dokumen.

### 6.6 UI purchasing
UI PR/PO tersedia dalam tiga tahap: Finance memeriksa PR; Admin/Purchasing memilih supplier, item, dan rekening serta mengautentikasi Owner satu kali untuk membuat PO langsung berstatus `approved`; PO dicetak sebelum dikonfirmasi terkirim. Endpoint draft dan persetujuan terpisah tetap tersedia untuk PO lama. Penerimaan barang (Kasir) memakai PO `sent` → isi qty/kedaluwarsa/rusak → posting; Admin dapat memverifikasi dokumen penerimaan.

### 6.7 ASUMSI dan batasan (perlu konfirmasi klien/pengguna)
- **Alur PO baru:** setiap PO memerlukan autentikasi Owner saat dibuat, terlepas dari estimasi PR. Pengaturan pemisahan tugas (`sod_owner_self_approve` dan `sod_pr_creator_approver`) tetap berlaku bila pemohon PR menjadi pemberi otorisasi.
- "Owner" = pemegang `settings.manage`; aturan swa-persetujuan memakai `sod_owner_self_approve` untuk Owner dan `sod_pr_creator_approver` untuk lainnya.
- Penerimaan barang hanya tersedia setelah PO dikonfirmasi terkirim (`sent`/`partially_received`).
- Tanpa toleransi kelebihan kiriman; barang yang sudah kedaluwarsa tidak diterima sebagai layak jual.
- **Selesai tahap 4.4:** penerimaan dapat diarahkan ke gudang aktif saat `warehouse_enabled=true`; posisi rak bisa ditentukan per item atau stok dipindahkan kemudian melalui transfer stok.
- **Belum ada:** retur supplier/klaim barang rusak (Paket 3), pembayaran supplier dan Saldo Pembelian (Paket 2), dokumen koreksi penerimaan terposting.

## 7. Setoran, Endapan, dan Void ✅

> Status: ✅ lulus `php artisan test` (24 Okt 2026; `CashDepositTest` 14, `SaleVoidTest` 6; total suite 174 lulus). Bentuk respons final dan boleh dipercaya.

### 7.1 Kebijakan endapan dan setoran kasir

Endapan = uang yang sengaja tetap di laci dan menjadi saldo awal shift berikutnya. Setoran = kas terhitung − endapan, **dibulatkan ke bawah** ke `rounding_unit` (sisa pembulatan tetap di laci).

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/float-policies` | `float.propose` | Kebijakan aktif: `{ "data": { "petty_cash": {…}\|null, "main_cash": {…}\|null } }` |
| PUT | `/api/float-policies/{scope}` | `float.configure` (Admin) | Tetapkan versi baru (`scope` = `petty_cash`\|`main_cash`); versi lama dinonaktifkan, tercatat di audit |
| POST | `/api/shifts/{id}/deposits` | `cash_deposit.create` | **Setoran parsial** tengah shift: `{ "counted_amount": "800000", "note"? }` → Draft |
| GET | `/api/cash-deposits?status=&kind=&shift_id=&per_page=` | `cash_deposit.create` **atau** `cash_deposit.receive` | Daftar (pemegang `create`: hanya shift sendiri; pemegang `receive`: semua) |
| GET | `/api/cash-deposits/{id}` | `cash_deposit.create` **atau** `cash_deposit.receive` | Detail (pemegang `create` dibatasi ke shift sendiri; pemegang `receive` dapat melihat semua) |
| POST | `/api/cash-deposits/{id}/submit` | `cash_deposit.create` | Kasir menyerahkan uang: `draft` → `submitted` |
| POST | `/api/cash-deposits/{id}/cancel` | idem | Batalkan Draft **parsial** (dokumen dihapus; setoran akhir tidak bisa dibatalkan) |
| POST | `/api/cash-deposits/{id}/receive` | `cash_deposit.receive` (Admin) | Finance menghitung ulang: `{ "received_amount": "734000", "note"? }` |
| POST | `/api/cash-deposits/{id}/correct` | `cash_deposit.receive` | Tutup selisih dengan alasan: `{ "reason" }` |
| GET | `/api/fund-accounts` | `cash_deposit.receive` | Saldo Kas Kecil dan Kas Besar (dari ledger) |

Kebijakan (`PUT` body): `{ "mode": "fixed", "fixed_amount": "500000", "min_amount"?, "max_amount"?, "rounding_unit"?: 1000, "reason"? }` atau `{ "mode": "percent", "percent": "10", "percent_base": "cash_sales_shift"\|"cash_on_hand", … }`. Respons: `{ id, scope, mode, fixed_amount, percent, percent_base, min_amount, max_amount, rounding_unit, effective_from, set_by }`. Kesalahan 422: `errors.fixed_amount` / `errors.percent` / `errors.percent_base` / `errors.min_amount` (min > maks).

Aturan hitung:
- `fixed`: endapan = nominal. `percent`: endapan = persen × basis (`cash_sales_shift` = total penjualan tunai shift; `cash_on_hand` = kas terhitung). Hasil dijepit ke `min_amount`/`max_amount`.
- Kas terhitung < `min_amount` → setoran 0, flag `below_minimum`. Kas ≤ endapan → setoran 0, flag `nothing_to_deposit`. **Tanpa kebijakan aktif** → setoran 0, flag `no_policy`, seluruh kas = endapan.
- **Tutup shift** (`POST /api/shifts/{id}/close`) membuat setoran akhir `kind: "final"` berstatus `draft` bila ada yang disetor; `data.deposit` berisi `{ id, doc_number, status, deposit_amount, float_kept }`. Kasir menekan "Serahkan" (`submit`) → Finance `receive`. Shift berikutnya baru bisa dibuka setelah setoran akhir diserahkan, dan saldo awalnya = `float_kept`.
- **Setoran parsial** boleh saat shift `open`/`counting`; satu Draft sekaligus; shift tidak bisa ditutup selama ada Draft (`errors.status`). Kas diharapkan baru berkurang setelah parsial **diserahkan** (`summary.partial_deposits`). Tidak ada yang bisa disetor → `errors.counted_amount` (pesan menjelaskan alasannya).

Dokumen setoran (`data`): `{ id, doc_number "DEP-202610-000001", kind "final"\|"partial", shift_id, shift_doc_number, status, counted_amount, float_kept, deposit_amount, received_amount, difference, received_by_name, received_at, note, created_by, created_by_name, created_at }`.
Status: `draft` → `submitted` → `received` (cocok) atau `discrepancy` (berbeda; `note` **wajib** → `errors.note`) → `corrected` (alasan). Ledger saat `receive`: Kas Kecil −`deposit_amount`, Kas Besar +`received_amount`; `correct` tidak mengubah ledger. Selisih = `received_amount − deposit_amount` (negatif = kurang).

Layar yang bisa dibuatkan UI: dialog hasil tutup shift (tampilkan setoran + endapan + `float_flags`), tombol "Serahkan setoran", form setoran parsial, antrean "Setoran masuk" untuk Finance/Admin (terima/selisih/koreksi), halaman kebijakan endapan (Admin), kartu saldo Kas Kecil/Kas Besar.

### 7.2 Void penjualan

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| POST | `/api/sales/{id}/void` | `sales.void` (**Admin saja**) | `{ "reason": "salah input" }` (wajib) → struk lengkap dengan `status: "voided"` |

- Efek (atomik): status `voided` (bukan hapus; dokumen `sale_voids` + audit `sale.void`), stok kembali ke **batch asal**, penjualan tunai membalik ledger Kas Kecil, karyawan mendapat kembali sisa batas kredit.
- **Syarat (422 `errors.status`):** struk harus `posted`; **struk tunai hanya bisa di-void selama shift-nya masih `open`** (uang dikembalikan dari laci yang sama; shift yang sudah ditutup → gunakan retur pelanggan, belum ada); **struk kredit hanya bila belum ditagihkan** (setelah masuk invoice perlu credit note, belum ada). Alasan kosong → `errors.reason`. Kasir → 403.
- Struk voided: `receipt.is_void = true`, `receipt.void_label = "DIBATALKAN"` (cetak ulang dan layar riwayat harus menampilkannya). Daftar penjualan dapat difilter `?status=voided`.
- Struk voided tidak dihitung di ringkasan shift, kas diharapkan, maupun pemakaian batas kredit.

### 7.3 ASUMSI dan batasan
1. Void hanya Admin (Kasir belum diberi kewenangan; menunggu P-12 klien). Tanpa autentikasi ulang tambahan (Admin sudah login).
2. Void tunai dibatasi shift yang masih terbuka; refund dari shift lain/ditutup menunggu retur pelanggan (Paket 2).
3. Endapan Kas Besar, setoran bank, dan usulan endapan oleh Kasir (`float_proposals`) belum ada ⏳; saat ini kebijakan hanya ditetapkan Admin.
4. Kasir tidak bisa mengubah angka endapan atau setoran; sistem yang menghitung dari kebijakan.
5. Pembulatan mengikuti `rounding_unit` kebijakan (bawaan 1.000), bukan setting `float_rounding_unit`.

---

### 7.4 Kas masuk/keluar nonpenjualan ✅

> Status: ✅ `CashMovementTest` 4 lulus; seluruh suite 204 test (1.764 assertions) lulus pada 26 Okt 2026. Tidak ada migration; ditambahkan permission `cash_movement.create`. Untuk database yang sudah ada, jalankan `php artisan db:seed --class=PermissionSeeder` agar permission baru diberikan ke role sistem.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/shifts/{id}/cash-movements?per_page=` | `cash_movement.create` | Daftar pergerakan kas shift, terbaru dulu; Kasir hanya shift sendiri, Admin semua |
| POST | `/api/shifts/{id}/cash-movements` | `cash_movement.create` | Catat kas masuk/keluar nonpenjualan pada shift aktif |

Permintaan:
```json
{ "type": "in", "amount": "50000", "reason": "Tambahan modal" }
```
- `type`: `in` atau `out`; `amount` wajib positif, maksimal 2 desimal; `reason` wajib (maks. 255 karakter).
- Kasir hanya dapat menulis dan melihat pergerakan pada shift sendiri; Admin (pemegang `shift.review`) dapat mengelola shift mana pun. Shift harus berstatus `open`; saat mulai hitung atau setelah ditutup, pencatatan ditolak dengan 422 `status`.
- Satu transaksi atomik membuat `cash_movements`, entri ledger Kas Kecil (`cash_movement_in` positif / `cash_movement_out` negatif), dan audit `cash_movement.create`. Jumlah tampil sebagai string desimal.
- Respons item: `id, shift_id, type, amount, reason, created_by, created_by_name, created_at`. Daftar berpaginasi dengan bentuk Laravel standar.
- Kas masuk/keluar masuk dalam perhitungan kas yang diharapkan saat tutup shift. Tidak ada operasi hapus/koreksi; bila salah, koreksi lewat pencatatan kas berlawanan dengan keterangan yang menjelaskan.

### Layar yang bisa dibuat
Pada layar shift, sediakan form kas masuk/keluar hanya saat status `open` dan daftar riwayat pergerakan kas; setelah pencatatan, muat ulang ringkasan shift. Tangani 403/404/422 mengikuti konvensi umum.

## 8. Tagihan HRD ✅

> Status: ✅ `BillingTest` 14 lulus setelah pembaruan format nama dan pembatalan periode; `SaleTest` 17 lulus. Operasi periode dilindungi permission pengelolaan tagihan (Admin dan role lain yang diberi izin tersebut).

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/billing-periods` | `billing_period.manage` | Daftar periode (terbaru dulu, paginasi) |
| GET | `/api/billing-periods/current` | `billing_period.manage` | Periode terbuka; `data` = null bila belum ada |
| POST | `/api/billing-periods` | `billing_period.manage` | Buka periode: `label?`, `scheduled_close_date?` (`YYYY-MM-DD`). Nama default `Periode [Nama Bulan]`, bulan berjalan. 422 `status` bila masih ada yang terbuka |
| GET | `/api/billing-periods/{id}` | `billing_period.manage` | Detail + `period_month` (`YYYY-MM-01`) + `customers[]` (ringkasan tagihan per karyawan) |
| PATCH | `/api/billing-periods/{id}` | `billing_period.manage` | Ubah `label`, `period_month` (`YYYY-MM-01`), dan/atau `scheduled_close_date`; hanya periode terbuka |
| POST | `/api/billing-periods/{id}/close` | `billing_period.close` | **Tutup periode** pada hari gaji |
| POST | `/api/billing-periods/{id}/cancel` | `billing_period.manage` | Batalkan periode dengan `{ "reason": "..." }`; hanya open/closed tanpa struk kredit terposting dan tanpa invoice |
| POST | `/api/billing-periods/{id}/invoice` | `invoice.generate` | Buat invoice (draft); `bill_to?` (default "HRD") |
| GET | `/api/invoices?status=&per_page=` | `invoice.generate` | Daftar invoice |
| GET | `/api/invoices/{id}` | `invoice.generate` | Detail: `customers[]` (per karyawan, berisi `sales[]`) dan `payments[]` |
| POST | `/api/invoices/{id}/issue` | `invoice.issue` | draft → `issued` |
| POST | `/api/invoices/{id}/hand-over` | `invoice.issue` | `issued` → `handed_to_hr` (penanda diserahkan ke HRD) |
| POST | `/api/invoices/{id}/payments` | `invoice.record_payment` | Finance/Accounting/Admin mencatat pembayaran HRD: `amount`, `received_on?`, `reference?`, `note?`; penerimaan masuk ke akun `main_cash` |

### Perilaku
- **Tutup periode** mengikat semua struk kredit terposting yang belum terikat ke periode itu, lalu **periode berikutnya otomatis dibuka**; struk kredit baru masuk ke sana. Karena struk terikat tidak lagi dihitung sebagai pemakaian, **sisa batas kredit karyawan pulih** setelah tutup periode. Struk tunai dan struk batal tidak ikut.
- Nama default periode menggunakan `Periode [Nama Bulan]` dalam bahasa Indonesia. Periode pertama/manual memakai bulan berjalan; setelah periode ditutup, periode otomatis berikutnya memakai bulan kalender setelah `period_month` periode yang ditutup (misalnya Oktober → November). Admin dapat mengubah bulan/tahun periode (`period_month`) saat masih terbuka; bila label masih memakai nama default, label mengikuti perubahan bulan. Label khusus tetap dapat diedit terpisah. Periode tertutup tidak dapat diubah agar riwayat struk tidak bergeser. Jika periode kosong dibatalkan lalu dibuka lagi, bulan periode terakhir yang dibatalkan dipakai kembali (tidak melompat bulan).
- Periode kosong dapat dibatalkan dengan alasan, baik masih terbuka maupun sudah ditutup, selama tidak memiliki invoice. Periode aktif yang dibatalkan tidak otomatis diganti; Admin harus membuka periode yang benar sebelum transaksi kredit dilanjutkan. Periode berisi struk kredit atau yang sudah memiliki invoice tidak dapat dibatalkan. Keterikatan transaksi dijaga agar pembatalan tidak balapan dengan posting kredit.
- **Invoice**: satu per periode tertutup, satu baris per struk. Subtotal = jumlah struk. PPN dihitung di invoice hanya bila `vat_enabled` aktif dan tarif lengkap (R-04); bila PPN aktif tapi konfigurasi belum lengkap → 422 `status` dan tidak ada yang berubah. Struk ditandai `billing_status: "invoiced"` dan **tidak dapat di-void lagi** (422 `status`, perlu credit note).
- **Status invoice**: `draft` → `issued` → `handed_to_hr` → `partially_paid` → `paid`. Pembayaran hanya untuk `issued`/`handed_to_hr`/`partially_paid`; jumlah > 0 dan ≤ `amount_remaining` (422 `amount`). Saat lunas, semua struk menjadi `billing_status: "paid"`.
- Finance mencatat pembayaran HRD sebagai konfirmasi penerimaan dana. Transaksi pembayaran dan ledger `invoice_payment_in` pada akun kas besar toko dibuat atomik; referensi ledger menunjuk baris `invoice_payments`. Permission `invoice.record_payment` tersedia untuk Finance dan Admin (serta role lain yang secara eksplisit diberi izin).
- Bentuk invoice: `id, document_no (INV-YYYYMM-000001), billing_period_id, period_label, bill_to, subtotal, tax_rate, tax_amount, total, amount_paid, amount_remaining, status, issued_at, handed_at, created_at`. Semua uang string desimal.
- Kunci error 422: `status` (urutan/aturan alur), `amount`, `scheduled_close_date`.

### Layar yang bisa dibuat (urut saran, Admin)
1. Halaman "Periode tagihan": periode terbuka (jumlah struk, total, rincian per karyawan), tombol **Tutup periode** (dengan konfirmasi), ubah tanggal gaji.
2. Dari periode tertutup: tombol **Buat invoice**, lalu tampilan invoice (per karyawan, total, PPN) siap cetak (data cetak sudah lengkap di respons).
3. Tombol **Terbitkan** → **Serahkan ke HRD** → **Catat pembayaran** (riwayat pembayaran, sisa tagihan).

### ASUMSI dan batasan
- Pembayaran HRD boleh sebagian (ASUMSI lama).
- Invoice draft belum bisa dibatalkan/dibuat ulang; koreksi invoice dan credit note masuk Paket 2.
- Periode berikutnya dibuka otomatis saat tutup (label default "Periode tanggal-buka"; ubah lewat PATCH).
- Jika struk kredit tercatat tepat saat periode ditutup, struk itu masuk periode berikutnya (tidak hilang).

## 9. Pengaturan Diskon dan PPN ✅

> Status: ✅ lulus `php artisan test` (25 Okt 2026; `PricingSettingsTest` 6, total suite 190). Admin saja (Kasir 403). Tidak ada migration/permission baru.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/discounts?target_type=&active_only=1&per_page=` | `discount.manage` | Daftar diskon (terbaru dulu) |
| GET | `/api/discounts/{id}` | `discount.manage` | Detail |
| POST | `/api/discounts` | `discount.manage` | Buat: `name`, `target_type` (`product`/`category`), `target_id`, `discount_type` (`percent`/`amount`), `value`, `starts_at?`, `ends_at?` |
| PATCH | `/api/discounts/{id}` | `discount.manage` | Ubah `name`, `discount_type`, `value`, `starts_at`, `ends_at`, `is_active`. Target tidak dapat diubah (422) |
| GET | `/api/settings/vat` | `settings.manage` | `{ enabled, rate, price_includes_tax, effective_from }` |
| PUT | `/api/settings/vat` | `settings.manage` | `{ enabled, rate?, price_includes_tax? }`; `rate` dan `price_includes_tax` wajib bila `enabled` true |
| GET | `/api/settings/warehouse` | `settings.manage` | Status gudang dan daftar lokasi gudang beserta status aktifnya |
| PUT | `/api/settings/warehouse` | `settings.manage` | `{ enabled }`; mengubah flag warehouse dan status aktif lokasi Gudang secara atomik |

- Diskon: tanggal `YYYY-MM-DD` (WIB); mulai = awal hari, berakhir = akhir hari; `starts_at` kosong = mulai sekarang. `value` > 0, maks 2 desimal; persen ≤ 100. Respons memuat `target_name` dan `status` (`active` · `scheduled` · `expired` · `inactive`; tampilkan sebagai teks, bukan hanya warna). Tidak ada hapus; nonaktifkan lewat `is_active`. Di kasir, diskon terbaik yang sedang berlaku dipilih otomatis (produk vs kategori).
- PPN: default nonaktif. Mengaktifkan wajib mengisi tarif (0–100, 2 desimal) dan "harga sudah termasuk PPN". Perubahan tarif/mode membuat versi baru yang berlaku mulai hari ini (WIB); nilai yang sama tidak membuat versi baru; menonaktifkan tidak menghapus riwayat tarif. PPN aktif tapi konfigurasi tidak lengkap membuat penjualan tunai dan pembuatan invoice ditolak (R-04: tarif/PKP menunggu klien).
- Gudang: default nonaktif. Admin dapat mengaktifkan/nonaktifkan lewat `/settings/warehouse`; perubahan mengaktifkan/nonaktifkan lokasi Gudang tenant dalam transaksi dan dicatat ke audit. Menonaktifkan tidak menghapus saldo maupun riwayat stok; penerimaan dan transfer yang melibatkan Gudang tetap dibatasi oleh `warehouse_enabled`.
- Layar pengaturan yang tersedia (Admin): daftar + form diskon, pengaturan PPN, dan saklar Pengaturan Gudang dengan konfirmasi sebelum mengubah status.

## 10. Manajemen Pengguna ✅

> Status: **lulus `php artisan test` pada 26 Okt 2026** (`UserManagementTest` 10; seluruh suite 200 test, 1.729 assertions). Tidak ada migration/permission baru (`user.manage` sudah ada). Role ditentukan oleh `user_roles`, bukan username.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/users?q=&status=active\|inactive&role=&per_page=` | `user.manage` | Daftar pengguna toko aktif (urut nama) |
| GET | `/api/users/{id}` | `user.manage` | Detail |
| POST | `/api/users` | `user.manage` | Tambah: `name`, `username`, `email?`, `password` (min 8), `role` (nama role) |
| PATCH | `/api/users/{id}` | `user.manage` | Ubah `name`, `email`, `is_active`, `role`. `username` dan `password` dilarang (422) |
| POST | `/api/users/{id}/reset-password` | `user.manage` | `{ "password": "..." }` (min 8); semua sesi pengguna itu diakhiri |
| GET | `/api/roles` | `user.manage` | Daftar role untuk dropdown: `id, name, description, is_system` |
| POST | `/api/auth/change-password` | login (tanpa izin khusus) | `{ current_password, password }`; sesi lain akun itu diakhiri, sesi sekarang tetap |

- Bentuk pengguna: `{ id, name, username, email, is_active, roles: ["Kasir"], last_login_at }`. Sandi/hash tidak pernah dikembalikan maupun dicatat di audit log.
- `username`: huruf/angka/`. _ -` maks 60, unik tanpa membedakan huruf besar/kecil. `email` opsional dan unik.
- Aturan 422: akun sendiri tidak boleh dinonaktifkan atau diubah role-nya (`is_active` / `role`); toko harus punya minimal satu Admin aktif (`is_active` / `role`); sandi baru wajib beda dari sandi lama (`password`); sandi saat ini salah (`current_password`).
- Menonaktifkan pengguna mencabut semua token aktifnya dan login ditolak. Pengguna tidak dihapus.
- Satu role per pengguna per toko lewat API ini (mengganti role = menimpa).
- Layar yang bisa dibuat: daftar pengguna (cari, filter role/status), dialog tambah/ubah (dropdown dari `/api/roles`), tombol aktif/nonaktif, dialog reset sandi (Admin), dan menu "Ganti sandi" untuk semua pengguna.

## 11. Dashboard dan laporan dasar (Tahap 6.3) ✅

### Endpoint

- `GET /api/reports/dashboard`
- `GET /api/reports/sales-daily`
- `GET /api/reports/inventory`
- `GET /api/reports/cash-summary`

Semua endpoint memakai `auth:sanctum` dan `reports.view`; data dibatasi ke toko aktif dari konteks `X-Store-Id`.

### Filter periode

- `date_from` dan `date_to`: format `Y-m-d`, default masing-masing tanggal WIB hari ini.
- Rentang maksimal 365 hari dan `date_from` tidak boleh sesudah `date_to`.
- `cashier_id` hanya diterima oleh pengguna yang memiliki `shift.review`; Kasir selalu dibatasi ke pengguna itu sendiri.
- Batas tanggal dikonversi dari awal/akhir hari WIB ke UTC untuk membandingkan `posted_at`, `created_at`, dan `opened_at` yang tersimpan UTC.

### Respons ringkas

- **Penjualan harian:** jumlah transaksi, bruto, diskon, PPN, penjualan bersih, serta pemisahan tunai/kredit gaji; daftar harian menyertakan hari nol agar dashboard stabil.
- **Inventori:** produk aktif yang stoknya habis/kritis/hampir habis dan baris batch stok aktif yang mendekati atau melewati tanggal kedaluwarsa. Ambang kedaluwarsa memakai `expiry_warning_days` toko (default 30 hari) dan dapat ditimpa `expiry_days` (1–365). Parameter `include_expired=false` menyembunyikan batch kedaluwarsa.
- **Kas:** penjualan tunai dan kredit gaji, kas masuk/keluar shift, setoran tertimbang/diterima, jumlah shift, dan pergerakan kas bersih. `net_cash_movement = penjualan tunai + kas masuk - kas keluar - setoran final/submitted/diterima`.
- `fund_balances` hanya dikirim untuk pengguna dengan `shift.review`; Kasir tidak menerima saldo dana lintas kasir/toko.
- `/dashboard` menggabungkan ketiga bagian di atas. Endpoint khusus tersedia untuk layar yang hanya membutuhkan satu domain.

### Layar yang bisa dibuat

- kartu penjualan bersih dan jumlah transaksi;
- grafik penjualan harian;
- daftar stok menipis dan batch mendekati kedaluwarsa;
- ringkasan kas dan saldo akun dana;
- filter tanggal dan kasir sesuai permission;
- empty state untuk periode tanpa transaksi.

### Batasan

- Laporan bersifat baca dan tidak membuat audit log.
- Kode status penjualan dibatalkan tidak dihitung.
- PPN pada laporan mengikuti snapshot penjualan yang tersimpan; tidak melakukan kalkulasi ulang dari tarif terbaru.
- Tidak ada aggregasi lintas toko.
- Kasir hanya dapat melihat data shift miliknya, tetapi inventori tetap dibatasi pada toko aktif.

## 11.1 Laporan Laba Kotor (Backend) ✅

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/reports/profit` | `reports.profit.view` | Laba kotor berdasarkan tanggal penjualan, dipisah menjadi valid dan expected |

- HPP dihitung dari `qty × cost_snapshot` setiap baris penjualan; pendapatan memakai `line_total` setelah diskon dan sebelum PPN.
- Penjualan tunai yang terposting dihitung sebagai laba valid. Laba penjualan kredit gaji menjadi expected sampai Finance mencatat pembayaran HRD.
- Pembayaran parsial memvalidasi laba kredit secara proporsional terhadap total invoice. Nilai pembayaran yang dihitung hanya pembayaran dengan `received_at` sampai akhir tanggal `date_to`; penjualan dalam laporan tetap dibatasi pada `posted_at` di rentang tanggal.
- Respons memuat `sales_revenue`, `cost_of_goods_sold`, `total_gross_profit`, `valid_profit`, `expected_profit`, dan rincian `by_payment_mode`. Kasir tidak menerima izin `reports.profit.view`; Admin, Owner, Finance, dan Accounting mendapatkannya.
- Laporan ini mengukur laba kotor penjualan (belum mengurangi biaya operasional atau kerugian retur/write-off). Laporan baca tidak membuat audit log.
- Permission baru `reports.profit.view` memerlukan `php artisan db:seed --class=PermissionSeeder` pada instalasi yang sudah ada.

## 12. Model Administrasi Toko 🟡

> Status: 🟡 kode + `AdminModelTest` (8 test) ditulis, **belum dijalankan** (menunggu `php artisan test`). Tidak ada migration. Tidak ada permission baru; **ada 4 role sistem baru** (`Owner`, `Finance`, `Purchasing`, `Accounting`). Untuk database yang sudah ada jalankan `php artisan db:seed --class=PermissionSeeder`. Prioritas #4 (model administrasi toko) dari daftar finalisasi Paket 1.

Setiap toko memilih satu model (setting `admin_model`, default `simple` bila belum ada):

| Model | Role yang dapat ditugaskan | Pengendali toko |
|---|---|---|
| `simple` | `Admin`, `Kasir`, serta `Finance` / `Purchasing` / `Accounting` sebagai delegasi | `Admin` (memegang semua permission) |
| `standard` | `Kasir`, `Finance`, `Purchasing`, `Accounting`, `Owner` (**`Admin` tidak tersedia**) | `Owner` (persetujuan, kebijakan, pengawasan; tanpa fungsi operasional) |

Backend tetap penentu izin: menu frontend cukup mengikuti `permissions` dari `GET /api/auth/me` (sekarang juga memuat `admin_model`).

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/settings/admin-model` | `settings.manage` | Model aktif, role + jumlah akun, dan rencana peralihan (`options`) |
| PUT | `/api/settings/admin-model` | `settings.manage` | `{ "model": "standard" \| "simple", "confirm": true }` — beralih model; `confirm` wajib `true` |

`GET` (`data`): `model`, `controlling_role`, `assignable_roles[]`, `roles[]` (`name, description, assignable, total_users, active_users`), `options[]` (`model, label, current, can_switch, blockers[], conversions[]`).
- `blockers[]` = `{ code: "role_missing", role, message }`. Peralihan ke `standard` hanya bila **Kasir, Finance, Purchasing, Accounting masing-masing punya minimal satu akun AKTIF** (buat dulu lewat `POST /api/users`), dan ada pengendali aktif untuk dikonversi. Tampilkan sebagai daftar periksa.
- `conversions[]` = `{ from, to, users[] }`: **semua pemegang `Admin` otomatis menjadi `Owner`** saat ke `standard`, dan pemegang `Owner` menjadi `Admin` saat kembali ke `simple`. Tampilkan dan minta konfirmasi sebelum `PUT`.
- `PUT` gagal → 422 `errors.model` (berisi semua pesan penghalang, atau "sudah memakai model ini") / `errors.confirm`. Berhasil → `data` yang sama dengan `GET`. Sesi tetap berlaku; permission berubah seketika. Audit `settings.admin_model` (sebelum/sesudah + daftar pengguna yang dikonversi).

Dampak ke endpoint lain:
- `GET /api/roles` hanya mengembalikan role yang dapat ditugaskan pada model aktif. `POST/PATCH /api/users` dengan role di luar itu → 422 `errors.role`; mengaktifkan kembali akun yang rolenya tidak tersedia → 422 `errors.is_active` (ganti role sekaligus: boleh).
- Aturan "toko harus punya minimal satu pengendali aktif" berlaku untuk `Admin` (simple) atau `Owner` (standard). Self-protection tetap.
- Middleware baru `can.any:a,b` (lolos bila memegang salah satu permission) dipakai agar role non-Kasir dapat **membaca**: `GET /api/shifts/{id}` dan `GET /api/shifts/{id}/cash-movements` (+ `shift.review`), `GET /api/sales` dan `/api/sales/{id}` (+ `shift.review`), `GET /api/goods-receipts`, `/{id}`, dan unduh lampiran (+ `goods_receipt.verify_documents`). Data tetap dibatasi di service.

**Matriks role (ASUMSI, perlu konfirmasi klien)** — definisi tunggal di `PermissionCatalog::roles()`:

| Role | Fungsi utama |
|---|---|
| Kasir | tidak berubah (penjualan, shift, kas masuk/keluar, setoran, PR, penerimaan, transfer, ajuan adjustment) |
| Finance | tinjau shift, terima/koreksi setoran, periksa PR, verifikasi karyawan + batas kredit, usul endapan (baca kebijakan), laporan |
| Purchasing | buat/ubah produk dan kategori, supplier, buat PR, buat dan kirim PO, laporan |
| Accounting | periode tagihan + invoice HRD + pembayaran, verifikasi surat jalan/faktur, audit log, tinjau shift (baca), laporan |
| Owner | kelola pengguna/role/pengaturan, setujui PR, setujui adjustment/stok awal, pengecualian kredit, void, harga/diskon/aktivasi produk, kebijakan endapan, denah rak, audit, laporan, tinjau shift |
| Admin | semua permission (model simple) |

Catatan: `shift.review` sekaligus tanda "boleh melihat data semua kasir" (struk, laporan, shift), sehingga dipegang Owner, Finance, dan Accounting. Siapa yang boleh stok awal/penerimaan/transfer/adjustment dibuat dapat dikonfigurasi pada prioritas #5 (belum ada); sementara memakai permission yang sama seperti sebelumnya (Kasir untuk penerimaan/transfer/ajuan, `inventory.adjust.approve` untuk stok awal).

Layar yang bisa dibuat (workspace Pengaturan): kartu "Model administrasi" dengan daftar periksa akun per role (`blockers`), pratinjau konversi `Admin → Owner`, dialog konfirmasi, lalu muat ulang `/api/auth/me` supaya menu mengikuti permission baru.

## 13. Matriks Kewenangan Stok ✅

> Status: `StockAuthorityTest` dan tes workflow retur lulus. Matriks memuat 8 aturan, termasuk retur supplier per lokasi. Permission `supplier_return.create` diturunkan dari matriks; jalankan `php artisan db:seed --class=PermissionSeeder` pada database yang sudah ada agar permission tersedia.

Tiap toko menentukan **role mana** yang boleh melakukan operasi stok. Berlaku di toko mana pun: dengan/tanpa Gudang dan pada model administrasi `simple` maupun `standard`. Ada 8 aturan:

| Kunci aturan | Operasi | Permission yang diturunkan |
|---|---|---|
| `opening_balance` | Input stok awal | `inventory.opening_balance` |
| `receipt.store_floor` / `receipt.warehouse` | Penerimaan barang dari PO ke lokasi toko / gudang | `goods_receipt.create` |
| `supplier_return.store_floor` / `supplier_return.warehouse` | Retur supplier dari lokasi toko / gudang | `supplier_return.create` |
| `transfer.store_floor` / `transfer.warehouse` | Transfer/putaway; **gudang** bila lokasi asal ATAU tujuan adalah gudang | `stock_transfer.create` |
| `adjustment_approve` | Menyetujui write-off retur supplier | `inventory.adjust.approve` |

**Default** (bila belum disetel): model `simple` → stok awal `[Admin]`, penerimaan/retur/transfer `[Admin, Kasir]`, write-off retur `[Admin]`. Model `standard` → stok awal `[Owner]`, penerimaan/retur/transfer `[Kasir]`, write-off retur `[Owner]`.

**Cara kerja:** permission yang dikendalikan matriks **tidak diambil dari role_permissions**, melainkan diturunkan dari matriks ini (`PermissionResolver`). Karena itu `can:` pada route, `permissions` di `GET /api/auth/me`, dan menu frontend otomatis mengikuti. Penerimaan, retur, transfer, dan ajuan adjustment diperiksa ulang menurut **jenis lokasi** (toko/gudang); override per pengguna (`user_permissions`) tetap berlaku di atas matriks (`allow` menambah, `deny` mencabut).

### Endpoint (izin `settings.manage`)

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/settings/stock-authority` | Seluruh aturan + role yang tersedia |
| PUT | `/api/settings/stock-authority` | Ubah satu atau beberapa aturan (parsial) |

`GET` → `data`: `admin_model`, `warehouse_enabled`, `assignable_roles[]` (pilihan role untuk dropdown/checkbox), `rules[]`. Tiap aturan: `key, action, scope (store_floor|warehouse|null), permission, label, description, roles[], default_roles[], customized, active_users, applies, warnings[]`.
- `applies: false` = aturan gudang saat Gudang nonaktif (tetap bisa disetel; baru berlaku saat Gudang diaktifkan).
- `warnings[]` = `{ code: "no_active_user", message }` bila belum ada pengguna aktif pada role terpilih (operasi itu tak dapat dilakukan siapa pun). Hanya peringatan, bukan penolakan.

`PUT` body (kunci berisi titik, jadi dikirim sebagai **daftar**, bukan objek):
```json
{ "rules": [
  { "key": "opening_balance", "roles": ["Admin", "Purchasing"] },
  { "key": "receipt.warehouse", "roles": ["Purchasing"] },
  { "key": "transfer.store_floor", "roles": null }
] }
```
- `roles` = nama role (dari `assignable_roles`); `null` = kembalikan ke default model. Aturan yang tidak disebut tidak berubah. Nilai yang sama dengan default tidak disimpan.
- 422 (`errors["rules.N.key"]` atau `errors["rules.N.roles"]`): kunci tidak dikenal / ganda, `roles` kosong, role tidak tersedia pada model toko (mis. `Owner` pada `simple`, `Admin` pada `standard`). Respons sukses = bentuk `GET`. Perubahan dicatat di audit `settings.stock_authority`.
- Saat model administrasi beralih (`PUT /api/settings/admin-model`), role `Admin` ⇄ `Owner` pada aturan yang sudah disetel ikut diganti otomatis.

### Cara frontend mengambilnya
1. **Layar pengaturan** (workspace Pengaturan → "Kewenangan Stok", tampil bila `settings.manage`): `GET /api/settings/stock-authority`; tampilkan `rules` sebagai matriks (baris = aturan, kolom = `assignable_roles`, sel = checkbox dari `roles`). Kelompokkan `receipt/transfer` per `scope` ("Toko" / "Gudang"); beri label "belum berlaku" bila `applies=false`; tampilkan `warnings`; tombol "Kembalikan default" mengirim `roles: null`. Simpan dengan satu `PUT` berisi hanya aturan yang diubah, lalu pakai respons untuk menyegarkan tampilan dan **muat ulang `GET /api/auth/me`** agar menu mengikuti.
2. **Menu dan tombol di semua layar**: tetap pakai `permissions` dari `GET /api/auth/me` (mis. `supplier_return.create` untuk menu retur supplier). Untuk pilihan lokasi, `GET /api/auth/me` memuat `stock_authority` per aturan dan per lokasi.
3. **Penanganan error**: 403 pada create/post (pesan di atas) → tampilkan pesan, jangan ulangi. Ikuti `GET /api/auth/me` yang baru bila pengaturan diubah saat sesi berjalan.

Layar yang bisa dibuat: "Kewenangan Stok" di workspace Pengaturan; filter pilihan lokasi pada `/goods-receipts` dan `/inventory/transfers`; menu Stok Awal muncul bagi pemegang `inventory.opening_balance`. Adjustment langsung menggunakan akses Admin/Owner/Kasir dan tidak diatur lewat matriks lokasi.

### Perubahan lain pada tahap ini
- Route stok awal (`POST /api/inventory/opening-balances`) memakai `can:inventory.opening_balance`.
- **FR-04 (`FRONTEND_REQUESTS.md`)**: `GET /api/purchase-orders` dan detailnya kini menampilkan semua status PO dan harga/total bagi pemegang `purchase_requisition.approve` (Owner model standar) atau `purchase_order.send`, sehingga PO `pending_confirmation` terlihat untuk dikonfirmasi.
- `PermissionCatalog::roles()`: permission stok pada daftar role hanya dokumentasi; yang berlaku adalah matriks.
- ASUMSI: lingkup gudang pada transfer = lokasi asal atau tujuan adalah gudang; persetujuan adjustment tidak dibatasi lokasi; tidak ada pemisahan tugas otomatis antara pengaju dan penyetuju (hanya peringatan `no_active_user`); pembatalan dokumen mengikuti aturan pemilik dokumen yang sudah ada.

## 14. Kunci Otorisasi Owner/Admin 🟡

> Status: 🟡 kode + `AuthorizationKeyTest` (12 test) ditulis, **belum dijalankan** (menunggu `php artisan test`). **Ada 1 migration baru** (`2026_11_03_000058_create_authorization_keys_table`, tabel `authorization_keys`): jalankan `php artisan migrate`. Tidak ada permission baru. Prioritas #1 dari daftar finalisasi Paket 1.

**Keputusan desain (ASUMSI, perlu konfirmasi):** kunci **melengkapi** autentikasi ulang yang ada, tidak menghapusnya. Tiap toko memilih mode kredensial persetujuan; **default `password` = perilaku lama** sehingga tidak ada yang berubah sampai Admin/Owner mengaktifkannya.

| Mode (`approval_auth_mode`) | Yang diketik pemberi persetujuan |
|---|---|
| `password` (default) | `approver_username` + `approver_password` (seperti sebelumnya) |
| `key` | `approver_username` + `approver_key` (kunci menggantikan password) |
| `password_and_key` | `approver_username` + `approver_password` + `approver_key` |

Berlaku pada semua dialog persetujuan yang memakai re-auth: persetujuan PR, konfirmasi PO, adjustment `loss`/`expired`, dan pengecualian kredit di penjualan (`credit_exception.approver_key`). Field baru `approver_key` dikirim berdampingan dengan field yang sudah ada.

**Siapa pemegang kunci:** pengguna aktif yang memegang salah satu izin persetujuan (`purchase_requisition.approve`, `inventory.adjust.approve`, `sales.credit_exception`), jadi Owner/Admin dan siapa pun yang diberi izin itu (termasuk lewat matriks kewenangan stok). Dasarnya izin, bukan nama role.

**Dua jenis kunci:**
- `code`: tepat 6 karakter huruf kapital A–Z atau angka 0–9 (huruf kecil diterima saat mengetik dan diubah ke kapital); tidak boleh satu karakter berulang. Dapat **dibuatkan sistem** (`generate: true`; tanpa I, O, 0, 1) dan ditampilkan **sekali** di respons.
- `passphrase`: kalimat rahasia, minimal 16 karakter dan 3 kata (maks. 100), spasi dirapikan, huruf besar/kecil dibedakan.
- Kunci harus berbeda dari password akun. Hanya **hash bcrypt** yang disimpan; kunci tidak pernah dikembalikan lagi, dicatat di audit, atau terlihat oleh siapa pun (pengelola pengguna hanya dapat **mencabut**, tidak dapat melihat atau menyetel).

### Endpoint

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/authorization-key` | login | Status kunci sendiri |
| PUT | `/api/authorization-key` | pemegang izin persetujuan | Buat/ganti kunci sendiri |
| DELETE | `/api/authorization-key` | login | Hapus kunci sendiri |
| GET | `/api/authorization-keys` | `user.manage` | Daftar pemegang izin persetujuan + status kunci |
| DELETE | `/api/authorization-keys/{user}` | `user.manage` | Cabut kunci pengguna lain (`reason` wajib) |
| GET | `/api/settings/approval-auth` | `settings.manage` | Mode saat ini, pilihan mode + penghalang, daftar pemegang |
| PUT | `/api/settings/approval-auth` | `settings.manage` | Ganti mode |

- **GET status** (`data`): `eligible` (boleh punya kunci), `has_key`, `type` (`code|passphrase|null`), `locked`, `created_at`, `rotated_at`, `last_used_at`, `mode`. Hash tidak pernah dikirim.
- **PUT sendiri**: `{ "current_password": "...", "type": "code", "key": "AB12CD" }` atau `{ "current_password": "...", "type": "code", "generate": true }` → `data` = status; bila dibuatkan sistem ada `generated_key` (simpan/tampilkan **sekali**; tidak dapat diambil lagi). Mengganti kunci lama = rotasi (`rotated_at` terisi, kunci lama langsung tak berlaku) dan **membuka kunci yang terkunci**. 403 bila bukan pemegang izin persetujuan. 422: `current_password` (salah / terlalu banyak percobaan), `key` (aturan format), `generate`, `type`.
- **DELETE sendiri**: body `{ "current_password": "..." }`. 422 `key` bila belum punya kunci, atau bila mode `key`/`password_and_key` dan ini kunci aktif terakhir.
- **Cabut oleh pengelola**: body `{ "reason": "kunci dicurigai bocor" }` → daftar pemegang terbaru. 422 `user` bila mencabut diri sendiri (pakai DELETE sendiri) atau pengguna tidak punya kunci; 422 `key` bila mencabutnya meninggalkan nol kunci aktif pada mode kunci. Tercatat di audit.
- **Mode**: `GET` → `data`: `mode`, `modes[]` (`mode, label, can_switch, blockers[]`), `holders[]`. `blockers[]` = `{ code: key_missing|key_locked|no_approver, user_id, username, message }`: beralih ke `key`/`password_and_key` hanya bila **setiap pemegang aktif sudah punya kunci yang tidak terkunci**. `PUT { "mode": "key", "current_password": "..." }` → `data` yang sama dengan GET. 422 `mode` (penghalang / sudah memakai mode itu) atau `current_password`. Audit `settings.approval_auth`. Pengguna baru yang kelak memegang izin persetujuan (mis. ganti role) belum punya kunci: ia perlu menyetelnya sendiri sebelum dapat menyetujui pada mode kunci.

### Perilaku saat persetujuan
- Field wajib mengikuti mode; kurang → 422 `approver_password` atau `approver_key` (pesan "diperlukan"). Kunci/sandi salah, akun tidak berwenang, atau akun tidak punya kunci → 422 generik "Kredensial persetujuan tidak valid atau tidak berwenang." pada `approver_password` (mode `password`) atau `approver_key` (mode lain), tanpa membedakan penyebab.
- Pembatas laju per username tetap: 5 percobaan salah / 5 menit (pesan "Terlalu banyak percobaan"). Selain itu **penghitung permanen**: 10 kunci salah berturut-turut **mengunci kunci** (`locked: true`, audit `authorization_key.locked`) sampai pemilik menyetel ulang (PUT dengan password) atau kunci dicabut; kunci benar pun ditolak saat terkunci. Berhasil mengosongkan penghitung.
- Audit `auth.reauth_ok` / `auth.reauth_failed` kini memuat `method` (`password|key|password_and_key`); kunci tidak pernah ditulis.
- `GET /api/auth/me` kini memuat `approval_auth_mode` dan `authorization_key` (`eligible, has_key, type, locked`).

### Cara frontend memakainya
1. **Dialog persetujuan** (PR, PO, adjustment loss/expired, pengecualian kredit): baca `approval_auth_mode` dari `GET /api/auth/me`. `password` → username + password; `key` → username + kolom "Kunci otorisasi"; `password_and_key` → ketiganya. Kirim isian kunci sebagai `approver_key`. Tampilkan error pada kolom sesuai kuncinya (`approver_password` / `approver_key`). Kolom kunci jenis `code` boleh dimasked dan otomatis huruf kapital.
2. **Profil → "Kunci otorisasi"** (tampil bila `authorization_key.eligible`): `GET /api/authorization-key`; form pilih jenis (kode 6 karakter / kalimat rahasia), opsi "Buatkan kode", dan password akun. Tampilkan `generated_key` satu kali dengan peringatan "tidak dapat dilihat lagi"; tampilkan peringatan jika `locked`.
3. **Pengaturan → "Otorisasi persetujuan"** (`settings.manage`): `GET /api/settings/approval-auth`; tampilkan tiga mode, daftar periksa `blockers`, dan daftar `holders` dengan tombol "Cabut kunci" (`user.manage`, minta alasan). Ganti mode butuh password akun; setelah berhasil muat ulang `/api/auth/me`.

ASUMSI: kunci per pengguna (bukan satu kunci bersama toko) agar dapat diaudit dan dicabut per orang; hash bcrypt dengan penguncian permanen dianggap cukup untuk kode 6 karakter; DELETE membawa body JSON (bila proxy membuang body DELETE, ubah ke POST).

## 15. Retur Supplier dan Write-off ✅

Migration awal: `2026_11_04_000059_create_supplier_returns_tables.php`; migration alur baru: `2026_11_05_000069_add_supplier_return_workflows.php`. Jalankan `php artisan migrate`; pada database yang belum memiliki permission retur, jalankan `php artisan db:seed --class=PermissionSeeder`.

Validasi terarah terbaru: `GoodsReceiptTest` 23 lulus (267 assertions), `SupplierReturnTest` 8 lulus (78 assertions), dan `PurchaseOrderTest` 19 lulus (184 assertions).

Retur Barang ditampilkan sebagai satu daftar di frontend. Backend tetap menyimpan `return_type` untuk membedakan alur stok yang sudah berjalan:

- **Barang rusak dari penerimaan PO** otomatis dibuat sebagai retur supplier berstatus Draft di transaksi final penerimaan. Satu PO hanya menghasilkan satu GR; jumlah masuk dihitung dari sisa PO dikurangi barang rusak dan jumlah tidak dikirim. Barang rusak dihitung dalam kuantitas PO yang diterima dan masuk bucket karantina. GR langsung diposting secara internal, tanpa field `status` pada respons API; PO ditutup dan tidak lagi ditawarkan ke daftar penerimaan. Dokumen retur tertaut pada GR, baris penerimaan, supplier, HPP, dan jumlah rusak.
- **Retur stok** dimulai dari pilihan produk di master. Kuantitas stok dialokasikan di backend ke lokasi/batch yang tersedia lalu dikarantina saat retur dikirim; supplier harus sama untuk seluruh dokumen. Barang pengganti menghasilkan GR terpisah untuk setiap PO asal; pemrosesan penerimaannya menambah stok dan menyelesaikan retur tanpa menambahkan ulang kuantitas penerimaan PO asal. Jika PO asal tidak dapat ditelusuri, backend menolak membuat GR pengganti secara eksplisit.

Alur Retur Keluar: `draft` → `submitted` → `accepted` → GR pengganti `draft` → `replacement_received` setelah seluruh GR diposting, atau `draft` → `submitted` → `rejected` → `written_off`. Penolakan supplier tetap mengarantina barang hingga pemegang `inventory.adjust.approve` menyetujui write-off dengan autentikasi ulang Owner/Admin. HPP retur disnapshot dari `products.unit_cost`; write-off mencatat nilai kerugian dan movement `write_off`.

Retur kerusakan penerimaan berlanjut setelah supplier merespons: `draft` → `submitted` → `replacement_received` atau `rejected`. Keputusan hanya dapat dicatat setelah GR asal diposting. Jika diterima, barang karantina asal dikeluarkan dari karantina, barang pengganti langsung ditambahkan ke stok dengan movement `supplier_replacement_in`, dan kuantitas penerimaan PO tidak berubah. Baris retur menyimpan tautan batch karantina untuk pengeluaran yang tepat; tanggal kedaluwarsa dan kode batch pengganti mengikuti data baris GR asal. Jika ditolak, nilai kerugian dihitung dari HPP snapshot × jumlah retur dan disimpan pada `loss_amount`; barang karantina tetap ada dan tidak otomatis dihapus atau dijual.

### Endpoint (`auth:sanctum`)

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/supplier-returns` | `supplier_return.create` atau `inventory.adjust.approve` | Daftar; filter `status`, `supplier_id`, awalan nomor `q`, `per_page` |
| POST | `/api/supplier-returns` | `supplier_return.create` | Buat draft |
| GET | `/api/supplier-returns/{id}` | `supplier_return.create` atau `inventory.adjust.approve` | Detail |
| POST | `/api/supplier-returns/{id}/submit` | `supplier_return.create` | Retur Keluar memvalidasi stok terbaru dan memindahkan item ke karantina; Retur Masuk menandai dokumen sudah dikirim selama GR masih draft |
| POST | `/api/supplier-returns/{id}/merge` | `supplier_return.create` | Tambahkan produk ke draft Retur Keluar; supplier harus sama, status harus `draft`, dan stok dialokasikan rusak lebih dulu |
| POST | `/api/supplier-returns/{id}/supplier-decision` | `supplier_return.create` | Catat `{ "decision": "accept|reject", "note": "..." }`; alasan wajib untuk reject. Retur Masuk hanya setelah GR diposting: accept memasukkan pengganti ke stok dan mengeluarkan barang karantina, reject mencatat kerugian HPP dan mempertahankan karantina |
| POST | `/api/supplier-returns/{id}/replacement-receipt` | `supplier_return.create` | Buat GR pengganti draft per PO asal; isi `items[]` dengan `return_item_id`, `expiry_date?`, `batch_code?`, `shelf_position_id?` |
| POST | `/api/supplier-returns/{id}/write-off` | `inventory.adjust.approve` | Persetujuan Owner/Admin; wajib `approver_username` dan kredensial sesuai mode autentikasi ulang |
| POST | `/api/supplier-returns/{id}/cancel` | `supplier_return.create` | Batalkan draft |

Body buat Retur Keluar: `supplier_id`, `items[]` (`product_id`, `qty`, `source_bucket?` = `sellable|damaged`), `note?`; tanpa `source_bucket`, server otomatis mengalokasikan stok rusak lebih dulu lalu stok layak jual ke lokasi/batch yang tersedia. Body gabung draft: `items[]` (`product_id`, `qty`), tanpa mengubah catatan draft. Hanya draft Retur Keluar milik toko aktif yang dapat diubah; produk harus terhubung dengan supplier draft dan kuantitas stok dicek serta dikunci atomik. Body Retur Masuk: `return_type: "incoming"`, `supplier_id`, `goods_receipt_id`, `invoice_no?`, `note?`, dan `items[]` (`goods_receipt_item_id`, `disposition: "direct_return"|"quarantine"`). Daftar retur memuat `return_type`, relasi GR, faktur, dan disposisi. Produk dan supplier harus milik toko aktif; lingkup toko/gudang diperiksa saat tindakan terkait.

Respons detail memuat `doc_number` (`RET-000001`), `return_type`, supplier, status, waktu submit/keputusan, catatan, faktur, `loss_amount` (string uang/null), approver, relasi GR dan `items[]` termasuk lokasi, batch, qty, HPP snapshot, disposisi, serta GR pengganti. Draft tidak mengubah stok; submit gagal 422 jika stok berubah/tidak cukup atau detail GR tidak cocok. Aksi penting dicatat pada audit log.

## 16. Ubah Nama Toko oleh Pengguna Retail

Pengguna toko dengan izin `settings.manage` dapat memperbarui nama toko aktifnya. Endpoint khusus ini tidak mengekspos baca detail toko dan menolak semua field selain nama. Pembuatan, pembacaan, dan perubahan status tenant tetap hanya melalui Management Retail untuk operator platform; tidak ada operasi hapus.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| PATCH | `/api/settings/store-name` | `settings.manage` | Ubah nama toko aktif dengan `{ "name": "Nama Toko Baru" }`; panjang maksimum 150 karakter |

Respons hanya `{ "data": { "name": "Nama Toko Baru" } }`. Perubahan dicatat di audit `settings.store_name`. Tidak ada migration atau permission baru.

## 17. Pemantauan Stok dan PR Otomatis ✅

PR draft otomatis dibuat dan disinkronkan backend ketika stok berubah, ambang pengaturan berubah, atau kuantitas pengisian ulang master produk berubah. Nilai stok yang dipantau adalah jumlah `qty_sellable` seluruh lokasi toko; hanya produk berstatus `active` yang dimasukkan. Produk terdeteksi menipis saat stok ≤ ambang. Nilai ambang default `3.000`; jumlah pembelian memakai `restock_quantity` pada master produk. Produk dengan `restock_quantity` nol tidak dimasukkan.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/settings/inventory/stock-monitoring` | `settings.manage` | Baca `low_stock_threshold` |
| PUT | `/api/settings/inventory/stock-monitoring` | `settings.manage` | Ubah `low_stock_threshold` (qty 0–99.999, maks. 3 desimal) |

`low_stock_threshold` dikirim sebagai string qty (contoh `"3.000"`). Pada data produk, `restock_quantity` diterima di `POST /api/products` dan `PATCH /api/products/{id}`, serta dikembalikan pada daftar/detail produk. Field ini qty desimal (maks. 99.999, 3 desimal), default `"0.000"` untuk kompatibilitas produk lama.

Satu PR otomatis draft per toko memuat setiap produk menipis dengan kuantitas pengisian ulang produk. `est_price` diambil dari `unit_cost` master dan dibulatkan 2 desimal sesuai skema harga estimasi PR; `est_total` dihitung ulang atomik. Draft diperbarui saat stok/Harga Modal/master/ambang berubah; baris yang tidak lagi memenuhi kriteria dihapus dan draft kosong dibatalkan sistem. Produk yang sudah tercakup PR yang menunggu proses atau PO aktif tidak diminta ulang.

Kasir dapat melihat PR otomatis dan meneruskannya (`POST /api/purchase-requisitions/{id}/submit`). Bila PR otomatis dikembalikan, Kasir dapat menunda baris barang tertentu melalui `POST /api/purchase-requisitions/{pr}/items/{item}/defer`; endpoint hanya menerima PR otomatis berstatus `returned`, memindahkan baris beserta qty/harganya ke draft otomatis berikutnya, dan menghitung ulang total kedua PR secara atomik. Baris yang tersisa tetap dapat diajukan ulang; bila semua baris ditunda, PR kosong lama ditandai `cancelled`. Aksi dicatat di audit log. Data PR otomatis tidak dapat dibuat manual, diedit, atau dibatalkan oleh Kasir. PR manual tetap tersedia untuk Admin/Purchasing. Setelah diajukan, PR otomatis tidak berubah; deteksi berikutnya membuat draft baru untuk barang yang belum tercakup dokumen pembelian aktif.

Sinkronisasi dipanggil atomik dari stok awal, penjualan/void, penerimaan barang, adjustment/opname, retur supplier/pengganti, serta perubahan produk dan pengaturan. Validasi sebelumnya mencakup 122 test/1.158 assertions pada rangkaian pembelian dan stok. Validasi fitur tunda PR: `PurchaseRequisitionTest` dan `StockMonitoringTest` lulus 18 test/188 assertions; Pint lulus untuk file PHP terkait.

## Perubahan lain yang memengaruhi frontend
- `routes/api.php` kini memuat `routes/api/inventory.php`, `routes/api/customers.php`, `routes/api/pos.php`, `routes/api/billing.php`, `routes/api/reports.php`; URL lama tidak berubah.
- Tidak ada permission baru dan tidak ada migration baru pada tahap 2.7. Stok awal tetap memakai `inventory.adjust.approve` (ASUMSI sampai ada permission khusus).

## Riwayat
- **2026-11-07** — Penerimaan PO menjadi final dan sekali saja: server menghitung jumlah diterima dari sisa PO dikurangi barang rusak/tidak dikirim, memposting stok, menutup PO, dan membuat retur karantina untuk barang rusak dalam transaksi atomik. API daftar/detail GR tidak mengirim `status`; GR hanya memuat status verifikasi dokumen. Tes `GoodsReceiptTest` (23/267), `SupplierReturnTest` (8/78), dan `PurchaseOrderTest` (19/184) lulus.
- **2026-11-04** — Alur PR/PO disederhanakan menjadi Finance pass → create PO atomik (pilih rekening, reservasi dana, satu otorisasi Owner) → cetak lalu konfirmasi kirim. Tes `PurchaseOrderTest` + `PurchaseRequisitionTest`: 31 lulus; Pint lulus.
- **2026-11-04** — Pemantauan stok per toko dengan ambang default 3.000, field `restock_quantity` di master produk, dan satu PR otomatis dinamis yang menghitung estimasi HPP/total; sinkronisasi atomik pada perubahan stok/master/setting, sementara Kasir hanya dapat meneruskan PR otomatis. Migration 000065. Validasi terarah 122 test (1.158 assertions) dan Pint lulus.
- **2026-11-04** — Field HPP master disederhanakan menjadi `unit_cost` tunggal (`DECIMAL(18,4)`), diisi wajib saat produk dibuat, dapat dikoreksi Admin melalui edit, dan diganti dengan biaya terbaru saat penerimaan/stok masuk memiliki biaya. `last_cost` dihapus; snapshot biaya transaksi tetap disimpan. Label UI untuk nilai produk adalah **Harga Modal**; form stok awal diberi nama **Stok Eksisting Toko**. Migration 000066. Tes backend terarah 113/113 (1.051 assertions) dan Pint lulus.
- **2026-11-05** — Relasi produk–supplier banyak-ke-banyak ditambahkan. Supplier wajib dipilih saat membuat produk, relasi produk lama dapat diperbarui, daftar/detail produk mengembalikan supplier, dan pembuatan/perubahan PO memvalidasi bahwa setiap item memang berasal dari supplier PO tersebut. Daftar item PR untuk PO mengembalikan supplier aktif yang terkait. Migration 000068.
- **2026-11-05** — Validasi relasi supplier produk/PO lulus pada 40 tes `ProductTest` dan `PurchaseOrderTest` (331 assertions); Pint lulus.
- **2026-11-03** — Alokasi Kas Pembelian untuk PO: ledger rekening bank manual, saldo awal/penyesuaian ber-audit, alokasi penuh berdasarkan nilai PO, saldo tersedia dikurangi pencadangan tanpa mengklaim transfer bank, dan pelepasan alokasi saat PO dibatalkan atau nilainya berubah. Setiap PO kini menunggu konfirmasi Owner setelah dana dicadangkan. Rekening dimasking di endpoint; Finance diberi permission kelola/alokasi, Owner melihat, Admin mewarisi semua. `PurchaseOrderTest` (17) dan `GoodsReceiptTest` (16) lulus; suite penuh 294/297 dengan tiga kegagalan di test lama yang tidak terkait. Pint file baru lulus. Migrasi 000060 dan PermissionSeeder perlu dijalankan pada database existing.
- **2026-11-02** — Laporan laba kotor `GET /api/reports/profit` memakai `line_total` dan HPP snapshot per item; penjualan kredit dipisah expected/valid dan pembayaran parsial Finance mengakui laba secara proporsional. Pencatatan pembayaran HRD kini masuk atomik ke ledger akun `main_cash`. Permission baru `reports.profit.view` untuk Admin, Owner, Finance, dan Accounting; `BillingTest` 11 lulus dan tes profit terarah 1 lulus.
- **2026-11-02** — Endpoint Retail `PATCH /api/settings/store-name` hanya mengizinkan perubahan `name` (maks. 150 karakter), izin `settings.manage`, konteks toko aktif, dan audit `settings.store_name`; request menolak field toko lain. Tidak menambahkan endpoint read/create/delete atau perubahan atribut lain. `StoreNameSettingTest`: 3 test lulus.
- **2026-11-03** — Prioritas #1: kunci otorisasi Owner/Admin (kode 6 karakter kapital atau kalimat rahasia), CRUD mandiri + pencabutan oleh pengelola, mode kredensial persetujuan per toko (`password` default / `key` / `password_and_key`) pada semua dialog re-auth (`approver_key`), penguncian permanen setelah 10 gagal, audit tanpa kunci, `approval_auth_mode` dan `authorization_key` pada `/api/auth/me`. Migration `authorization_keys` baru. Status: 🟡 menunggu test (`AuthorizationKeyTest` 12). Bagian 14.
- **2026-11-02** — Retur supplier (Paket 3): draft/pengajuan dan karantina stok, keputusan supplier, penerimaan barang pengganti, serta write-off bernilai HPP setelah ditolak supplier dengan re-auth `inventory.adjust.approve`. Akses pengajuan/keputusan/penerimaan dikendalikan matriks stok (aturan kini 10). Migration, permission, endpoint, dan tes feature baru; kontrak bagian 15.
- **2026-11-02** — Prioritas #5: matriks kewenangan stok per toko (stok awal, penerimaan, transfer, ajuan adjustment per lokasi toko/gudang, persetujuan adjustment), permission baru `inventory.opening_balance`, permission stok diturunkan dari matriks oleh `PermissionResolver`, pemeriksaan lingkup lokasi di service, `stock_authority` pada `/api/auth/me`, remap Admin⇄Owner saat ganti model; FR-04 (Owner melihat PO `pending_confirmation` + harga). Bagian 13.
- **2026-11-01** — Prioritas #4: model administrasi toko (`simple` / `standard`), 4 role baru (Owner, Finance, Purchasing, Accounting), peralihan dengan validasi akun per role + konversi Admin↔Owner, filter role pada `/api/roles` dan `/api/users`, middleware `can.any`, `admin_model` pada `/api/auth/me`. Status: 🟡 menunggu test (`AdminModelTest` 8; `SeederTest` dan `UserManagementTest` disesuaikan dengan daftar role baru). Bagian 12.
- **2026-10-31** — Management Retail: API tenant yang sudah ada kini terhubung ke layar operator `/platform/stores`; login dan `/auth/me` mengarahkan operator global tanpa toko. CLI recovery memilih operator aktif berdasarkan ID (termasuk saat username terlupa), mengubah username/password, mencabut token lama, dan mencatat audit tanpa menyimpan password; UI login memberi instruksi recovery CLI tanpa endpoint publik. `PlatformStoreManagementTest` 7 lulus.
- **2026-10-31** — Command `platform:operator-login` meminta kredensial operator secara interaktif dan membuka UI daftar tenant. Handoff browser memakai tiket satu kali/5 menit, exchange endpoint ber-rate-limit, fragment URL yang dibersihkan frontend, dan audit login; password/token API tidak dimasukkan ke URL. Log diagnostik exchange gagal hanya mencatat alasan aman, ID operator dan kedaluwarsa, tanpa tiket/password. Test login/tiket termasuk kedaluwarsa/pencabutan: 10 lulus (107 assertions).
- **2026-10-30** — Management Retail: operator platform terpisah dari RBAC toko; bootstrap operator via CLI interaktif; onboarding tenant atomik bersama akun Admin awal dan konfigurasi default; daftar/detail tenant serta aktivasi/nonaktivasi dengan audit tanpa penghapusan data. `PlatformStoreManagementTest` 6 lulus; Auth/Seeder/RBAC 18 lulus; Pint lulus. Suite penuh: 243 lulus, 1 gagal pada fixture kedaluwarsa `ReportTest` (juga gagal tersendiri; tidak berkaitan dengan Management Retail).
- **2026-10-28** — FR-01: endpoint `POST /api/sales/preview` read-only dengan paritas perhitungan posting, diskon/PPN, batas kredit, dan stok FEFO. `SalePreviewTest` 5 lulus; mekanisme tidak menulis sale, payment, stok, ledger, idempotensi, atau audit. Kontrak lengkap di bagian 5.
- **2026-10-28** — FR-02: daftar/detail antrean setoran mengizinkan `cash_deposit.create` atau `cash_deposit.receive`; pemegang `receive` dapat membaca semua shift tanpa mendapat hak membuat/menyerahkan setoran. `CashDepositTest` 16 lulus, termasuk Finance receive-only dan penolakan tanpa kedua izin. Suite `php artisan test`: **238 lulus (2.129 assertions)**.
- **2026-10-28** — Tahap 6.3: endpoint dashboard/laporan backend untuk penjualan harian, inventori menipis/kedaluwarsa, dan ringkasan kas. Filter tanggal WIB, 365 hari, toko aktif, pembatasan kasir, serta respons dashboard gabungan. `ReportTest` **3 lulus**; suite saat tahap selesai: **231 lulus (2.058 assertions)**.
- **2026-10-27** — Tahap 4.5: upload lampiran GR (JPEG/PNG/WebP/PDF, maks. 10 MB), penyimpanan privat, download dengan pemeriksaan akses pemilik/approver, metadata pada detail, audit, dan penutupan upload setelah dokumen diverifikasi atau GR dibatalkan. `GoodsReceiptTest` **16 lulus**; suite `php artisan test`: **228 lulus (2.019 assertions)**; Pint lulus.
- **2026-10-27** — Tahap 4.4: Goods Receipt dapat diarahkan ke lokasi gudang aktif ketika `warehouse_enabled=true`, dengan opsi posisi rak per item; pilihan lokasi disediakan endpoint khusus dan konfigurasi/lokasi divalidasi ulang saat draft diposting. Uji jalur gudang, posisi, mode mati, dan regresi: `GoodsReceiptTest` **12 lulus**; suite `php artisan test`: **224 lulus (1.978 assertions)**; Pint dan typecheck frontend lulus.
- **2026-10-27** — Akses baca adjustment diselaraskan untuk role approver: pemegang `inventory.adjust.approve` dapat membaca antrean dan detail tanpa `inventory.adjust.request`; test akses ditambahkan. `StockAdjustmentTest`: **9 lulus**; suite `php artisan test`: **223 lulus (1.953 assertions)**.
- **2026-10-27** — Akses baca alur purchasing diselaraskan untuk konfigurasi role terpisah: Finance/Owner/Purchasing dapat membaca antrean PR sesuai permission; pemegang `purchase_requisition.approve`/`purchase_order.send` dapat membaca PO yang perlu diproses; pemegang `purchase_order.create` dapat membaca supplier untuk membuat PO. Test akses ditambahkan. `php artisan test`: **222 lulus (1.946 assertions)**.
- **2026-10-27** — Tahap 2.7 (adjustment/opname) ditambahkan: draft dan snapshot stok, pengajuan, persetujuan/re-auth kondisional, penolakan/pembatalan, pemeriksaan snapshot untuk mencegah posting hitung-stok kedaluwarsa, movement dan audit atomik. Implementasi awal `StockAdjustmentTest` memiliki 8 test (85 assertions); suite saat itu **218 test lulus (1.922 assertions)**; bagian 1 kini ✅.
- **2026-10-27** — Tahap 2.6 (transfer stok) ditambahkan: draft, validasi posisi/lokasi dan setting gudang, posting saldo atomik dengan pasangan movement, pembatalan draft, dan audit. **210 test lulus (1.837 assertions)**; bagian 1 kini ✅.
- **2026-10-26** — Tahap 3.6 (kas masuk/keluar nonpenjualan) ditambahkan: API pencatatan dan riwayat per shift, pembatasan akses pemilik shift, update ledger Kas Kecil, dan audit. **204 test lulus (1.764 assertions)**; bagian 7.4 kini ✅.
- **2026-10-26** — Pengguna menjalankan seluruh suite: **200 test lulus (1.729 assertions)**. Bagian 10 (Manajemen Pengguna) kini ✅.
- **2026-10-25 (4)** — WS-G: manajemen pengguna (CRUD, aktif/nonaktif, reset sandi, ganti sandi sendiri). Status: 🟡 menunggu test (`UserManagementTest`).
- **2026-10-25 (3)** — Suite dijalankan pengguna: **190 test lulus**. Bagian 9 (diskon dan PPN) kini ✅.
- **2026-10-25 (2)** — WS-F: pengaturan diskon (CRUD, Admin) dan PPN (saklar + tarif berversi). Status: 🟡 menunggu test (`PricingSettingsTest`).
- **2026-10-25** — Seluruh suite dijalankan pengguna: **184 test lulus**. Bagian 8 (Tagihan HRD) kini ✅.
- **2026-10-24 (4)** — WS-E: Tagihan HRD — periode (buka/ubah/tutup), invoice gabungan per periode dengan rincian per karyawan dan PPN opsional, terbit/serah ke HRD, pembayaran HRD (boleh sebagian). Status: 🟡 menunggu test (`BillingTest`).
- **2026-10-24 (uji 2)** — Pengguna menjalankan seluruh suite: **174 test lulus (1.333 assertion)**. Bagian 7 (setoran, endapan, void) kini ✅. Tagihan HRD belum ada kode di repo (percobaan sebelumnya terputus).
- **2026-10-24 (3)** — WS-D lanjutan: kebijakan endapan berversi, setoran akhir (otomatis saat tutup shift) dan parsial, penerimaan Finance + selisih/koreksi, saldo dana dari ledger; void penjualan (Admin). `ShiftService` kini memanggil `CashDepositService` (respons tutup shift menambah `deposit`/`float_flags`). Status: 🟡 menunggu test (`CashDepositTest`, `SaleVoidTest`).
- **2026-10-24 (uji)** — Pengguna menjalankan seluruh suite: **154 test lulus (1.080 assertion)**. Semua bagian 1–6 berstatus ✅.
- **2026-10-24** — WS-C: pembelian lengkap — PR (draft, ajukan, periksa Finance, persetujuan Owner dengan autentikasi ulang, tanda swa-persetujuan), PO (dari PR, otomatis/konfirmasi Owner, kirim, batal, tutup), penerimaan barang (posting menambah stok lewat `InventoryService::receive`, selisih/rusak, verifikasi surat jalan + faktur). Status: ✅ lulus test (24 Okt 2026).
- **2026-10-23 (2)** — WS-D: shift (buka/hitung/tutup/tinjau, hitung buta, saldo awal = endapan sebelumnya) dan posting penjualan (tunai + kredit, FEFO, diskon Admin, PPN opsional, batas kredit + pengecualian Admin, idempotensi, riwayat, cetak ulang SALINAN). Status: ✅ lulus test (24 Okt 2026).
- **2026-10-23** — WS-B: `InventoryService` (saldo, pergerakan, batch, FEFO, anti-negatif, HPP rata-rata bergerak), stok awal, lihat stok per batch, riwayat pergerakan. WS-A: data karyawan (input Kasir, verifikasi dan batas oleh Admin), notifikasi `customer.limit_needed`. Status: ✅ lulus test (24 Okt 2026).
- **sebelumnya** — Auth + RBAC ✅, kategori ✅, supplier ✅, produk (+harga, barcode otomatis, status stok) ✅. Detail kontraknya ada di `HANDOFF_POS_RETAIL_SMK.md` bagian 6.
