# Progres Backend → untuk Agent Frontend

**Satu-satunya berkas progres backend.** Setiap pekerjaan backend baru ditambahkan di sini (entri terbaru di atas bagian "Riwayat"), agar agent frontend tahu fitur mana yang sudah bisa dibuatkan UI-nya. Agent baru cukup membaca berkas ini + `HANDOFF_POS_RETAIL_SMK.md`.

**Diperbarui:** 27 Oktober 2026 · **Test terbaru:** `php artisan test` — **218 lulus (1.922 assertions)** · **Dikerjakan:** WS-B (Inventory inti, transfer, adjustment/opname), WS-A (Data karyawan + notifikasi), WS-D (Shift + Penjualan + kas nonpenjualan), WS-C (Pembelian), WS-F (Diskon dan PPN), WS-G (Manajemen Pengguna)

> **Untuk layar kasir (POS):** baca bagian 4 (Shift) dan 5 (Penjualan) dulu. Urutan alur kasir: `GET /api/shifts/current` → (bila `data` null) `POST /api/shifts/open` → cari produk (`GET /api/products/by-barcode/...`) → `POST /api/sales`.

## Cara membaca status

| Tanda | Arti |
|---|---|
| ✅ Lolos | `php artisan test` sudah dijalankan dan hijau (terakhir 27 Okt 2026: 218 test lulus) |
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

## 1. Inventory ✅

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/inventory/products/{product}/stock` | `inventory.view` | Stok satu produk per batch/posisi + total |
| GET | `/api/inventory/movements` | `inventory.view` | Riwayat pergerakan stok (terbaru dulu) |
| POST | `/api/inventory/opening-balances` | `inventory.adjust.approve` (Admin) | **Stok awal** (satu dokumen, banyak baris, atomik) |
| GET | `/api/inventory/transfers` | `stock_transfer.create` | Daftar/filter dokumen transfer |
| POST | `/api/inventory/transfers` | `stock_transfer.create` | Buat draft transfer stok |
| GET | `/api/inventory/transfers/{id}` | `stock_transfer.create` | Detail draft/posted/cancelled |
| POST | `/api/inventory/transfers/{id}/post` | `stock_transfer.create` | Posting atomik dan memindahkan saldo |
| POST | `/api/inventory/transfers/{id}/cancel` | `stock_transfer.create` | Batalkan draft (opsional `reason`) |
| GET | `/api/inventory/adjustments` | `inventory.adjust.request` | Daftar adjustment/opname yang diizinkan untuk pengguna |
| POST | `/api/inventory/adjustments` | `inventory.adjust.request` | Buat draft adjustment/opname dengan snapshot saldo |
| GET | `/api/inventory/adjustments/{id}` | `inventory.adjust.request` | Detail dokumen |
| POST | `/api/inventory/adjustments/{id}/request` | `inventory.adjust.request` | Ajukan draft untuk persetujuan |
| POST | `/api/inventory/adjustments/{id}/approve` | `inventory.adjust.approve` | Setujui dan posting atomik, atau tolak dengan alasan |
| POST | `/api/inventory/adjustments/{id}/cancel` | `inventory.adjust.request` | Batalkan draft/permintaan sebelum posting |

Daftar produk (`GET /api/products`) sudah memuat `stock_sellable` dan `stock_status`; angka itu kini terisi dari saldo nyata.

### POST `/api/inventory/opening-balances` — layar "Stok Awal" (Admin)

Permintaan:
```json
{
  "note": "Stok awal cut-over",
  "items": [
    { "product_id": 12, "qty": "24", "unit_cost": "2000", "expiry_date": "2027-03-01", "batch_code": "L1" },
    { "product_id": 15, "qty": "10.5", "unit_cost": "1000" }
  ]
}
```
- `items`: 1–200 baris. `qty` wajib, > 0, maks 3 desimal. `unit_cost` opsional (isi agar HPP terbentuk), maks 4 desimal. `expiry_date` opsional (`YYYY-MM-DD`; stok awal boleh tanpa tanggal, produk `track_expiry` pun). `batch_code`, `shelf_position_id` opsional.
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
    "track_expiry": true, "avg_cost": "2000.0000",
    "totals": { "qty_sellable": "24.000", "qty_quarantine": "0.000", "qty_damaged": "0.000" },
    "batches": [
      { "balance_id": 5, "batch_id": 7, "batch_code": "L1", "expiry_date": "2027-03-01",
        "expiry_status": "ok", "is_opening": true, "received_at": "2026-10-23 03:15:00.123",
        "location_id": 1, "shelf_position_id": null,
        "qty_sellable": "24.000", "qty_quarantine": "0.000", "qty_damaged": "0.000" } ] } }
```
- `expiry_status`: `none` (tanpa tanggal) · `ok` · `near_expiry` (≤ ambang, default 30 hari) · `expired`. Gunakan untuk lencana warna **sekaligus teks** (jangan hanya warna).
- Urutan array = urutan FEFO (yang akan dijual lebih dulu di atas). Kasir **tidak** memilih batch.
- `avg_cost` (HPP) sensitif secara bisnis; tampilkan hanya di layar Admin.

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

### Adjustment dan opname (tahap 2.7) ✅

Semua endpoint memakai permission `inventory.adjust.request`, kecuali approve/reject yang memakai `inventory.adjust.approve`. Kasir hanya dapat melihat dokumen yang dia ajukan; pemegang permission approve dapat melihat semua dokumen di tokonya.

`POST /api/inventory/adjustments` menerima draft:
```json
{
  "reason": "opname",
  "note": "Hitung stok rak A",
  "items": [
    { "product_id": 12, "batch_id": 7, "location_id": 1, "shelf_position_id": 3, "qty_counted": "5" }
  ]
}
```
- `reason`: `opname|loss|damage|expired|other`. `items`: 1–200 baris; `qty_counted` wajib nonnegatif, maksimal 3 desimal. Batch dan posisi opsional; lokasi wajib aktif dan milik toko yang sama. Batch harus milik produk, posisi (jika ada) harus berada di lokasi. Batch wajib untuk produk yang melacak tanggal kedaluwarsa.
- Setiap kombinasi produk/batch/lokasi/posisi hanya boleh muncul sekali. Draft menyimpan `qty_before` (saldo sellable saat dibuat), `qty_counted`, dan `qty_diff = qty_counted - qty_before`. Pembuatan tidak mengubah atau mereservasi saldo. Draft tidak dapat diedit; batalkan lalu buat ulang jika salah.
- `POST .../{id}/request` mengubah `draft` menjadi `requested`. Pemohon dapat membatalkan draft/permintaan sebelum disetujui; `reason` pembatalan opsional.
- `POST .../{id}/approve` secara default menyetujui. Persetujuan dan posting saldo dilakukan dalam transaksi yang sama; respons akhir berstatus `posted`. Untuk keputusan `reject`, kirim `{ "decision": "reject", "note": "..." }`; alasan penolakan wajib dan stok tidak berubah.
- Persetujuan untuk alasan `loss` atau `expired` wajib menyertakan `approver_username` dan `approver_password` milik akun Admin/pemegang `inventory.adjust.approve` sendiri. Alasan lain cukup dengan sesi approver yang berizin. Kegagalan autentikasi ulang menghasilkan 422 `approver_password`; catatan autentikasi ulang gagal/berhasil masuk audit.
- Saat posting, saldo sellable saat ini harus tetap sama dengan `qty_before`. Jika ada transaksi lain sejak draft dibuat, posting ditolak dengan 422 `items.N.qty_counted`; buat dokumen baru berdasarkan saldo terbaru. Seluruh baris dan saldo diperiksa sebelum ada movement, dan transaksi seluruhnya rollback bila satu baris gagal.
- Selisih positif menambah sellable; selisih negatif mengurangi sellable tanpa mengizinkan stok negatif. Alasan `damage` memindahkan selisih dari bucket sellable ke damaged (total stok tetap); alasan `loss`/`expired` menghapus stok dengan movement `write_off`; selisih lain memakai movement `adjustment`. HPP tidak berubah dan bucket quarantine tidak disentuh.
- Pembuatan, pengajuan, persetujuan, posting, penolakan, dan pembatalan dicatat pada audit (`stock_adjustment.create|request|approve|post|reject|cancel`). Dokumen posted tidak dapat diubah atau dibatalkan; koreksi memerlukan dokumen adjustment baru.
- Opname pada tahap ini dicatat sebagai adjustment dengan `reason: "opname"`; skema/migration Paket 1 tidak menyediakan sesi opname terpisah. Tidak ada migration baru dan tidak ada permission baru.
- Daftar menerima `status` (`draft|requested|posted|rejected|cancelled`), `reason`, awalan nomor dokumen melalui `q`, dan `per_page` (1–100, default 25). Nomor dokumen `ADJ-...`; jumlah, snapshot saldo, dan selisih dikembalikan sebagai string desimal.

### Yang belum ada untuk Inventory
Denah rak ⏳. `InventoryService` menyediakan `receive`, `sell` FEFO, `voidSale`, `transfer`, dan `adjust`; penerimaan dari PO sudah melalui alur Pembelian (bagian 6).

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

Alur: `open` → `counting` (penjualan baru **diblokir**) → `closed` → `reviewed`. Satu laci, satu shift aktif; Kasir hanya mengelola shift sendiri, Admin (`shift.review`) boleh semua.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/shifts/current` | `shift.open` | Shift aktif milik saya; `{"data": null}` bila belum ada → tampilkan layar "Buka Shift" |
| POST | `/api/shifts/open` | `shift.open` | Buka shift. Body opsional `{"counted_opening_cash": "0"}` (hitungan uang di laci; selisih dengan saldo awal dicatat di audit) |
| GET | `/api/shifts/{id}` | `shift.open` | Detail (Kasir: hanya miliknya, selain itu 404) |
| POST | `/api/shifts/{id}/start-count` | `shift.close` | Mulai penutupan: status `counting`, penjualan baru ditolak |
| POST | `/api/shifts/{id}/close` | `shift.close` | Tutup: `{"counted_cash": "44000", "variance_note": "..."}` |
| POST | `/api/shifts/{id}/review` | `shift.review` (Admin) | Tinjau shift `closed` → `reviewed` (`{"note"}` opsional) |
| GET | `/api/shifts` | `shift.review` (Admin) | Daftar: `status`, `cashier_id`, `date_from`, `date_to`, `per_page` |

Respons shift (`data`):
```json
{ "id": 1, "doc_number": "SHIFT-202610-000001", "register_id": 1, "cashier_id": 4, "cashier_name": "Kasir-jual",
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
| POST | `/api/sales` | `sales.create` | **Posting penjualan** (tunai atau kredit potong gaji) |
| GET | `/api/sales` | `sales.create` | Riwayat. Kasir: hanya miliknya; Admin: semua. Filter `q` (nomor struk), `shift_id`, `customer_id`, `status`, `payment_mode`, `date_from`, `date_to`, `per_page` |
| GET | `/api/sales/{id}` | `sales.create` | Struk lengkap (item, pembayaran, `receipt`) |
| POST | `/api/sales/{id}/reprint` | `receipt.reprint` | Cetak ulang: struk sama dengan `receipt.is_copy = true`, `copy_label = "SALINAN"`; tercatat di log cetak + audit |

Void: lihat bagian 7.2. Retur pelanggan dan credit note ⏳ (Paket 2).

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

Alur bisnis: **Kasir** mengajukan PR → **Finance** memeriksa → **Owner** menyetujui (autentikasi ulang) → **Admin** membuat PO per supplier → PO disetujui → dikirim ke supplier → **Kasir** menerima barang (surat jalan) → **posting** menambah stok → Admin memverifikasi surat jalan/faktur. Paket 1: **tanpa Saldo Pembelian** (pengecekan saldo = Paket 2).

> Status: ✅ lulus test (24 Okt 2026). Uang/qty tetap string desimal. Waktu UTC. Format sukses `{ "data": ... }`.

### 6.1 Purchase Requisition (PR)

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/purchase-requisitions` | `purchase_requisition.create` | Daftar. Kasir hanya melihat PR miliknya; Admin melihat semua. Query: `status`, `q` (awalan nomor), `mine=1`, `per_page` |
| POST | `/api/purchase-requisitions` | `purchase_requisition.create` | Buat PR **draft** |
| GET | `/api/purchase-requisitions/{pr}` | `purchase_requisition.create` | Detail + item + riwayat keputusan + PO turunan |
| PATCH | `/api/purchase-requisitions/{pr}` | `purchase_requisition.create` | Ubah saat `draft`/`returned` (pembuat atau Admin). `items` menggantikan seluruh item |
| POST | `/api/purchase-requisitions/{pr}/submit` | `purchase_requisition.create` | `draft`/`returned` → `submitted` (notifikasi ke Finance) |
| POST | `/api/purchase-requisitions/{pr}/finance-check` | `purchase_requisition.finance_check` | `{ "decision": "pass" \| "return", "note": "..." }` — `note` wajib bila `return` |
| POST | `/api/purchase-requisitions/{pr}/approve` | `purchase_requisition.approve` | Persetujuan Owner: `{ "decision": "approve" \| "reject", "note", "approver_username", "approver_password" }` |
| POST | `/api/purchase-requisitions/{pr}/cancel` | `purchase_requisition.create` | `{ "reason"? }` — saat `draft`/`returned`/`submitted` (pembuat atau Admin) |

Status PR: `draft` → `submitted` → `finance_checked` → `approved` → `converted` (otomatis saat seluruh item sudah masuk PO) · cabang: `returned` (dikembalikan Finance, **boleh diedit lalu diajukan lagi**), `rejected`, `cancelled`.

Permintaan buat/ubah:
```json
{ "reason": "Stok menipis",
  "items": [ { "product_id": 12, "qty": "10", "est_price": "2500", "note": "merk bebas" } ] }
```
`items` 1–100 baris; `qty` > 0 (maks 99999, 3 desimal); `est_price` opsional (maks 2 desimal); produk nonaktif/ganda ditolak. Produk `pending_price` boleh diajukan.

Detail PR (`data`): `id, doc_number ("PR-202610-000001"), status, reason, est_total, requested_by, requester_name, submitted_at, created_at`, `items[]` (`id, product_id, sku, name, unit_name, qty, est_price, note, qty_ordered, qty_remaining` — dua terakhir = berapa sudah/ belum dipesan lewat PO), `approvals[]` (`step: finance_check|owner_auth, decision: approved|returned|rejected, decided_by_name, note, is_self_approval, decided_at`), `purchase_orders[]` (`id, doc_number, status, total`).

Autentikasi ulang Owner: kirim `approver_username` + `approver_password` (diketik pemberi persetujuan sendiri; salah → 422 `errors.approver_password`). Wajib selama setting `approval_reauth_required` aktif (default aktif). Bila pembuat PR = pemberi persetujuan (mode minimalis), diizinkan hanya jika setting `sod_owner_self_approve = allow_with_flag` (default) dan **ditandai** `is_self_approval: true` — tampilkan lencana "disetujui sendiri". Bila diblokir → 422 `errors.approver_username`.

### 6.2 Purchase Order (PO)

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/purchase-orders` | `purchase_order.create` **atau** `goods_receipt.create` | Daftar. Admin: semua. **Kasir: hanya PO yang bisa menerima barang, tanpa harga** (`unit_price`/`total` = `null`). Query: `status`, `receipt_status`, `supplier_id`, `pr_id`, `receivable=1`, `q`, `per_page` |
| GET | `/api/purchase-orders/{po}` | sama | Detail + item + daftar penerimaan |
| POST | `/api/purchase-orders` | `purchase_order.create` | Buat PO **draft** dari PR `approved` |
| PATCH | `/api/purchase-orders/{po}` | `purchase_order.create` | Ubah saat `draft` (`pr_id` tidak dapat diubah) |
| POST | `/api/purchase-orders/{po}/submit` | `purchase_order.create` | `draft` → **otomatis `approved`** bila total PO ≤ total estimasi PR, selain itu `pending_confirmation` |
| POST | `/api/purchase-orders/{po}/confirm` | `purchase_requisition.approve` | Konfirmasi Owner untuk `pending_confirmation` (`approver_username`, `approver_password`, `note?`) |
| POST | `/api/purchase-orders/{po}/send` | `purchase_order.send` | `approved` → `sent` |
| POST | `/api/purchase-orders/{po}/cancel` | `purchase_order.create` | `{ "reason" }` wajib; sebelum ada penerimaan |
| POST | `/api/purchase-orders/{po}/close` | `purchase_order.create` | `{ "reason" }` wajib; tutup manual PO yang sebagian diterima |

Permintaan buat:
```json
{ "pr_id": 5, "supplier_id": 2, "payment_terms": "credit", "order_date": "2026-10-24", "expected_date": "2026-10-30",
  "items": [ { "product_id": 12, "qty_ordered": "10", "unit_price": "2400" } ] }
```
`payment_terms` (`prepaid|credit|cod`) default dari supplier. `order_date` default hari ini (WIB).

Status PO: `draft` → (`pending_confirmation`) → `approved` → `sent` → `partially_received` → `received`; cabang `cancelled`. Status penerimaan terpisah: `receipt_status` = `none|partial|complete`; `payment_status` = `unpaid` (pembayaran = Paket 2).

Aturan: PO **wajib dari PR `approved`**; satu PR boleh dipecah ke beberapa PO (per supplier); qty per produk **kumulatif** tidak boleh melebihi qty PR (422 `errors["items.N.qty_ordered"]` memuat sisa); PR otomatis menjadi `converted` bila semua item sudah tercakup dan kembali `approved` bila PO dibatalkan.

Detail PO (`data`): `id, doc_number ("PO-…"), status, receipt_status, payment_status, payment_terms, pr_id, pr_doc_number, supplier_id, supplier_name, order_date, expected_date, total, created_by_name`, `items[]` (`id` = **`po_item_id`** untuk penerimaan, `product_id, sku, name, unit_name, qty_ordered, qty_received, qty_remaining, unit_price, line_total`), `receipts[]` (`id, doc_number, status, document_status, posted_at`).

### 6.3 Penerimaan barang (Goods Receipt)

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/goods-receipts` | `goods_receipt.create` | Daftar. Kasir: miliknya; Admin: semua. Query: `status`, `document_status`, `po_id`, `q`, `per_page` |
| POST | `/api/goods-receipts` | `goods_receipt.create` | Buat penerimaan dari PO. `"post": true` = langsung posting |
| GET | `/api/goods-receipts/{gr}` | `goods_receipt.create` | Detail + baris |
| POST | `/api/goods-receipts/{gr}/post` | `goods_receipt.create` | **Posting**: stok bertambah, PO diperbarui (atomik) |
| POST | `/api/goods-receipts/{gr}/cancel` | `goods_receipt.create` | Batalkan penerimaan **draft** |
| POST | `/api/goods-receipts/{gr}/verify-documents` | `goods_receipt.verify_documents` | Verifikasi surat jalan + faktur (Admin) |

Permintaan buat:
```json
{ "po_id": 9, "delivery_note_no": "SJ-001", "invoice_no": "INV-77", "note": null, "post": true,
  "items": [
    { "po_item_id": 31, "qty_received": "8", "qty_damaged": "2", "expiry_date": "2027-03-01", "batch_code": "L9", "shelf_position_id": null, "note": null }
  ] }
```
- Satu `po_item_id` boleh muncul di beberapa baris (batch/kadaluarsa berbeda). **Diterima + rusak ≤ sisa pesanan**; melebihi → 422 `errors["items.N.qty_received"]`.
- Produk `track_expiry` **wajib** `expiry_date` (untuk qty diterima); produk lain **tidak boleh**; tanggal yang sudah lewat ditolak (catat sebagai rusak).
- Harga beli = harga di PO. `unit_cost` hanya boleh diubah pemegang `goods_receipt.verify_documents` (Kasir mengirim nilai berbeda → 403). Kasir **tidak** menerima `unit_cost`/`price_variance` pada respons (`null`).
- `qty_damaged` hanya **dicatat** (untuk klaim/retur supplier, Paket 3); tidak menambah stok dan tidak mengurangi sisa pesanan.
- Respons `data`: `id, doc_number ("GR-…"), po_id, po_doc_number, supplier_name, delivery_note_no, invoice_no, status (draft|posted|cancelled), document_status (pending|verified), received_by_name, posted_at, verified_by_name, verified_at`, `items[]` (`po_item_id, product_id, sku, name, qty_ordered, qty_received, qty_damaged, qty_short, unit_cost, po_unit_price, price_variance, expiry_date, batch_code, shelf_position_id`). `qty_short` = sisa pesanan setelah penerimaan ini (di baris pertama tiap baris PO).
- Efek posting: batch baru + saldo + pergerakan `receipt` + HPP rata-rata bergerak (lihat Inventory), qty PO terpenuhi, status PO `partially_received`/`received`. Bila ada barang rusak, Admin mendapat notifikasi `goods_receipt.damaged`.

### 6.4 Kunci error yang perlu penanganan khusus (422 `errors.<kunci>`)

| Kunci | Arti | Tindakan UI |
|---|---|---|
| `status` | Aksi tidak cocok dengan status dokumen saat ini | Muat ulang dokumen, tampilkan pesan |
| `approver_password` | Autentikasi ulang kosong/salah/terkunci (5x salah) | Tampilkan di dialog persetujuan, jangan tutup dialog |
| `approver_username` | Pembuat tidak boleh menyetujui sendiri (setting SoD) | Minta Owner lain |
| `note` / `reason` | Alasan wajib (kembalikan, tolak, batal, tutup) | Fokus ke kolom alasan |
| `pr_id` | PR belum `approved` / sudah seluruhnya jadi PO | Muat ulang PR |
| `items.N.qty_ordered` | Melebihi sisa qty PR | Tampilkan sisa dari pesan; sisa juga ada di `items[].qty_remaining` PR |
| `po_id` | PO belum/tidak lagi bisa menerima barang, atau **mode gudang aktif (belum didukung)** | Tampilkan pesan |
| `items.N.qty_received` | Melebihi sisa pesanan / kedua jumlah kosong | Tampilkan sisa dari pesan |
| `items.N.expiry_date` | Wajib / tidak berlaku / sudah kedaluwarsa | Fokus ke kolom tanggal baris itu |
| `items` (pada posting) | Penerimaan lain sudah memakai sisa PO | Muat ulang PO dan penerimaan |
| `delivery_note_no`, `invoice_no`, `document_status` | Verifikasi dokumen belum lengkap / sudah terverifikasi | Tampilkan pesan |

### 6.5 Notifikasi baru (`type`)
`pr.submitted` (ke Finance), `pr.finance_checked` (ke Owner), `pr.returned` / `pr.approved` / `pr.rejected` (ke pembuat), `pr.ready_for_po` (ke pembuat PO), `po.needs_confirmation` (ke Owner), `po.confirmed`, `goods_receipt.damaged`. Semua memakai `entity_type` (`purchase_requisition|purchase_order|goods_receipt`) + `entity_id` untuk tautan ke dokumen.

### 6.6 Layar yang sudah bisa dibuatkan UI-nya (urutan saran)
1. **Penerimaan barang (Kasir)** — pilih PO (`GET /api/purchase-orders?receivable=1`) → isi qty/kedaluwarsa/rusak → posting. Ini yang paling berdampak: stok bisa masuk lewat jalur resmi.
2. **Daftar & form PR (Kasir)** — buat, ubah, ajukan; lencana status; pesan Finance saat `returned`.
3. **Antrean Finance/Owner (Admin)** — PR `submitted` → periksa; `finance_checked` → dialog persetujuan dengan input username+password.
4. **PO (Admin)** — buat dari PR yang disetujui (tampilkan `qty_remaining`), ajukan, konfirmasi Owner bila diminta, kirim, tutup/batal.
5. Verifikasi dokumen penerimaan (Admin).

### 6.7 ASUMSI dan batasan (perlu konfirmasi klien/pengguna)
- **Q-13:** PO otomatis disetujui bila total PO aktif kumulatif ≤ total estimasi PR (dan estimasi > 0); selain itu perlu konfirmasi Owner. PR tanpa estimasi harga selalu perlu konfirmasi.
- "Owner" = pemegang `settings.manage`; aturan swa-persetujuan memakai `sod_owner_self_approve` untuk Owner dan `sod_pr_creator_approver` untuk lainnya.
- Penerimaan dari PO berstatus `approved` (belum diklik "kirim") tetap diizinkan agar operasional tidak tertahan langkah administratif.
- Tanpa toleransi kelebihan kiriman; barang yang sudah kedaluwarsa tidak diterima sebagai layak jual.
- **Belum ada:** penerimaan ke gudang + putaway (setting `warehouse_enabled` aktif ditolak dengan pesan), unggah lampiran surat jalan/foto, retur supplier/klaim barang rusak (Paket 3), pembayaran supplier dan Saldo Pembelian (Paket 2), dokumen koreksi penerimaan terposting.

## 7. Setoran, Endapan, dan Void ✅

> Status: ✅ lulus `php artisan test` (24 Okt 2026; `CashDepositTest` 14, `SaleVoidTest` 6; total suite 174 lulus). Bentuk respons final dan boleh dipercaya.

### 7.1 Kebijakan endapan dan setoran kasir

Endapan = uang yang sengaja tetap di laci dan menjadi saldo awal shift berikutnya. Setoran = kas terhitung − endapan, **dibulatkan ke bawah** ke `rounding_unit` (sisa pembulatan tetap di laci).

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/float-policies` | `float.propose` | Kebijakan aktif: `{ "data": { "petty_cash": {…}\|null, "main_cash": {…}\|null } }` |
| PUT | `/api/float-policies/{scope}` | `float.configure` (Admin) | Tetapkan versi baru (`scope` = `petty_cash`\|`main_cash`); versi lama dinonaktifkan, tercatat di audit |
| POST | `/api/shifts/{id}/deposits` | `cash_deposit.create` | **Setoran parsial** tengah shift: `{ "counted_amount": "800000", "note"? }` → Draft |
| GET | `/api/cash-deposits?status=&kind=&shift_id=&per_page=` | `cash_deposit.create` | Daftar (Kasir: hanya shift sendiri; Finance/Admin: semua) |
| GET | `/api/cash-deposits/{id}` | idem | Detail |
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

> Status: ✅ lulus `php artisan test` (25 Okt 2026; `BillingTest` 10, total suite 184). Seluruhnya **Admin** (Kasir 403). Tidak ada migration/permission baru.

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/billing-periods` | `billing_period.manage` | Daftar periode (terbaru dulu, paginasi) |
| GET | `/api/billing-periods/current` | `billing_period.manage` | Periode terbuka; `data` = null bila belum ada |
| POST | `/api/billing-periods` | `billing_period.manage` | Buka periode: `label?`, `scheduled_close_date?` (`YYYY-MM-DD`). 422 `status` bila masih ada yang terbuka |
| GET | `/api/billing-periods/{id}` | `billing_period.manage` | Detail + `customers[]` (ringkasan tagihan per karyawan) |
| PATCH | `/api/billing-periods/{id}` | `billing_period.manage` | Ubah `label` / `scheduled_close_date` (tanggal gaji HRD); hanya periode terbuka |
| POST | `/api/billing-periods/{id}/close` | `billing_period.close` | **Tutup periode** pada hari gaji |
| POST | `/api/billing-periods/{id}/invoice` | `invoice.generate` | Buat invoice (draft); `bill_to?` (default "HRD") |
| GET | `/api/invoices?status=&per_page=` | `invoice.generate` | Daftar invoice |
| GET | `/api/invoices/{id}` | `invoice.generate` | Detail: `customers[]` (per karyawan, berisi `sales[]`) dan `payments[]` |
| POST | `/api/invoices/{id}/issue` | `invoice.issue` | draft → `issued` |
| POST | `/api/invoices/{id}/hand-over` | `invoice.issue` | `issued` → `handed_to_hr` (penanda diserahkan ke HRD) |
| POST | `/api/invoices/{id}/payments` | `invoice.record_payment` | Catat pembayaran HRD: `amount`, `received_on?`, `reference?`, `note?` |

### Perilaku
- **Tutup periode** mengikat semua struk kredit terposting yang belum terikat ke periode itu, lalu **periode berikutnya otomatis dibuka**; struk kredit baru masuk ke sana. Karena struk terikat tidak lagi dihitung sebagai pemakaian, **sisa batas kredit karyawan pulih** setelah tutup periode. Struk tunai dan struk batal tidak ikut.
- **Invoice**: satu per periode tertutup, satu baris per struk. Subtotal = jumlah struk. PPN dihitung di invoice hanya bila `vat_enabled` aktif dan tarif lengkap (R-04); bila PPN aktif tapi konfigurasi belum lengkap → 422 `status` dan tidak ada yang berubah. Struk ditandai `billing_status: "invoiced"` dan **tidak dapat di-void lagi** (422 `status`, perlu credit note).
- **Status invoice**: `draft` → `issued` → `handed_to_hr` → `partially_paid` → `paid`. Pembayaran hanya untuk `issued`/`handed_to_hr`/`partially_paid`; jumlah > 0 dan ≤ `amount_remaining` (422 `amount`). Saat lunas, semua struk menjadi `billing_status: "paid"`.
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

- Diskon: tanggal `YYYY-MM-DD` (WIB); mulai = awal hari, berakhir = akhir hari; `starts_at` kosong = mulai sekarang. `value` > 0, maks 2 desimal; persen ≤ 100. Respons memuat `target_name` dan `status` (`active` · `scheduled` · `expired` · `inactive`; tampilkan sebagai teks, bukan hanya warna). Tidak ada hapus; nonaktifkan lewat `is_active`. Di kasir, diskon terbaik yang sedang berlaku dipilih otomatis (produk vs kategori).
- PPN: default nonaktif. Mengaktifkan wajib mengisi tarif (0–100, 2 desimal) dan "harga sudah termasuk PPN". Perubahan tarif/mode membuat versi baru yang berlaku mulai hari ini (WIB); nilai yang sama tidak membuat versi baru; menonaktifkan tidak menghapus riwayat tarif. PPN aktif tapi konfigurasi tidak lengkap membuat penjualan tunai dan pembuatan invoice ditolak (R-04: tarif/PKP menunggu klien).
- Layar yang bisa dibuat (Admin): daftar + form diskon (pilih produk/kategori, jenis, nilai, tanggal, aktif/nonaktif) dan halaman pengaturan PPN.

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

## Perubahan lain yang memengaruhi frontend
- `routes/api.php` kini memuat `routes/api/inventory.php`, `routes/api/customers.php`, `routes/api/pos.php`, `routes/api/billing.php`; URL lama tidak berubah.
- Tidak ada permission baru dan tidak ada migration baru pada tahap 2.7. Stok awal tetap memakai `inventory.adjust.approve` (ASUMSI sampai ada permission khusus).

## Riwayat
- **2026-10-27** — Tahap 2.7 (adjustment/opname) ditambahkan: draft dan snapshot stok, pengajuan, persetujuan/re-auth kondisional, penolakan/pembatalan, pemeriksaan snapshot untuk mencegah posting hitung-stok kedaluwarsa, movement dan audit atomik. `StockAdjustmentTest` 8 test (85 assertions); seluruh suite **218 test lulus (1.922 assertions)**; bagian 1 kini ✅.
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
