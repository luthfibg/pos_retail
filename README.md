# POS Retail SMK

Aplikasi POS untuk toko retail di lingkungan pabrik. Mendukung penjualan tunai dan kredit karyawan dengan tagihan gabungan untuk HRD.

Proyek masih dalam pengembangan. Backend saat ini mencakup autentikasi, hak akses, master data, karyawan, notifikasi, dan fondasi inventory. Frontend sedang dikembangkan; alur pembelian, POS, shift, dan invoice belum lengkap. Lihat [progres backend](docs/BACKEND_PROGRESS.md) untuk status dan kontrak API terkini.

## Teknologi

- Backend: PHP 8.3+, Laravel 13, Sanctum, MySQL 8.0.16+
- Frontend: React, TypeScript, Vite

## Menjalankan lokal

Siapkan database MySQL `pos_retail`, lalu jalankan backend:

```powershell
cd backend
composer install
Copy-Item .env.example .env
```

Atur `DB_*` di `backend/.env` untuk MySQL, kemudian:

```powershell
php artisan key:generate
php artisan migrate
php artisan db:seed
php artisan serve
```

Seeder menampilkan kredensial awal Admin satu kali; simpan dengan aman.

Di terminal lain, jalankan frontend:

```powershell
cd frontend
npm install
npm run dev
```

Buka URL Vite yang ditampilkan (umumnya `http://localhost:5173`). Permintaan `/api` otomatis diteruskan ke backend di `http://127.0.0.1:8000`.

## Pemeriksaan

- Backend: `php artisan test` dari `backend`. Gunakan database MySQL khusus test bernama `pos_retail_test`; test ditolak jika nama database tidak berakhiran `_test`.
- Frontend: `npm test` atau `npm run build` dari `frontend`.

## Dokumentasi

- [Progres backend dan endpoint](docs/BACKEND_PROGRESS.md)
- [Handoff dan aturan bisnis/arsitektur](docs/HANDOFF_POS_RETAIL_SMK.md)
- [ERD](docs/erd_paket1.md) dan [skema database](docs/schema_paket1.sql)
