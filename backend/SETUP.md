# Setup Laravel dan Migration — POS Retail SMK (Paket 1)

Isi paket: `laravel/database/migrations/` (55 migration, urut sesuai dependensi FK) dan
`laravel/app/Models/User.php`. Migration dihasilkan dari `schema_paket1.sql` dan sudah
diperiksa secara statis, tetapi **belum dijalankan** (PHP/Composer tidak tersedia di lingkungan penyusun).

## 1. Prasyarat
- PHP dan Composer sesuai syarat versi Laravel yang dipasang
- MySQL 8.0.16+ (database `pos_retail` sudah ada)

## 2. Buat proyek
```bash
composer create-project laravel/laravel pos-retail-smk-api
cd pos-retail-smk-api
php artisan install:api        # memasang Sanctum; jawab "no" bila ditanya menjalankan migrasi
```

## 3. Hapus migration bawaan Laravel
Hapus tiga file ini di `database/migrations/` agar tidak bentrok dengan tabel `users` kita
dan agar database hanya berisi tabel rancangan:
```
0001_01_01_000000_create_users_table.php
0001_01_01_000001_create_cache_table.php
0001_01_01_000002_create_jobs_table.php
```

## 4. Salin berkas dari paket
- `laravel/database/migrations/*.php` -> `database/migrations/`
- `laravel/app/Models/User.php` -> `app/Models/User.php` (menimpa file bawaan)

## 5. Konfigurasi `.env`
```
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=pos_retail
DB_USERNAME=<user mysql>
DB_PASSWORD=<password mysql>

SESSION_DRIVER=file
CACHE_STORE=file
QUEUE_CONNECTION=sync
```
Biarkan `APP_TIMEZONE=UTC` (waktu disimpan UTC; tampilan WIB diatur lewat `stores.timezone`).

## 6. Drop tabel lama dan jalankan migration
```bash
php artisan migrate:fresh
```
`migrate:fresh` **menghapus semua tabel** di database `pos_retail` (termasuk hasil impor
`schema_paket1.sql`), lalu membuat ulang dari migration. Gunakan hanya pada database uji.

## 7. Verifikasi
```bash
php artisan migrate:status     # semua migration berstatus Ran
php artisan db:show --counts   # tabel: 55 + migrations + personal_access_tokens
```
Di MySQL, `SHOW CREATE TABLE sales;` harus memuat CHECK `chk_sales_credit_customer`, dan
`SHOW CREATE TABLE inventory_balances;` memuat kolom `position_key`/`batch_key` (STORED GENERATED).

Jika ada error, kirim pesan lengkap beserta nama file migration-nya.
