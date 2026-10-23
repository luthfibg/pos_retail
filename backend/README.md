# POS Retail SMK — Backend

REST API untuk POS Retail SMK, dibangun dengan Laravel 13, PHP 8.3+, Sanctum, dan MySQL 8.0.16+. Fitur yang tersedia mencakup autentikasi dan hak akses, kategori, supplier, produk, data karyawan, notifikasi, serta fondasi inventory. Fitur yang belum selesai dan kontrak endpoint terbaru tercatat di [progres backend](../docs/BACKEND_PROGRESS.md).

## Menjalankan lokal

Pastikan PHP, Composer, dan MySQL tersedia. Buat database `pos_retail`, lalu dari folder `backend` jalankan:

```powershell
composer install
Copy-Item .env.example .env
```

Atur koneksi MySQL (`DB_CONNECTION=mysql`, `DB_HOST`, `DB_PORT`, `DB_DATABASE=pos_retail`, `DB_USERNAME`, dan `DB_PASSWORD`) di `.env`, kemudian:

```powershell
php artisan key:generate
php artisan migrate
php artisan db:seed
php artisan serve
```

API tersedia di `http://127.0.0.1:8000/api`. Seeder membuat data awal dan menampilkan kredensial Admin satu kali; simpan dengan aman.

## Pengujian

Buat database MySQL terpisah bernama `pos_retail_test`, lalu jalankan:

```powershell
php artisan test
```

`phpunit.xml` mengarahkan test ke database tersebut. Pelindung di test menolak berjalan jika database aktif tidak berakhiran `_test`, karena test dapat menghapus dan membuat ulang tabel.

## Struktur dan konvensi

- `app/Http/Controllers` dan `app/Http/Requests`: HTTP dan validasi.
- `app/Services`: logika bisnis; gunakan Query Builder sesuai pola proyek.
- `app/Support`: utilitas dan katalog permission.
- `routes/api.php` dan `routes/api/`: route API per modul.
- `database/migrations`, `database/seeders`, `tests/`: skema, data awal, dan pengujian.

Perubahan stok dan keuangan harus transaksional; jangan mengubah migration yang sudah ada. API memakai respons sukses `{ "data": ... }`, uang dan kuantitas dikirim sebagai string desimal, serta aksi penting diaudit.

## Dokumentasi

- [Progres dan kontrak endpoint](../docs/BACKEND_PROGRESS.md)
- [Handoff, aturan bisnis, dan arsitektur](../docs/HANDOFF_POS_RETAIL_SMK.md)
- [ERD](../docs/erd_paket1.md) dan [skema database](../docs/schema_paket1.sql)
