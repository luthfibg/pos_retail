# Seeder, Auth, dan RBAC — Tahap 1 (langkah 2)

Paket ini menambah: seeder data awal, login/logout/me (Sanctum), RBAC berbasis tabel
`permissions`, audit logger, layanan autentikasi ulang untuk persetujuan, dan test.
**Kode ini belum dijalankan** (PHP tidak tersedia di lingkungan penyusun); langkah 6 adalah
verifikasi pertamanya.

## 0. Prasyarat: Sanctum harus terpasang
Kode memakai `Laravel\Sanctum\HasApiTokens`. Jika muncul error `Trait "Laravel\Sanctum\HasApiTokens" not found`,
Sanctum belum terpasang. Jalankan di root proyek:
```powershell
php artisan install:api      # memasang Sanctum, menerbitkan migration token, mendaftarkan routes/api.php
php artisan migrate          # membuat tabel personal_access_tokens (jangan migrate:fresh lagi)
```
Verifikasi: `composer show laravel/sanctum` menampilkan versi, `php artisan route:list --path=api` menampilkan 3 route
(`auth/login`, `auth/logout`, `auth/me`). Jika route tidak muncul, pastikan `bootstrap/app.php` memuat
`api: __DIR__.'/../routes/api.php'` di dalam `->withRouting(...)`.
(Laravel 10 atau lebih lama: `composer require laravel/sanctum`, lalu `php artisan vendor:publish --provider="Laravel\Sanctum\SanctumServiceProvider"`.)

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
Jalankan server di terminal terpisah: `php artisan serve`.

**PowerShell (Windows)** — di PowerShell `curl` adalah alias `Invoke-WebRequest`, dan karakter `\` untuk
lanjut baris hanya berlaku di bash. Pakai `Invoke-RestMethod`:
```powershell
$body = @{ username = "admin"; password = "PASSWORD_ADMIN" } | ConvertTo-Json
$res = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/auth/login" -Method Post `
  -ContentType "application/json" -Headers @{ Accept = "application/json" } -Body $body
$res.token

Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/auth/me" `
  -Headers @{ Accept = "application/json"; Authorization = "Bearer $($res.token)" } |
  ConvertTo-Json -Depth 5
```
**bash/macOS/Linux:**
```bash
curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"PASSWORD_ADMIN"}'
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

## 5b. Cara paling andal: `.env.testing`
Jika test masih membaca `pos_retail` (nilai `phpunit.xml` tidak terbaca: baris masih berada di dalam komentar
`<!-- ... -->`, file belum tersimpan, atau ada config cache), buat `.env.testing`. Saat test berjalan Laravel
memakai file ini sebagai pengganti `.env`:
```powershell
Copy-Item .env .env.testing
# edit .env.testing: APP_ENV=testing, DB_CONNECTION=mysql, DB_DATABASE=pos_retail_test
php artisan config:clear
php artisan test
```
Diagnosis bila masih gagal:
```powershell
Select-String -Path phpunit.xml -Pattern "DB_"
Test-Path bootstrap\cache\config.php
```

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
