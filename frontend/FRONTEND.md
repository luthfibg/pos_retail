# Frontend POS Retail SMK — Panduan

Stack: Vite + React 19 + TypeScript (strict) · React Router · TanStack Query · Tailwind v4 · Vitest.

## Menjalankan (Windows PowerShell)
```powershell
cd frontend
npm install
npm run dev        # http://localhost:5173, /api diproxy ke http://127.0.0.1:8000
npm run typecheck
npm test
```
Backend harus jalan (`php artisan serve`). Login memakai akun hasil `php artisan db:seed`.

## Struktur
- `src/lib/api/` — `client.ts` (fetch, Bearer, ApiError, 401), `types.ts` (kontrak API), `endpoints.ts` (per modul)
- `src/features/<modul>/` — layar + hook per modul (auth, products, ...)
- `src/components/ui|layout/` — komponen bersama; `layout/nav.ts` = satu sumber menu + permission
- `src/lib/format.ts` — format Rupiah/qty/waktu (WIB). Hanya tampilan.

## Konvensi (mengikuti handoff backend)
1. Uang/qty = **string desimal**. Jangan `Number` untuk perhitungan; total keranjang dihitung server atau pakai pustaka desimal.
2. Semua request `Accept: application/json` (sudah di `api()`).
3. Permission di UI hanya untuk menyembunyikan menu/tombol; validasi sebenarnya di backend (tangani 403/422).
4. Respons: sukses `{data}`, paginasi Laravel, 422 `{message, errors}`.
5. Posting transaksi (penjualan, setoran) wajib cegah klik ganda. Penjualan memakai `idempotency_key` (UUID) di **body**, dibuat sekali per keranjang dan dikirim ulang apa adanya bila hasil tidak diketahui (bukan header).
6. Tambah endpoint baru: tipe di `types.ts` → fungsi di `endpoints.ts` → hook/layar di `features/`.
7. Status stok memakai `stock_status` dari backend; jangan hitung ulang di klien.
8. Kebutuhan yang belum dipenuhi kontrak API ditulis di `docs/FRONTEND_REQUESTS.md` untuk agent backend; jangan menghitung ulang aturan bisnis (harga, diskon, PPN) di klien sebagai gantinya. `src/lib/money.ts` (bilangan bulat, tanpa float) hanya untuk tampilan dan validasi.
