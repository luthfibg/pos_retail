# Progres Frontend — untuk Agent Frontend dan Backend

**Satu-satunya berkas progres frontend.** Setiap pekerjaan frontend baru ditambahkan di sini (entri terbaru di atas bagian "Riwayat"), seperti `BACKEND_PROGRESS.md` untuk backend. Agent frontend baru cukup membaca berkas ini + `BACKEND_PROGRESS.md` (kontrak) + `HANDOFF_POS_RETAIL_SMK.md` (aturan) + `frontend/FRONTEND.md` (struktur dan konvensi). Kebutuhan yang belum dipenuhi kontrak API ditulis di `FRONTEND_REQUESTS.md` untuk agent backend.

**Diperbarui:** 27 Oktober 2026 · **Dikerjakan:** F#1 (fondasi, master data, inventory, karyawan, shift), F#2 (layar kasir, pengaturan diskon dan PPN), konfigurasi kebijakan endapan Admin dan penyerahan setoran akhir Kasir

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
| `/shift` | Shift Saya: buka, mulai hitung, tutup (hitung buta), serahkan setoran akhir | `shift.open`, `cash_deposit.create` | 4, 7 | ✅ | Setoran dibuat bila kebijakan endapan aktif |
| `/shifts` | Tinjau Shift (Admin) | `shift.review` | 4 | ✅ | |
| `/products` | Produk: daftar, form, stok per batch (FEFO) | `inventory.view` | HANDOFF 6, 1 | ✅ | HPP hanya tampil untuk Admin |
| `/categories` | Kategori (pohon) | `category.manage` | HANDOFF 6 | ✅ | |
| `/suppliers` | Supplier | `supplier.manage` | HANDOFF 6 | ✅ | |
| `/customers` | Karyawan: daftar, tambah, verifikasi, batas kredit, riwayat batas | `customer.select` | 2 | ✅ | Tautan dari notifikasi: `?open=ID` |
| `/inventory/opening` | Stok Awal (Admin) | `inventory.adjust.approve` | 1 | ✅ | |
| `/inventory/movements` | Riwayat Stok | `inventory.view` | 1 | ✅ | |
| `/discounts` | **Diskon** (Admin): daftar + filter, tambah, ubah, aktif/nonaktif | `discount.manage` | 9 | ✅ | Test frontend dan backend terkonfirmasi lulus |
| `/settings/vat` | **Pengaturan PPN** (Admin): saklar, tarif, harga termasuk/tidak, dialog konfirmasi | `settings.manage` | 9 | ✅ | Test frontend dan backend lulus; keputusan bisnis R-04 tetap menunggu klien |
| `/settings/float-policy` | **Kebijakan Endapan** (Admin): nominal/persentase, basis, minimum/maksimum, pembulatan | `float.configure` | 7.1 | ✅ | Wajib diatur agar penutupan shift dapat menghasilkan dokumen setoran |
| (lonceng di sidebar) | Notifikasi: polling 60 dtk, tandai terbaca | login | 3 | ✅ | Bug "lonceng kosong" pernah dilaporkan; belum diverifikasi ulang |
| `/dashboard` | Dashboard | `reports.view` | — | ⛔ | Placeholder; backend belum punya endpoint laporan (ROADMAP 6.3) |

### Backlog frontend (backend sudah siap ✅ kecuali dicatat)

| Modul | Bagian | Status | Isi layar yang bisa dibuat |
|---|---|---|---|
| Kas masuk/keluar nonpenjualan | 7.4 | ⏳ | Form kas masuk/keluar dan riwayat pada shift aktif; backend sudah tersedia di `BACKEND_PROGRESS.md` |
| Penyerahan setoran akhir (Kasir) | 7.1 | ✅ | Hasil tutup shift menampilkan nilai setoran/endapan/flag, serahkan setoran Draft, pulihkan setoran Draft setelah reload, dan tahan buka shift baru sampai setoran diserahkan |
| Fitur setoran/endapan lainnya | 7.1 | ⏳ | Kasir: setoran parsial; Finance/Admin: antrean setoran masuk (terima/selisih/koreksi) dan saldo Kas Kecil/Besar |
| Riwayat penjualan | 5, 7.2 | ⏳ | Daftar + filter, detail, **cetak ulang SALINAN**, **void** (Admin) |
| Penerimaan barang | 6.3 | ⏳ | Pilih PO `receivable=1` → qty/rusak/kedaluwarsa → posting; verifikasi dokumen (Admin) |
| PR dan PO | 6.1, 6.2 | ⏳ | Form/daftar PR (Kasir); antrean Finance/Owner dengan re-auth; PO dari PR (Admin) |
| Tagihan HRD | 8 | ⏳ | Periode tagihan (tutup periode, ubah tanggal gaji), buat invoice, terbit → serah ke HRD → catat pembayaran, tampilan cetak invoice |
| Manajemen pengguna | 10 | ⏳ | Daftar/cari/filter; tambah/ubah role; aktif/nonaktif; reset sandi; ganti sandi sendiri |
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
| Shift dan kasir | `shiftLogic`, `money`, `cartLogic` | 6 · 6 · 21 | ✅ |
| Diskon dan PPN | `discountForm`, `vatForm` (+ 2 test `toWibDate` di `format`) | 12 · 9 | ✅ |

Pada 27 Okt 2026, `npm run typecheck`, `npm test` (**109 lulus, 15 berkas**) dan `npm run build` lulus. Test otomatis mencakup logika murni; komponen React belum diuji otomatis dan tetap perlu verifikasi manual di browser.

## 4. Celah dan catatan yang diketahui

1. **Setoran akhir dan kebijakan endapan:** Kasir dapat menyerahkan setoran akhir Draft dan kebijakan laci kini dapat diatur Admin di `/settings/float-policy`. Tanpa kebijakan aktif, backend mempertahankan seluruh kas terhitung sebagai endapan dan tidak membuat dokumen setoran. Atur kebijakan sebelum menguji setoran akhir. Setoran parsial, antrean penerimaan Finance, dan saldo dana belum dibuat. **Fitur kas lengkap tetap prasyarat go-live.**
2. **Pratinjau penjualan (FR-01) ⛔:** tanpa `POST /api/sales/preview`, kasir tidak melihat total resmi sebelum memproses (diskon dan PPN baru tampak di struk). Layar sudah siap memakainya dan akan berpindah otomatis begitu endpoint ada.
3. **Hasil transaksi tidak diketahui:** bila jaringan putus saat posting, keranjang dikunci dan hanya bisa kirim ulang dengan kunci yang sama. Bila tab ditutup sebelum itu, struk mungkin tersimpan tetapi tidak terlihat; **riwayat penjualan** (⏳) menutup celah ini.
4. **Cetak struk:** memakai `window.print` dan lebar kecil di layar; penyesuaian kertas thermal 58/80 mm dan uji printer/scanner di perangkat klien belum dilakukan (ROADMAP 6.1, 7.4).
5. **Karyawan pada penjualan tunai** tidak dipilih di kasir (hanya kredit); backend mengizinkan `customer_id` untuk tunai.
6. **Menu "Dashboard"** tampil untuk Kasir (izin `reports.view` ada pada subset Kasir) dan membuka placeholder.
7. **Diskon `amount`** adalah potongan **per unit** (dikalikan qty di server, dibatasi harga baris); label di form dan tabel sudah menyatakannya.
8. **Tanggal diskon** berupa batas hari WIB yang disimpan UTC; form hanya mengirim tanggal bila diubah agar jam mulai tidak bergeser.

## 5. Tahap berikutnya (urut, usulan agent)

1. **Lanjutkan setoran dan endapan** (bagian 7): setoran akhir Kasir dan kebijakan endapan Admin selesai; berikutnya setoran parsial, antrean setoran masuk dan saldo dana (Finance/Admin).
2. **Manajemen pengguna**: UI Admin untuk mengelola akun dan ganti sandi. Backend bagian 10 sudah lulus test; frontend belum dibuat.
3. **Riwayat penjualan**: daftar, detail, cetak ulang SALINAN, void Admin. Menutup celah nomor 3.
4. **Penerimaan barang** oleh Kasir (jalur resmi stok masuk), lalu PR/PO.
5. **Tagihan HRD** (Admin).
6. Dashboard setelah backend menyediakan laporan.

Jika jadwal mundur, yang tidak boleh dipotong: layar kasir, setoran + endapan, tagihan HRD (HANDOFF bagian 7).

## 6. Permintaan ke backend

Lihat `FRONTEND_REQUESTS.md`. Terbuka: **FR-01** pratinjau penjualan (Diminta). Backend bagian 9 (diskon/PPN) dan bagian 10 (manajemen pengguna) sudah lulus test; UI manajemen pengguna masih belum dibuat.

## 7. Cara memperbarui berkas ini

1. Setiap layar atau modul selesai ditulis: tambahkan/ubah barisnya di bagian 1 dengan status 🟡, catat berkas utamanya, dan tambahkan entri di Riwayat.
2. Setelah pengguna menjalankan `npm run typecheck` dan `npm test` hijau (dan, bila perlu, mencoba layarnya): ubah 🟡 → ✅ dan perbarui jumlah test di bagian 3.
3. Kebutuhan yang butuh backend: tulis di `FRONTEND_REQUESTS.md`, tandai ⛔ di sini.
4. Jangan menandai ✅ sebelum pengguna menjalankan test (aturan kerja HANDOFF bagian 8 butir 5, berlaku juga untuk frontend).

## Riwayat

- **2026-10-27** — Tahap frontend kebijakan endapan Admin (`/settings/float-policy`): konfigurasi endapan laci dengan nominal/persentase, basis, batas minimum/maksimum, pembulatan, dan alasan perubahan. Dokumen setoran akhir hanya dibuat saat kebijakan aktif; tanpa kebijakan, seluruh kas terhitung menjadi endapan. `npm run typecheck`, `npm test` (**109 lulus**) dan `npm run build` lulus.
- **2026-10-26** — Tahap frontend setoran akhir Kasir: layar Shift menampilkan setoran/endapan dan flag tutup shift, konfirmasi penyerahan ke Finance, pencarian setoran Draft final setelah reload, serta mencegah buka shift baru sampai setoran diserahkan. `npm run typecheck`, `npm test` (**104 lulus**) dan `npm run build` lulus. Setoran parsial dan penerimaan Finance belum dikerjakan.
- **2026-10-26** — Pengguna menjalankan `npm run typecheck` (lulus), `npm test` (**102 lulus**) dan backend `php artisan test` (**200 lulus**). Diskon/PPN dikonfirmasi ✅; backend manajemen pengguna dikonfirmasi ✅, UI-nya masuk backlog.
- **2026-10-25 (2)** — F#2: pengaturan harga untuk Admin: **Diskon** (`/discounts`, daftar + filter + form tambah/ubah, target produk atau kategori, jenis persen/nominal per unit, tanggal WIB) dan **Pengaturan PPN** (`/settings/vat`, dengan konfirmasi dan peringatan R-04); `toWibDate`; menu "Diskon" dan "Pengaturan PPN". Status: 🟡 menunggu `npm test` pengguna dan test backend bagian 9.
- **2026-10-25** — F#2: **layar kasir** (`/pos`): pencarian/scan, keranjang, tunai dan kredit potong gaji, pratinjau server (siap pakai, menunggu FR-01), pengecualian kredit Admin, struk cetak, kunci idempotensi dan penguncian saat hasil tidak diketahui; `lib/money.ts`; tipe `Sale`/`Shift` baru; `FRONTEND_REQUESTS.md` dengan FR-01. Status: ✅ diuji manual dan test hijau (pengguna, 25 Okt 2026).
- **sebelumnya (F#1)** — Fondasi (Vite + React 19 + TS + TanStack Query + Tailwind v4), auth/guard, produk, kategori, supplier, stok awal, riwayat stok, karyawan + notifikasi, shift kasir dan tinjau shift. Status: ✅.
