# Master Data (Kategori, Supplier, Produk) — Tahap 1 (langkah 3)

**Kode ini belum dijalankan** (PHP tidak tersedia di lingkungan penyusun). Verifikasi pertamanya adalah `php artisan test`.

## 1. Pasang
Salin isi zip ke root proyek (gabungkan folder). Berkas yang MENIMPA yang sudah ada:
`routes/api.php`, `app/Services/StoreContext.php`, `tests/Concerns/CreatesUsers.php`.
Tidak ada migration baru (semua tabel sudah ada). Lalu:
```powershell
php artisan route:list --path=api     # harus ada 14 route (3 auth + 3 kategori + 3 supplier + 5 produk)
php artisan test                      # sekitar 59 test (24 lama + 35 baru)
```

## 2. Aturan bisnis yang ditegakkan
- **Produk:** satu produk = satu barcode, satuan pcs. **SKU dan barcode tidak dapat diubah** (agar barcode produk
  nonaktif tidak bisa dipakai ulang). Tidak ada hapus produk; gunakan status `inactive`.
- **Kasir** membuat produk berstatus `pending_price` tanpa harga dan tidak bisa dijual. Jika SKU/barcode kosong,
  sistem membuat otomatis: SKU `P-000001`, barcode EAN-13 internal berawalan `20` dengan digit cek.
  Kasir yang mengirim `sell_price` ditolak (403).
- **Harga** hanya diubah pemegang `price.change`; setiap perubahan masuk `price_history` dan audit log.
  Harga yang sama dikirim ulang tidak membuat catatan baru.
- **Aktivasi** (`status: active`) memerlukan `product.activate` dan harga jual terisi. Admin dapat mengirim
  `{ "sell_price": 5000, "status": "active" }` dalam satu permintaan.
- **Penonaktifan** ditolak selama produk masih punya stok (sellable, karantina, atau rusak).
- **Batas stok:** `critical_stock` tidak boleh lebih besar dari `min_stock`. Status stok dihitung:
  `habis` (stok <= 0), `kritis` (stok < batas kritis), `hampir_habis` (stok <= batas minimum), `aman`.
- **Kategori:** nama unik pada induk yang sama (tidak peka huruf besar/kecil), tidak boleh membuat siklus,
  tidak bisa dinonaktifkan bila masih punya subkategori aktif, kategori nonaktif tidak bisa dipilih untuk produk.
- **Supplier:** kode unik per toko dan tidak dapat diubah; default pembayaran `prepaid`/`credit`/`cod`.
- Semua perubahan tercatat di `audit_logs` (create, update, price_change, status_change).

## 3. Daftar endpoint
Semua memakai header `Authorization: Bearer <token>` dan `Accept: application/json`.

| Method | Path | Permission | Catatan |
|---|---|---|---|
| GET | `/api/categories` | `inventory.view` | `?active_only=1`; berisi `products_count` |
| POST | `/api/categories` | `category.manage` | `name`, `parent_id?` |
| PATCH | `/api/categories/{id}` | `category.manage` | `name`, `parent_id`, `is_active` |
| GET | `/api/suppliers` | `supplier.manage` | `?q=`, `?active_only=1`, `?per_page=` |
| POST | `/api/suppliers` | `supplier.manage` | `code`, `name`, kontak, `default_payment_terms?` |
| PATCH | `/api/suppliers/{id}` | `supplier.manage` | `code` dilarang diubah |
| GET | `/api/products` | `inventory.view` | `?q=` (nama/SKU/awalan barcode), `?category_id=`, `?status=`, `?per_page=` |
| GET | `/api/products/{id}` | `inventory.view` | |
| GET | `/api/products/by-barcode/{barcode}` | `inventory.view` | untuk pemindaian di kasir |
| POST | `/api/products` | `product.create` | harga hanya bila punya `price.change` |
| PATCH | `/api/products/{id}` | `product.update` | `sell_price` perlu `price.change`; `status` perlu `product.activate` |

Uang dikembalikan sebagai string desimal (`"3500.00"`), bukan angka floating.

## 4. Coba cepat (PowerShell)
```powershell
$h = @{ Accept = "application/json"; Authorization = "Bearer $($res.token)" }   # $res dari langkah login
$body = @{ name = "Air Mineral 600ml"; sell_price = 3500; min_stock = 24; critical_stock = 6; track_expiry = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/products" -Method Post -Headers $h -ContentType "application/json" -Body $body
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/products?q=air" -Headers $h | ConvertTo-Json -Depth 5
```
