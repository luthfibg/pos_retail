# Progres Frontend — untuk Agent Frontend dan Backend

**Satu-satunya berkas progres frontend.** Setiap pekerjaan frontend baru ditambahkan di sini (entri terbaru di atas bagian "Riwayat"), seperti `BACKEND_PROGRESS.md` untuk backend. Agent frontend baru cukup membaca berkas ini + `BACKEND_PROGRESS.md` (kontrak) + `HANDOFF_POS_RETAIL_SMK.md` (aturan) + `frontend/FRONTEND.md` (struktur dan konvensi). Kebutuhan yang belum dipenuhi kontrak API ditulis di `FRONTEND_REQUESTS.md` untuk agent backend.

**Diperbarui:** 25 Oktober 2026 · **Dikerjakan:** F#1 (fondasi, master data, inventory, karyawan, shift), F#2 (layar kasir, **pengaturan diskon dan PPN — terbaru**)

## Cara membaca status

| Tanda | Arti |
|---|---|
| ✅ | Ditulis, dan pengguna sudah menjalankan `npm run typecheck` + `npm test` dengan hasil hijau. Bila tertulis "diuji manual", pengguna juga sudah mencoba layarnya di browser |
| 🟡 | Ditulis dan diperiksa agent (typecheck parsial + test logika di lingkungan agent), **belum dikonfirmasi pengguna** di mesin sendiri atau di browser. Bila kontrak backend-nya masih 🟡, tertulis juga |
| ⏳ | Belum dikerjakan |
| ⛔ | Menunggu backend (lihat `FRONTEND_REQUESTS.md` atau `BACKEND_PROGRESS.md`) |

## Menjalankan dan memverifikasi (Windows PowerShell)

```powershell
cd frontend
npm install
npm run typecheck
npm test            # vitest, environment node
npm run dev         # http://localhost:5173, /api diproxy ke http://127.0.0.1:8000
```
Test otomatis hanya mencakup **logika murni** (validasi, penyusun payload, aritmetika, pemeta error). Komponen React belum diuji otomatis; verifikasinya manual di browser.

## Konvensi yang berlaku (ringkas; rujukan lengkap di `frontend/FRONTEND.md`)

1. Uang dan qty = string desimal; jangan `Number` untuk perhitungan. Perkiraan tampilan memakai `src/lib/money.ts` (bilangan bulat). Harga, diskon, PPN, dan total **resmi dari server**; frontend tidak menghitung ulang aturan bisnis.
2. Waktu API = UTC, tampil WIB (`formatDateTime`). Tanggal murni tidak digeser (`formatDate`). Batas hari WIB yang disimpan UTC dibaca lewat `toWibDate`.
3. Izin hanya menyembunyikan menu/tombol; keputusan akhir di backend (tangani 403/422).
4. Aksi finansial: cegah kirim ganda, konfirmasi bila tidak dapat dibatalkan. Penjualan memakai `idempotency_key` (UUID) di **body**, satu per keranjang.
5. Status ditampilkan sebagai teks, bukan hanya warna.
6. Logika murni dipisah dari komponen dan diberi test. Satu fitur = tipe di `types.ts` → fungsi di `endpoints.ts` → logika murni + test → layar.

## 1. Peta layar

| Route | Layar | Izin | Bagian `BACKEND_PROGRESS` | Status | Catatan |
|---|---|---|---|---|---|
| `/login` | Login | — | HANDOFF 6 | ✅ | Throttle 429 ditangani |
| `/pos` | **Kasir**: scan/cari produk, keranjang, tunai dan kredit potong gaji, pemilih karyawan, konfirmasi, struk cetak, pengecualian kredit Admin | `sales.create` | 4, 5 | ✅ diuji manual | Total resmi dari pratinjau server ⛔ FR-01; sementara memakai "perkiraan subtotal" |
| `/shift` | Shift Saya: buka, mulai hitung, tutup (hitung buta) | `shift.open` | 4 | ✅ | Belum menampilkan setoran/endapan (lihat bagian 4) |
| `/shifts` | Tinjau Shift (Admin) | `shift.review` | 4 | ✅ | |
| `/products` | Produk: daftar, form, stok per batch (FEFO) | `inventory.view` | HANDOFF 6, 1 | ✅ | HPP hanya tampil untuk Admin |
| `/categories` | Kategori (pohon) | `category.manage` | HANDOFF 6 | ✅ | |
| `/suppliers` | Supplier | `supplier.manage` | HANDOFF 6 | ✅ | |
| `/customers` | Karyawan: daftar, tambah, verifikasi, batas kredit, riwayat batas | `customer.select` | 2 | ✅ | Tautan dari notifikasi: `?open=ID` |
| `/inventory/opening` | Stok Awal (Admin) | `inventory.adjust.approve` | 1 | ✅ | |
| `/inventory/movements` | Riwayat Stok | `inventory.view` | 1 | ✅ | |
| `/discounts` | **Diskon** (Admin): daftar + filter, tambah, ubah, aktif/nonaktif | `discount.manage` | 9 | 🟡 | Kontrak bagian 9 backend masih 🟡 (`PricingSettingsTest` belum dikonfirmasi) |
| `/settings/vat` | **Pengaturan PPN** (Admin): saklar, tarif, harga termasuk/tidak, dialog konfirmasi | `settings.manage` | 9 | 🟡 | R-04 (tarif/PKP) menunggu klien; ada peringatan di layar |
| (lonceng di sidebar) | Notifikasi: polling 60 dtk, tandai terbaca | login | 3 | ✅ | Bug "lonceng kosong" pernah dilaporkan; belum diverifikasi ulang |
| `/dashboard` | Dashboard | `reports.view` | — | ⛔ | Placeholder; backend belum punya endpoint laporan (ROADMAP 6.3) |

### Belum ada layarnya (backend sudah siap ✅ kecuali dicatat)

| Modul | Bagian | Status | Isi layar yang bisa dibuat |
|---|---|---|---|
| Setoran dan endapan | 7 | ⏳ | Hasil tutup shift (`deposit`, `float_flags`), tombol **Serahkan setoran**, setoran parsial; Admin: kebijakan endapan; Finance/Admin: antrean setoran masuk (terima/selisih/koreksi), saldo Kas Kecil/Besar |
| Riwayat penjualan | 5, 7.2 | ⏳ | Daftar + filter, detail, **cetak ulang SALINAN**, **void** (Admin) |
| Penerimaan barang | 6.3 | ⏳ | Pilih PO `receivable=1` → qty/rusak/kedaluwarsa → posting; verifikasi dokumen (Admin) |
| PR dan PO | 6.1, 6.2 | ⏳ | Form/daftar PR (Kasir); antrean Finance/Owner dengan re-auth; PO dari PR (Admin) |
| Tagihan HRD | 8 | ⏳ | Periode tagihan (tutup periode, ubah tanggal gaji), buat invoice, terbit → serah ke HRD → catat pembayaran, tampilan cetak invoice |
| Adjustment, opname, transfer, denah rak | — | ⛔ | Backend belum ada |

## 2. Kode bersama (fondasi)

| Berkas | Fungsi |
|---|---|
| `lib/api/client.ts` | `fetch` + Bearer + `ApiError` (`status`, `errors`, `firstError()`); 401 pada sesi berjalan memicu keluar |
| `lib/api/types.ts` | Kontrak API (satu-satunya sumber tipe) |
| `lib/api/endpoints.ts` | Fungsi per modul: `authApi`, `productApi`, `categoryApi`, `supplierApi`, `inventoryApi`, `customerApi`, `notificationApi`, `shiftApi`, `saleApi`, `discountApi`, `settingsApi` |
| `lib/format.ts` | `formatRupiah`, `formatQty`, `formatDateTime` (WIB), `formatDate`, `toWibDate` |
| `lib/money.ts` | Aritmetika uang/qty berbasis bigint untuk **tampilan dan validasi** (bukan keputusan transaksi) |
| `components/layout/nav.ts` | Satu sumber menu + izin; `AppLayout` menyaring per izin |
| `components/ui/*` | `Modal`, `Field`, `ErrorNotice`, `Pagination`, badge status |
| `features/auth/*` | `AuthProvider` (`can(permission)`), guard rute |
| `features/sales/cartLogic.ts` | Keranjang, validasi, penyusun payload penjualan, pemeta error 422, kunci idempotensi |

## 3. Gerbang kualitas

| Kelompok | Berkas test | Jumlah | Status |
|---|---|---|---|
| Fondasi dan master data | `format`, `productForm`, `supplierForm`, `tree` | 9 · 10 · 7 · 3 | ✅ |
| Inventory dan karyawan | `openingForm`, `movementLabels`, `customerForm`, `creditState`, `notificationLink` | 6 · 2 · 8 · 2 · 3 | ✅ |
| Shift dan kasir | `shiftLogic`, `money`, `cartLogic` | 4 · 6 · 21 | ✅ (hijau dikonfirmasi pengguna 25 Okt 2026; jumlah dihitung dari kode: 81 test sebelum tahap diskon/PPN) |
| Diskon dan PPN | `discountForm`, `vatForm` (+ 2 test `toWibDate` di `format`) | 12 · 9 | 🟡 menunggu pengguna menjalankan `npm test` (total seharusnya **102**) |

Jumlah dihitung dari kode test. Di lingkungan agent, seluruh 102 test lolos lewat harness lokal dan `tsc` bersih untuk modul logika serta komponen penjualan/diskon/PPN (komponen React diperiksa dengan tipe tiruan, bukan tipe React sebenarnya), jadi `npm run typecheck` pengguna tetap yang menentukan.

## 4. Celah dan catatan yang diketahui

1. **Setoran tanpa layar:** begitu Admin menetapkan kebijakan endapan (API `PUT /api/float-policies/{scope}`; belum ada layarnya), Kasir yang menutup shift mendapat setoran akhir `draft` dan **tidak bisa membuka shift baru** sebelum menyerahkannya, padahal UI belum punya tombolnya. Tanpa kebijakan aktif perilakunya sama seperti sebelumnya. Tipe `Shift.deposit`, `float_flags`, dan `summary.partial_deposits` sudah ada di `types.ts`. **Ini prasyarat go-live.**
2. **Pratinjau penjualan (FR-01) ⛔:** tanpa `POST /api/sales/preview`, kasir tidak melihat total resmi sebelum memproses (diskon dan PPN baru tampak di struk). Layar sudah siap memakainya dan akan berpindah otomatis begitu endpoint ada.
3. **Hasil transaksi tidak diketahui:** bila jaringan putus saat posting, keranjang dikunci dan hanya bisa kirim ulang dengan kunci yang sama. Bila tab ditutup sebelum itu, struk mungkin tersimpan tetapi tidak terlihat; **riwayat penjualan** (⏳) menutup celah ini.
4. **Cetak struk:** memakai `window.print` dan lebar kecil di layar; penyesuaian kertas thermal 58/80 mm dan uji printer/scanner di perangkat klien belum dilakukan (ROADMAP 6.1, 7.4).
5. **Karyawan pada penjualan tunai** tidak dipilih di kasir (hanya kredit); backend mengizinkan `customer_id` untuk tunai.
6. **Menu "Dashboard"** tampil untuk Kasir (izin `reports.view` ada pada subset Kasir) dan membuka placeholder.
7. **Diskon `amount`** adalah potongan **per unit** (dikalikan qty di server, dibatasi harga baris); label di form dan tabel sudah menyatakannya.
8. **Tanggal diskon** berupa batas hari WIB yang disimpan UTC; form hanya mengirim tanggal bila diubah agar jam mulai tidak bergeser.

## 5. Tahap berikutnya (urut, usulan agent)

1. **Setoran dan endapan** (bagian 7): hasil tutup shift + Serahkan setoran (Kasir), kebijakan endapan (Admin), antrean setoran masuk dan saldo dana (Finance/Admin). Menutup celah nomor 1.
2. **Riwayat penjualan**: daftar, detail, cetak ulang SALINAN, void Admin. Menutup celah nomor 3.
3. **Penerimaan barang** oleh Kasir (jalur resmi stok masuk), lalu PR/PO.
4. **Tagihan HRD** (Admin).
5. Dashboard setelah backend menyediakan laporan.

Jika jadwal mundur, yang tidak boleh dipotong: layar kasir, setoran + endapan, tagihan HRD (HANDOFF bagian 7).

## 6. Permintaan ke backend

Lihat `FRONTEND_REQUESTS.md`. Terbuka: **FR-01** pratinjau penjualan (Diminta). Selain itu frontend menunggu konfirmasi test untuk bagian 9 `BACKEND_PROGRESS.md` (diskon/PPN) sebelum menandai layarnya ✅.

## 7. Cara memperbarui berkas ini

1. Setiap layar atau modul selesai ditulis: tambahkan/ubah barisnya di bagian 1 dengan status 🟡, catat berkas utamanya, dan tambahkan entri di Riwayat.
2. Setelah pengguna menjalankan `npm run typecheck` dan `npm test` hijau (dan, bila perlu, mencoba layarnya): ubah 🟡 → ✅ dan perbarui jumlah test di bagian 3.
3. Kebutuhan yang butuh backend: tulis di `FRONTEND_REQUESTS.md`, tandai ⛔ di sini.
4. Jangan menandai ✅ sebelum pengguna menjalankan test (aturan kerja HANDOFF bagian 8 butir 5, berlaku juga untuk frontend).

## Riwayat

- **2026-10-25 (2)** — F#2: pengaturan harga untuk Admin: **Diskon** (`/discounts`, daftar + filter + form tambah/ubah, target produk atau kategori, jenis persen/nominal per unit, tanggal WIB) dan **Pengaturan PPN** (`/settings/vat`, dengan konfirmasi dan peringatan R-04); `toWibDate`; menu "Diskon" dan "Pengaturan PPN". Status: 🟡 menunggu `npm test` pengguna dan test backend bagian 9.
- **2026-10-25** — F#2: **layar kasir** (`/pos`): pencarian/scan, keranjang, tunai dan kredit potong gaji, pratinjau server (siap pakai, menunggu FR-01), pengecualian kredit Admin, struk cetak, kunci idempotensi dan penguncian saat hasil tidak diketahui; `lib/money.ts`; tipe `Sale`/`Shift` baru; `FRONTEND_REQUESTS.md` dengan FR-01. Status: ✅ diuji manual dan test hijau (pengguna, 25 Okt 2026).
- **sebelumnya (F#1)** — Fondasi (Vite + React 19 + TS + TanStack Query + Tailwind v4), auth/guard, produk, kategori, supplier, stok awal, riwayat stok, karyawan + notifikasi, shift kasir dan tinjau shift. Status: ✅.
