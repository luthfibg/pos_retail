# Permintaan Frontend → Backend

**Berkas ini dibaca agent backend (B#2) di awal setiap sesi.** Agent frontend (F#2) menulis kebutuhan yang belum bisa dipenuhi kontrak API saat ini di sini, bukan mengubah kode backend. Satu entri per permintaan; jangan menghapus entri yang sudah selesai (ubah statusnya).

**Cara memakai (agent backend):**
1. Kerjakan permintaan berstatus `Diminta` sesuai prioritas. Bila ada bagian yang tidak masuk akal atau bertentangan dengan aturan bisnis, ubah status ke `Ditolak/Diskusi` dan tulis alasannya di bawah entri.
2. Setelah kode + test ditulis: ubah status ke `Ditulis (menunggu test)`; setelah pengguna menjalankan `php artisan test` dan hijau: `Selesai`.
3. Tambahkan kontraknya yang final di `BACKEND_PROGRESS.md` (bagian baru + Riwayat) dan perbarui `ROADMAP_PROGRESS.md`. Frontend hanya mempercayai `BACKEND_PROGRESS.md`.

| ID | Judul | Prioritas | Status | Diajukan |
|---|---|---|---|---|
| FR-01 | Pratinjau penjualan (`POST /api/sales/preview`) | Tinggi (layar kasir) | **Diminta** | 25 Okt 2026 |
| FR-02 | Izin Finance untuk daftar/detail setoran | Tinggi (antrean setoran) | **Diminta** | 27 Okt 2026 |

---

## FR-01 — Pratinjau penjualan

**Status:** Diminta · **Prioritas:** Tinggi · **Dibutuhkan oleh:** layar kasir `/pos` (frontend) · **Perubahan skema:** tidak ada (tanpa migration, tanpa permission baru).

### Masalah

Aturan proyek: harga, diskon, PPN, dan total **dihitung server** (HANDOFF; `BACKEND_PROGRESS.md` bagian 5), dan frontend tidak boleh menghitung ulang. Akibatnya, sebelum `POST /api/sales` Kasir tidak bisa mengetahui:

- **total sebenarnya** (diskon Admin terbaik per produk/kategori, PPN tunai bila `vat_enabled`) — padahal Kasir perlu angkanya untuk menyebut nominal dan menerima uang; uang diterima yang kurang baru ditolak setelah posting (`422 amount_tendered`);
- apakah **kredit akan melebihi batas** (`422 credit_limit`) — baru diketahui setelah menekan Bayar;
- apakah **stok cukup** (`422 items.N.qty`) — baru diketahui setelah menekan Bayar, sehingga antrean di kasir tertahan.

Menghitung sendiri di klien berarti menduplikasi aturan pembulatan, diskon terbaik, dan PPN, dan angkanya akan menyimpang dari struk. Karena itu diminta satu endpoint hanya-baca.

### Kontrak yang diusulkan

`POST /api/sales/preview` — `auth:sanctum`, `can:sales.create` (Kasir dan Admin). Dipanggil frontend setiap keranjang atau mode bayar berubah (didebounce ±300 ms), jadi harus murah: **tanpa transaksi tulis**, tanpa `lockForUpdate`.

Permintaan (aturan validasi **sama** dengan `StoreSaleRequest`, tanpa `idempotency_key`, `amount_tendered`, dan `credit_exception`):
```json
{ "payment_mode": "cash",
  "customer_id": null,
  "items": [ { "product_id": 12, "qty": "2" }, { "product_id": 15, "qty": "0.5" } ] }
```
- `payment_mode` wajib (`cash` | `payroll_credit`), karena PPN hanya untuk tunai; frontend memanggil ulang saat mode berganti.
- `customer_id` wajib bila `payroll_credit` (sama seperti posting).
- `items`: 1–100 baris; `qty` > 0, maks 99.999, maks 3 desimal.

Respons 200:
```json
{ "data": {
    "payment_mode": "cash",
    "lines": [
      { "index": 0, "product_id": 12, "sku": "P-000012", "name": "Air Mineral 600ml", "unit_name": "pcs",
        "qty": "2.000", "unit_price": "10000.00", "gross": "20000.00",
        "discount_amount": "0.00", "discount_name": null, "line_total": "20000.00",
        "stock_available": "24.000", "stock_sufficient": true }
    ],
    "subtotal": "27500.00", "discount_total": "0.00",
    "tax_rate": null, "tax_amount": "0.00", "total": "27500.00",
    "credit": null,
    "computed_at": "2026-10-25 03:10:00.000" } }
```
Untuk `payroll_credit`, `credit` berisi (selain itu `null`):
```json
"credit": { "customer_id": 3, "remaining_before": "900000.00", "remaining_after": "872500.00", "exceeds_limit": false }
```
Aturan isi:
- **`lines` = hasil penggabungan** produk yang sama (seperti posting). `index` = indeks baris pertama produk itu di permintaan, supaya kunci error sama dengan posting (`items.N.…`).
- Semua uang string desimal, bentuk dan pembulatan **persis** posting: `gross = round-half-up(unit_price × qty)`, diskon terbaik per baris (produk vs kategori), `tax_*` hanya untuk `cash`.
- `stock_available` = qty layak jual yang **bisa dijual FEFO** saat ini (batch kedaluwarsa tidak dihitung, sama dengan `InventoryService::sell`). `stock_sufficient` = `stock_available >= qty` gabungan. Hanya informasi; **tidak** menyebabkan 422.
- `credit.remaining_before/after` memakai rumus batas yang sama dengan `checkCreditLimit` (batas − struk kredit `posted` yang belum ditagih). **Jangan** mengirim nilai batas itu sendiri (Kasir tidak boleh melihatnya); `remaining_*` sudah boleh dilihat Kasir (`credit_remaining`). `exceeds_limit: true` bukan error: ini sinyal agar UI menawarkan tunai atau pengecualian Admin. `remaining_after` bernilai `"0.00"` bila melebihi (jangan negatif).

Kesalahan (422, kunci sama dengan posting agar pemeta error frontend dipakai ulang):

| Kunci | Kapan |
|---|---|
| `items.N.product_id` | produk tidak ada / bukan `active` / belum berharga |
| `items.N.qty`, `items`, `payment_mode` | validasi bentuk; `payment_mode` juga bila konfigurasi PPN belum lengkap (sama dengan posting) |
| `customer_id` | kredit tanpa karyawan; karyawan belum diverifikasi, nonaktif, atau batas belum diisi (sama dengan `assertCreditCustomer`) |

Tidak menjadi galat di pratinjau: stok kurang (→ `stock_sufficient: false`), melebihi batas kredit (→ `exceeds_limit: true`), shift belum dibuka / sedang `counting` (frontend memeriksanya lewat `GET /api/shifts/current`).

### Syarat implementasi

1. **Satu sumber logika harga.** Ekstrak langkah 3–4 `SaleService::postInTransaction` (penggabungan baris, pemuatan produk, diskon aktif, `gross`/diskon/`cashTax`) menjadi metode bersama yang dipakai posting **dan** pratinjau, agar angka keduanya tidak bisa menyimpang. Posting tetap memuat produk dengan `lockForUpdate`; pratinjau tanpa kunci.
2. **Murni hanya-baca:** tanpa baris `sales`/`sale_items`/`payments`, tanpa `NumberSequence::next` (nomor dokumen tidak boleh terbuang), tanpa mencatat idempotensi, tanpa ledger, tanpa `AuditLogger`.
3. **Rate limit** longgar per pengguna (usul `throttle:120,1`), karena dipanggil saat mengetik.
4. Bentuk respons ditambahkan ke `BACKEND_PROGRESS.md` bagian 5 (sub-bagian "Pratinjau").

### Test yang diharapkan (`SalePreviewTest`)

- Total pratinjau **sama persis** dengan total hasil `POST /api/sales` untuk data yang sama: tanpa diskon; dengan diskon produk dan kategori (diskon terbaik); `qty` desimal; PPN tunai eksklusif dan inklusif; kredit (tanpa PPN).
- Tidak ada baris baru di `sales`, `sale_items`, `payments`, `fund_ledger_entries`, `audit_logs`, dan `number_sequences` tidak berubah setelah pratinjau.
- Produk yang sama di dua baris digabung; `lines[].index` = indeks baris pertama.
- Stok kurang → 200 dengan `stock_sufficient: false`; batch kedaluwarsa tidak dihitung di `stock_available`.
- Kredit: `remaining_before/after` benar dan memperhitungkan struk kredit `posted` yang belum ditagih (struk `voided` tidak); melebihi batas → `exceeds_limit: true`, `remaining_after: "0.00"`, nilai batas tidak ada di respons.
- 422 untuk produk `pending_price`/`inactive`, karyawan `pending_verification`/`inactive`/batas belum diisi, kredit tanpa `customer_id`.
- 401 untuk tamu; 403 untuk pengguna tanpa `sales.create`.

### Di luar cakupan (sengaja tidak diminta)

- Reservasi stok atau penguncian harga antara pratinjau dan posting: posting tetap menghitung ulang dan otoritatif. Frontend akan membandingkan `total` posting dengan pratinjau dan memberi tahu Kasir bila berbeda (mis. Admin mengubah harga di tengah transaksi).
- Hitungan kembalian: frontend hanya mengurangkan `amount_tendered − total` untuk tampilan (bilangan bulat sen, tanpa float); nilai resmi tetap `payment.change_given` dari respons posting.
- Menyimpan keranjang tertahan (hold).

### Catatan untuk agent backend

Bila lebih mudah, nama rute boleh diubah (mis. `POST /api/sales/quote`); kabari lewat bagian "Diskusi" di bawah dan frontend menyesuaikan.

**Diskusi / keputusan:** _(kosong)_

---

## FR-02 — Izin Finance untuk daftar/detail setoran

**Status:** Diminta · **Prioritas:** Tinggi · **Dibutuhkan oleh:** halaman `/cash-deposits` · **Perubahan skema:** tidak ada.

Route `GET /api/cash-deposits` dan `GET /api/cash-deposits/{id}` saat ini memakai middleware `can:cash_deposit.create`, sedangkan halaman antrean Finance/Admin dan saldo dana seharusnya dapat digunakan pemegang `cash_deposit.receive`. `POST receive`, `POST correct`, dan `GET /api/fund-accounts` sudah memakai `cash_deposit.receive`. Akibatnya akun Finance yang hanya diberi izin menerima setoran akan mendapat 403 saat mengambil antrean/detail.

Mohon izinkan `cash_deposit.receive` untuk daftar dan detail setoran, sambil mempertahankan `cash_deposit.create` untuk Kasir. Otorisasi data tetap mengikuti aturan service: Kasir hanya melihat setoran shift sendiri, Finance/Admin dengan `cash_deposit.receive` dapat melihat semua. Tambahkan test Finance yang hanya memiliki permission `cash_deposit.receive` untuk daftar, detail, penerimaan, koreksi, dan saldo; pastikan Kasir tidak dapat melihat setoran milik shift lain.
