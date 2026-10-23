# POS Retail SMK — Frontend

Antarmuka web POS Retail SMK menggunakan React 19, TypeScript, Vite, React Router, TanStack Query, dan Tailwind CSS. Aplikasi masih dikembangkan; halaman login dan pengelolaan produk sudah tersedia, sementara beberapa modul lain masih berupa placeholder.

## Menjalankan lokal

Pastikan Node.js dan npm tersedia. Dari folder `frontend`:

```powershell
npm install
npm run dev
```

Buka `http://localhost:5173`. Saat development, Vite meneruskan permintaan `/api` ke backend di `http://127.0.0.1:8000`; jalankan backend terlebih dahulu. Target proxy dapat diubah dengan `VITE_DEV_API_TARGET` di `.env`.

Jika API berjalan di origin berbeda, atur `VITE_API_BASE_URL` (misalnya `http://127.0.0.1:8000/api`) di `.env`. Contoh tersedia di `.env.example`.

## Pemeriksaan

```powershell
npm run typecheck
npm test
npm run build
```

## Struktur

- `src/features/`: fitur per modul, termasuk autentikasi dan produk.
- `src/components/`: komponen UI dan layout bersama.
- `src/lib/api/`: klien, tipe, dan fungsi endpoint API.
- `src/lib/format.ts`: format nilai untuk tampilan.
- `src/pages/`: halaman umum dan placeholder modul.

## Konvensi API

- Semua permintaan API menggunakan `Accept: application/json`; token autentikasi ditangani oleh klien API.
- Uang dan kuantitas tetap berupa string desimal; jangan gunakan `Number` untuk perhitungan.
- Permission di frontend hanya mengatur visibilitas menu dan tombol. Backend tetap menjadi sumber otorisasi.
- Status stok dan hasil validasi mengikuti respons backend.

Lihat [progres backend dan kontrak endpoint](../docs/BACKEND_PROGRESS.md), [handoff proyek](../docs/HANDOFF_POS_RETAIL_SMK.md), serta [panduan frontend](FRONTEND.md).
