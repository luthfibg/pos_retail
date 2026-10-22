# Seeder, Auth, dan RBAC — Tahap 1 (langkah 2)

Paket ini menambah: seeder data awal, login/logout/me (Sanctum), RBAC berbasis tabel
`permissions`, audit logger, layanan autentikasi ulang untuk persetujuan, dan test.
**Kode ini belum dijalankan** (PHP tidak tersedia di lingkungan penyusun); langkah 6 adalah
verifikasi pertamanya.

## 1. Salin berkas
Salin isi zip ke root proyek Laravel (gabungkan folder). Tiga berkas menimpa bawaan Laravel:
`app/Providers/AppServiceProvider.php`, `routes/api.php`, `database/seeders/DatabaseSeeder.php`.

## 2. Hapus berkas bawaan yang tidak cocok
```
database/factories/UserFactory.php     (memakai kolom `password`, tabel kita `password_hash`)
tests/Feature/ExampleTest.php
tests/Unit/ExampleTest.php
```

## 3. Isi data awal (database pos_retail)
Opsional tambahkan ke `.env` (jika kosong, password dibuat acak dan ditampilkan sekali):
```
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=
SEED_CASHIER_USERNAME=kasir1
SEED_CASHIER_PASSWORD=
```
```bash
php artisan config:clear
php artisan db:seed
```
Aman dijalankan berulang: tidak menggandakan data, tidak menimpa pengaturan atau akun yang sudah ada.

## 4. Coba login manual
```bash
php artisan serve
curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}'

curl -s http://127.0.0.1:8000/api/auth/me \
  -H "Accept: application/json" -H "Authorization: Bearer <token>"
```

## 5. Siapkan database test (WAJIB sebelum menjalankan test)
Test memakai `RefreshDatabase` (menjalankan `migrate:fresh`). **Jangan arahkan ke `pos_retail`.**
`tests/TestCase.php` menolak berjalan jika nama database tidak berakhiran `_test`.
```sql
CREATE DATABASE pos_retail_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- pastikan user MySQL di .env punya hak penuh pada pos_retail_test
```
Di `phpunit.xml`, ganti dua baris sqlite bawaan:
```xml
<env name="DB_CONNECTION" value="mysql"/>
<env name="DB_DATABASE" value="pos_retail_test"/>
```
(Test memakai migration MySQL: kolom generated dan CHECK tidak jalan di SQLite.)

## 6. Jalankan test
```bash
php artisan test
```
Cakupan: seeder (data dasar, idempotent), login/logout/me, RBAC (Admin penuh, Kasir terbatas,
override per pengguna, pengguna nonaktif/tanpa toko), dan autentikasi ulang persetujuan
(kredensial salah, tidak berwenang, nonaktif, penguncian setelah 5 kegagalan, penanda self-approval).
Jika ada yang gagal, kirim output lengkapnya.

## Pemakaian pada route berikutnya
```php
Route::post('sales', [SaleController::class, 'store'])
    ->middleware(['auth:sanctum', 'can:sales.create']);

// Di service/controller, untuk persetujuan:
$approver = app(ReauthService::class)->confirm($username, $password, 'purchase_requisition.approve', $request->user());
```
