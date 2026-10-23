# Progres Backend → untuk Agent Frontend

**Satu-satunya berkas progres backend.** Setiap pekerjaan backend baru ditambahkan di sini (entri terbaru di atas bagian "Riwayat"), agar agent frontend tahu fitur mana yang sudah bisa dibuatkan UI-nya. Agent baru cukup membaca berkas ini + `HANDOFF_POS_RETAIL_SMK.md`.

**Diperbarui:** 23 Oktober 2026 · **Dikerjakan:** WS-B (Inventory inti), WS-A (Data karyawan + notifikasi), WS-D (Shift + Penjualan)

> **Untuk layar kasir (POS):** baca bagian 4 (Shift) dan 5 (Penjualan) dulu. Urutan alur kasir: `GET /api/shifts/current` → (bila `data` null) `POST /api/shifts/open` → cari produk (`GET /api/products/by-barcode/...`) → `POST /api/sales`.

## Cara membaca status

| Tanda | Arti |
|---|---|
| ✅ Lolos | `php artisan test` sudah dijalankan pengguna dan hijau |
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

## 1. Inventory 🟡

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| GET | `/api/inventory/products/{product}/stock` | `inventory.view` | Stok satu produk per batch/posisi + total |
| GET | `/api/inventory/movements` | `inventory.view` | Riwayat pergerakan stok (terbaru dulu) |
| POST | `/api/inventory/opening-balances` | `inventory.adjust.approve` (Admin) | **Stok awal** (satu dokumen, banyak baris, atomik) |

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

### Yang belum ada untuk Inventory (jangan dibuatkan UI dulu)
Penerimaan barang dari PO, transfer, adjustment/opname, karantina/write-off, denah rak ⏳.
(`InventoryService` sudah punya `receive`, `sell` FEFO, `voidSale` untuk dipakai penerimaan dan POS berikutnya — belum ada endpoint-nya.)

---

## 2. Data Karyawan (customers) 🟡

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

## 3. Notifikasi 🟡

Notifikasi milik pengguna yang login (tanpa izin khusus; hanya data sendiri).

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/notifications?unread=1&per_page=20` | Daftar; respons paginasi **+ `unread_count`** di tingkat atas (untuk badge lonceng) |
| POST | `/api/notifications/{id}/read` | Tandai satu terbaca → `{ "data": { "id": 4, "read": true } }`; milik orang lain → 404 |
| POST | `/api/notifications/read-all` | Tandai semua terbaca → `{ "data": { "marked": 3 } }` |

Item: `{ "id", "type", "entity_type", "entity_id", "message", "read_at", "created_at" }`.
Tipe saat ini: `customer.limit_needed` (`entity_type: "customer"`) → arahkan klik ke detail karyawan `entity_id` untuk mengisi batas. Notifikasi ini otomatis terbaca saat batas diisi, jadi lonceng bersih sendiri. Disarankan polling ringan (mis. 60 detik) — belum ada push.

---

## 4. Shift Kasir 🟡

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
- **Sementara:** saat tutup, `float_kept` = seluruh kas terhitung (belum ada modul setoran). Setoran dan endapan ⏳ — jangan buatkan UI setoran dulu.
- Kas masuk/keluar lain (`cash_movements`) ikut dihitung di kas diharapkan, tetapi belum ada endpoint untuk mencatatnya ⏳.

---

## 5. Penjualan (POS) 🟡

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| POST | `/api/sales` | `sales.create` | **Posting penjualan** (tunai atau kredit potong gaji) |
| GET | `/api/sales` | `sales.create` | Riwayat. Kasir: hanya miliknya; Admin: semua. Filter `q` (nomor struk), `shift_id`, `customer_id`, `status`, `payment_mode`, `date_from`, `date_to`, `per_page` |
| GET | `/api/sales/{id}` | `sales.create` | Struk lengkap (item, pembayaran, `receipt`) |
| POST | `/api/sales/{id}/reprint` | `receipt.reprint` | Cetak ulang: struk sama dengan `receipt.is_copy = true`, `copy_label = "SALINAN"`; tercatat di log cetak + audit |

Void, retur, dan pembatalan struk ⏳ (belum ada).

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

## Perubahan lain yang memengaruhi frontend
- `routes/api.php` kini memuat `routes/api/inventory.php`, `routes/api/customers.php`, dan `routes/api/pos.php`; URL lama tidak berubah.
- Tidak ada permission baru dan tidak ada migration baru. Stok awal memakai `inventory.adjust.approve` (ASUMSI sampai ada permission khusus).

## Riwayat
- **2026-10-23 (2)** — WS-D: shift (buka/hitung/tutup/tinjau, hitung buta, saldo awal = endapan sebelumnya) dan posting penjualan (tunai + kredit, FEFO, diskon Admin, PPN opsional, batas kredit + pengecualian Admin, idempotensi, riwayat, cetak ulang SALINAN). Status: 🟡 belum dijalankan.
- **2026-10-23** — WS-B: `InventoryService` (saldo, pergerakan, batch, FEFO, anti-negatif, HPP rata-rata bergerak), stok awal, lihat stok per batch, riwayat pergerakan. WS-A: data karyawan (input Kasir, verifikasi dan batas oleh Admin), notifikasi `customer.limit_needed`. Status: 🟡 belum dijalankan.
- **sebelumnya** — Auth + RBAC ✅, kategori ✅, supplier ✅, produk (+harga, barcode otomatis, status stok) ✅. Detail kontraknya ada di `HANDOFF_POS_RETAIL_SMK.md` bagian 6.
