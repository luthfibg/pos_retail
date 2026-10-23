# Progres Backend → untuk Agent Frontend

**Satu-satunya berkas progres backend.** Setiap pekerjaan backend baru ditambahkan di sini (entri terbaru di atas bagian "Riwayat"), agar agent frontend tahu fitur mana yang sudah bisa dibuatkan UI-nya. Agent baru cukup membaca berkas ini + `HANDOFF_POS_RETAIL_SMK.md`.

**Diperbarui:** 23 Oktober 2026 · **Dikerjakan:** WS-B (Inventory inti) dan WS-A (Data karyawan + notifikasi)

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

## Perubahan lain yang memengaruhi frontend
- `routes/api.php` kini memuat `routes/api/inventory.php` dan `routes/api/customers.php`; URL lama tidak berubah.
- Tidak ada permission baru dan tidak ada migration baru. Stok awal memakai `inventory.adjust.approve` (ASUMSI sampai ada permission khusus).

## Riwayat
- **2026-10-23** — WS-B: `InventoryService` (saldo, pergerakan, batch, FEFO, anti-negatif, HPP rata-rata bergerak), stok awal, lihat stok per batch, riwayat pergerakan. WS-A: data karyawan (input Kasir, verifikasi dan batas oleh Admin), notifikasi `customer.limit_needed`. Status: 🟡 belum dijalankan.
- **sebelumnya** — Auth + RBAC ✅, kategori ✅, supplier ✅, produk (+harga, barcode otomatis, status stok) ✅. Detail kontraknya ada di `HANDOFF_POS_RETAIL_SMK.md` bagian 6.
