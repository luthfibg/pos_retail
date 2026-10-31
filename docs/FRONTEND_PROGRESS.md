# Progres Frontend — untuk Agent Frontend dan Backend

**Satu-satunya berkas progres frontend.** Setiap pekerjaan frontend baru ditambahkan di sini (entri terbaru di atas bagian "Riwayat"), seperti `BACKEND_PROGRESS.md` untuk backend. Agent frontend baru cukup membaca berkas ini + `BACKEND_PROGRESS.md` (kontrak) + `HANDOFF_POS_RETAIL_SMK.md` (aturan) + `frontend/FRONTEND.md` (struktur dan konvensi). Kebutuhan yang belum dipenuhi kontrak API ditulis di `FRONTEND_REQUESTS.md` untuk agent backend.

**Diperbarui:** 31 Oktober 2026 · **Dikerjakan:** F#1 (fondasi, master data, inventory, karyawan, shift), F#2 (layar kasir, pengaturan diskon dan PPN), konfigurasi kebijakan endapan Admin, setoran, riwayat penjualan, penerimaan barang dan lampiran privat, alur PR/PO, adjustment/opname, transfer stok, Dashboard, Tagihan HRD, Manajemen Pengguna, Management Retail

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
| (layout) | Sidebar: menu Kasir/Shift Saya disembunyikan untuk Admin; kelompok menu abu tipis dan submenu putih; workspace kanan yang dapat discroll | permission | — | 🟡 | Sidebar tetap di viewport; menunggu verifikasi browser |
| `/pos` | **Kasir**: scan/cari produk, keranjang, tunai dan kredit potong gaji, pemilih karyawan, konfirmasi, struk cetak, pengecualian kredit Admin | `sales.create` | 4, 5 | 🟡 | Integrasi pratinjau FR-01 selesai; uji klik integrasi terbaru menunggu pengguna |
| `/shift` | Shift Saya: buka, mulai hitung, tutup (hitung buta), catat kas masuk/keluar, setoran parsial dan serahkan setoran akhir | `shift.open`, `cash_deposit.create`, `cash_movement.create` | 4, 7 | 🟡 | UI parsial baru dibuat; menunggu verifikasi browser |
| `/shifts` | Tinjau Shift (Admin) | `shift.review` | 4 | ✅ | |
| `/cash-deposits` | Setoran Masuk: antrean, penerimaan Finance, koreksi selisih, saldo Kas Kecil/Besar | `cash_deposit.receive` | 7.1 | 🟡 | UI baru dibuat; menunggu verifikasi browser |
| `/sales` | Riwayat Penjualan: daftar/filter, detail struk, cetak SALINAN, void sesuai izin/status shift/tagihan | `sales.create`, `receipt.reprint`, `sales.void` | 5, 7.2 | ✅ | Pengguna mengonfirmasi uji klik berjalan lancar (27 Okt 2026) |
| `/goods-receipts` | Penerimaan barang: PO receivable, qty diterima/rusak, batch/kedaluwarsa, Draft/posting, lampiran privat, verifikasi dokumen Admin | `goods_receipt.create`, `goods_receipt.verify_documents` | 6.3, 4.4–4.5 | 🟡 | Upload/unduh lampiran JPEG/PNG/WebP/PDF tersedia pada detail GR; menunggu verifikasi browser. UI pemilih lokasi/putaway belum dibuat |
| `/purchase-requisitions` | Permintaan Pembelian: Kasir mengelola PR sendiri; Finance memeriksa; Owner menyetujui; Purchasing membuat, mengajukan, mengonfirmasi, dan mengirim PO | `purchase_requisition.create`, `purchase_requisition.finance_check`, `purchase_requisition.approve`, `purchase_order.create`, `purchase_order.send` | 6.1–6.2 | 🟡 | Aksi mengikuti permission, bukan nama role; menunggu uji klik Admin PR/PO |
| `/products` | Produk: daftar, form, stok per batch (FEFO) | `inventory.view` | HANDOFF 6, 1 | ✅ | HPP hanya tampil untuk Admin |
| `/categories` | Kategori (pohon) | `category.manage` | HANDOFF 6 | ✅ | |
| `/suppliers` | Supplier | `supplier.manage` | HANDOFF 6 | ✅ | |
| `/customers` | Karyawan: daftar, tambah, verifikasi, batas kredit, riwayat batas | `customer.select` | 2 | ✅ | Tautan dari notifikasi: `?open=ID` |
| `/inventory/opening` | Stok Awal (Admin) | `inventory.adjust.approve` | 1 | ✅ | |
| `/inventory/movements` | Riwayat Stok | `inventory.view` | 1 | ✅ | |
| `/inventory/transfers` | Transfer antar lokasi/posisi: Draft, detail, posting, pembatalan | `stock_transfer.create` | 1 | 🟡 | Implementasi awal tersedia; katalog posisi rak belum tersedia di API sehingga ID posisi tujuan diisi opsional; menunggu uji klik |
| `/inventory/adjustments` | Adjustment & Opname: Draft snapshot, pengajuan, approval/rejection dan posting | `inventory.adjust.request`, `inventory.adjust.approve` | 2.7 | 🟡 | Implementasi dan test logika tersedia; menunggu uji klik |
| `/discounts` | **Diskon** (Admin): daftar + filter, tambah, ubah, aktif/nonaktif | `discount.manage` | 9 | ✅ | Test frontend dan backend terkonfirmasi lulus |
| `/settings/vat` | **Pengaturan PPN** (Admin): saklar, tarif, harga termasuk/tidak, dialog konfirmasi | `settings.manage` | 9 | ✅ | Test frontend dan backend lulus; keputusan bisnis R-04 tetap menunggu klien |
| `/settings/float-policy` | **Kebijakan Endapan** (Admin): nominal/persentase, basis, minimum/maksimum, pembulatan | `float.configure` | 7.1 | ✅ | Wajib diatur agar penutupan shift dapat menghasilkan dokumen setoran |
| (lonceng di sidebar) | Notifikasi: polling 60 dtk, tandai terbaca | login | 3 | ✅ | Bug "lonceng kosong" pernah dilaporkan; belum diverifikasi ulang |
| `/dashboard` | Dashboard: filter tanggal/kasir, ringkasan penjualan dan kas, grafik harian, stok menipis/kedaluwarsa, saldo akun dana sesuai izin | `reports.view` | 6.3 | 🟡 | Pengguna mengonfirmasi tampilan dan filter; automated tests/typecheck/build dijalankan agent |
| `/billing` | Tagihan HRD: periode kredit, tutup periode, rincian per karyawan, invoice, penerbitan/serah HRD, pembayaran sebagian, cetak invoice | `billing_period.manage`, `billing_period.close`, `invoice.generate`, `invoice.issue`, `invoice.record_payment` | 8 | 🟡 | Pengguna mengonfirmasi uji klik berjalan lancar; automated tests/typecheck/build dijalankan agent |
| `/users` | Manajemen pengguna: cari/filter, tambah/ubah, role, aktif/nonaktif, reset sandi | `user.manage` | 10 | 🟡 | UI tersedia; menunggu uji klik pengguna |
| `/platform/stores` | Management Retail: daftar/cari/filter tenant, detail dan Admin toko, onboarding tenant + akun Admin awal, aktif/nonaktif tenant | `platform_operator` | Backend Management Retail | 🟡 | UI operator memakai shell terpisah dari POS; akses tenant dialihkan kembali ke `/platform/stores`. Operator masuk via CLI/tiket sekali pakai; password Admin awal tidak ditahan di cache mutation frontend. Pemulihan kredensial hanya melalui CLI server. Typecheck, 161 test, dan build lulus; menunggu uji klik |
| (profil sidebar) | Ganti sandi sendiri; sesi lain diakhiri | login | 10 | 🟡 | UI tersedia untuk semua pengguna; sesi saat ini tetap aktif |

### Backlog frontend (backend sudah siap ✅ kecuali dicatat)

| Modul | Bagian | Status | Isi layar yang bisa dibuat |
|---|---|---|---|
| Kas masuk/keluar nonpenjualan | 7.4 | ✅ | Form kas masuk/keluar berkonfirmasi dan riwayat berpaginasi di halaman Shift; perubahan kas hanya saat shift aktif. Otomatisasi frontend lulus dan pengguna sudah menguji alur klik tanpa kendala |
| Penyerahan setoran akhir (Kasir) | 7.1 | ✅ | Hasil tutup shift menampilkan nilai setoran/endapan/flag, serahkan setoran Draft, pulihkan setoran Draft setelah reload, dan tahan buka shift baru sampai setoran diserahkan |
| Fitur setoran/endapan lainnya | 7.1 | 🟡 | Pengguna telah menguji pembuatan Draft setoran parsial Kasir dan mengonfirmasi hasil sesuai ekspektasi. Uji serah/batal Draft, blokir tutup shift, antrean/penerimaan Finance, koreksi selisih, dan saldo dana masih menunggu |
| Transfer stok antarposisi / putaway | 1 | 🟡 | `/inventory/transfers`: daftar/filter, buat Draft dari saldo sellable, detail, posting, dan pembatalan Draft. Katalog posisi rak belum tersedia di API; input ID posisi tujuan opsional |
| Adjustment dan opname | 2.7 | 🟡 | `/inventory/adjustments`: buat Draft snapshot saldo sellable, ajukan, batalkan, antrean/detail, approve/reject, re-auth untuk loss/expired, dan posting atomik. Backend mengizinkan approver membaca antrean/detail tanpa permission request. Menunggu uji klik; belum ada sesi opname terpisah |
| Riwayat penjualan | 5, 7.2 | ✅ | `/sales`: daftar + filter, detail, **cetak ulang SALINAN**, **void** Admin; pengguna mengonfirmasi uji klik berjalan lancar |
| Penerimaan barang | 6.3 | 🟡 | `/goods-receipts`: pilih PO `receivable=1`, catat diterima/rusak, pecah batch, validasi kedaluwarsa, simpan Draft, posting, batalkan Draft, unggah/unduh lampiran privat, dan verifikasi surat jalan/faktur (Admin); menunggu uji klik |
| PR/PO | 6.1, 6.2 | 🟡 | PR Kasir dan Admin: alur Finance/Owner serta PO per supplier tersedia; menunggu uji klik. |
| Tagihan HRD | 8 | 🟡 | `/billing`: periode buka/ubah/tutup, invoice per periode, terbit/serah HRD, pembayaran sebagian dan cetak invoice; menunggu uji klik |
| Manajemen pengguna | 10 | 🟡 | `/users`: daftar/cari/filter; tambah/ubah role; aktif/nonaktif; reset sandi Admin. Tombol “Ganti sandi” tersedia bagi semua pengguna; menunggu uji klik |
| Denah rak | — | ⛔ | Backend belum ada |

## 2. Kode bersama (fondasi)

| Berkas | Fungsi |
|---|---|
| `lib/api/client.ts` | `fetch` + Bearer + `ApiError` (`status`, `errors`, `firstError()`); 401 pada sesi berjalan memicu keluar |
| `lib/api/types.ts` | Kontrak API (satu-satunya sumber tipe) |
| `lib/api/endpoints.ts` | Fungsi per modul: `authApi`, `productApi`, `categoryApi`, `supplierApi`, `purchaseRequisitionApi`, `purchaseOrderApi`, `goodsReceiptApi`, `inventoryApi`, `customerApi`, `notificationApi`, `shiftApi`, `cashDepositApi`, `saleApi`, `discountApi`, `settingsApi` |
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
| Riwayat penjualan | `saleHistoryLogic` | 3 | ✅ |
| Penerimaan barang | `goodsReceiptForm` | 5 | ✅ |
| PR/PO | `purchaseRequisitionForm` | 4 | ✅ |
| Manajemen pengguna | `userForm` | 3 | 🟡 test dijalankan agent; belum dikonfirmasi pengguna |
| Tagihan HRD | `billingForm` | 3 | 🟡 test dijalankan agent; belum dikonfirmasi pengguna |
| Dashboard | `dashboardFilters` | 4 | 🟡 test dijalankan agent; pengguna mengonfirmasi filter di browser |
| Adjustment & Opname | `adjustmentForm` | 4 | 🟡 test dijalankan agent; belum dikonfirmasi pengguna |
| Transfer stok | `transferForm` | 5 | 🟡 test dijalankan agent; belum dikonfirmasi pengguna |
| Diskon dan PPN | `discountForm`, `vatForm` (+ 2 test `toWibDate` di `format`) | 12 · 9 | ✅ |

Pada 28 Okt 2026, setelah tahap Manajemen Pengguna, `npm run typecheck`, `npm test` (**161 lulus, 27 berkas**) dan `npm run build` lulus; backend terakhir **238 test (2.129 assertions)**. Test otomatis frontend mencakup logika murni; komponen React tetap perlu verifikasi manual. Pengguna mengonfirmasi filter Dashboard menampilkan data yang benar dan uji klik Tagihan HRD berjalan lancar, selain alur kas masuk/keluar nonpenjualan, Draft setoran parsial, dan Riwayat Penjualan. Manajemen Pengguna, penerimaan barang, alur Admin PR/PO, Adjustment & Opname, Transfer Stok, dan lampiran penerimaan menunggu uji klik.

## 4. Celah dan catatan yang diketahui

1. **Setoran dan endapan:** Setoran akhir, kebijakan endapan, setoran parsial Kasir, antrean Finance/Admin, penerimaan/koreksi selisih, dan saldo dana tersedia di UI. Pengguna mengonfirmasi pembuatan Draft parsial; uji tindakan lain termasuk antrean Finance masih ditunggu. Tanpa kebijakan endapan aktif, backend mempertahankan seluruh kas terhitung sebagai endapan dan tidak membuat dokumen setoran akhir; atur kebijakan sebelum menguji. **Fitur kas lengkap tetap prasyarat go-live.** Backend daftar/detail setoran kini mengizinkan `cash_deposit.create` atau `cash_deposit.receive`; Finance tidak memerlukan izin pembuatan Kasir untuk membaca antrean.
2. **Pratinjau penjualan (FR-01):** backend `POST /api/sales/preview` terintegrasi di layar `/pos` untuk total resmi, diskon, PPN, stok FEFO, dan sinyal batas kredit. Layar tidak menghitung ulang aturan bisnis saat pratinjau gagal; peringatan ditampilkan bila total final posting berubah dari pratinjau.
3. **Hasil transaksi tidak diketahui:** bila jaringan putus saat posting, keranjang dikunci dan hanya bisa kirim ulang dengan kunci yang sama. Bila tab ditutup sebelum itu, struk mungkin tersimpan tetapi tidak terlihat; riwayat penjualan kini menyediakan pencarian dan detail struk untuk menemukan transaksi tersebut.
4. **Cetak struk dan invoice:** struk thermal kini memiliki pilihan 58/80 mm dengan ukuran halaman CSS terpisah, dan invoice A4 menampilkan status serta riwayat pembayaran/sisa tagihan. Uji printer fisik, pemilihan printer browser, dan printer/scanner perangkat klien masih wajib dilakukan (ROADMAP 6.1, 6.2, 7.4).
5. **Karyawan pada penjualan tunai** tidak dipilih di kasir (hanya kredit); backend mengizinkan `customer_id` untuk tunai.
6. **Dashboard** tersedia untuk Kasir yang memiliki `reports.view`; UI memakai endpoint gabungan, membatasi pilihan ID kasir ke pemegang `shift.review`, dan hanya menampilkan saldo dana bila dikirim backend. Pengguna telah mengonfirmasi filter berjalan benar.
7. **Diskon `amount`** adalah potongan **per unit** (dikalikan qty di server, dibatasi harga baris); label di form dan tabel sudah menyatakannya.
8. **Tanggal diskon** berupa batas hari WIB yang disimpan UTC; form hanya mengirim tanggal bila diubah agar jam mulai tidak bergeser.

## 5. Tahap berikutnya (urut, usulan agent)

1. ✅ **Riwayat penjualan** (bagian 5 dan 7.2): pengguna telah menguji daftar/filter, detail, cetak ulang SALINAN, dan void Admin; uji klik berjalan lancar pada 27 Okt 2026.
2. ✅ **PR/PO** (bagian 6.1–6.2): Kasir membuat/mengajukan PR; Finance dapat meloloskan atau mengembalikan dengan catatan; Owner dapat menyetujui/menolak dengan autentikasi ulang; Purchasing membuat PO per supplier, mengajukan, mengonfirmasi jika butuh Owner, dan menandai PO dikirim. Mendukung role gabungan maupun role terpisah lewat permission. Implementasi dan test lulus; menunggu uji klik pengguna.
3. **Adjustment/opname** (bagian 1, backend 2.7 sudah selesai): draft snapshot, pengajuan, approval/rejection, re-auth untuk loss/expired, posting atomik.
4. 🟡 **Tagihan HRD** (bagian 8): `/billing` mendukung periode buka/ubah/tutup, rincian kredit per karyawan, buat/cetak invoice, terbitkan, serahkan ke HRD, dan pembayaran bertahap. Pengguna mengonfirmasi uji klik berjalan lancar.
5. 🟡 **Manajemen Pengguna** (bagian 10): `/users` mengelola akun toko dan tombol profil menyediakan ganti sandi sendiri; menunggu uji klik.
6. **Transfer stok** (backend 2.6 sudah siap): UI `/inventory/transfers` tersedia; uji klik menunggu, bersama beberapa layar lain yang sudah tersedia.

Verifikasi tindakan setoran parsial/Finance dan layar penerimaan barang tetap belum dikonfirmasi pengguna; ini adalah sisa uji UI yang sudah ada, bukan fitur backend yang belum tersedia.

Jika jadwal mundur, yang tidak boleh dipotong: layar kasir, setoran + endapan, tagihan HRD (HANDOFF bagian 7).

## 6. Permintaan ke backend

Lihat `FRONTEND_REQUESTS.md`. **FR-01** pratinjau penjualan sudah diintegrasikan di `/pos` dan menunggu verifikasi uji klik frontend. Backend bagian 9 (diskon/PPN) dan bagian 10 (manajemen pengguna) sudah lulus test; UI manajemen pengguna tersedia dan menunggu uji klik.

## 7. Cara memperbarui berkas ini

1. Setiap layar atau modul selesai ditulis: tambahkan/ubah barisnya di bagian 1 dengan status 🟡, catat berkas utamanya, dan tambahkan entri di Riwayat.
2. Setelah pengguna menjalankan `npm run typecheck` dan `npm test` hijau (dan, bila perlu, mencoba layarnya): ubah 🟡 → ✅ dan perbarui jumlah test di bagian 3.
3. Kebutuhan yang butuh backend: tulis di `FRONTEND_REQUESTS.md`, tandai ⛔ di sini.
4. Jangan menandai ✅ sebelum pengguna menjalankan test (aturan kerja HANDOFF bagian 8 butir 5, berlaku juga untuk frontend).

## Riwayat

- **2026-10-31** — Layar operator `/platform/stores`: daftar tenant dengan pencarian/filter/paginasi, detail dan akun Admin toko, onboarding tenant beserta Admin awal, serta aktivasi/nonaktivasi dengan konfirmasi. Login sukses sebagai operator langsung diarahkan ke layar ini. Pada kegagalan login, tersedia opsi lupa username/password yang mengarahkan ke recovery melalui CLI server (tidak ada API publik untuk pemulihan). `npm run typecheck`, `npm test` (**161 lulus, 27 berkas**), dan `npm run build` lulus; uji klik menunggu.
- **2026-10-31** — Login CLI operator terhubung ke UI melalui tiket sekali pakai: frontend menghapus ticket fragment dari URL, menukar tiket dengan sesi, lalu membuka daftar tenant. Shell operator dipisahkan dari layout POS dan operator tidak dapat masuk ke rute tenant; token tenant lama dibersihkan ketika handoff CLI dimulai. Password Admin awal tidak disimpan dalam cache mutation frontend dan dibersihkan dari form setelah request. Typecheck, 161 test frontend, dan production build lulus; uji klik command di browser menunggu.

- **2026-10-28** — UI Manajemen Pengguna `/users`: daftar pengguna toko dengan cari/filter role/status dan paginasi; tambah/ubah nama, email, role; aktif/nonaktif dengan konfirmasi; reset sandi; serta tombol global Ganti sandi untuk semua pengguna. Pembatasan self-role/nonaktif dan batas minimal satu Admin tetap divalidasi backend; sandi tidak dikembalikan. Test logika form/payload dan navigasi ditambahkan. `npm run typecheck`, `npm test` (**161 lulus, 27 berkas**), `npm run build`, dan `git diff --check` lulus; uji klik menunggu.
- **2026-10-28** — Pengguna mengonfirmasi uji klik Tagihan HRD berjalan lancar.
- **2026-10-28** — UI Tagihan HRD `/billing`: pengelolaan periode (buka, ubah nama/tanggal gaji, tutup dengan konfirmasi dan pembukaan periode baru), rincian per karyawan, pembuatan invoice untuk periode tertutup, daftar/detail invoice, terbitkan, serah ke HRD, pembayaran sebagian dan riwayatnya, serta cetak invoice A4. Aksi dan permintaan API dipagari permission; nominal pembayaran divalidasi dengan aritmetika sen agar tidak melebihi sisa tagihan. `npm run typecheck`, `npm test` (**157 lulus, 26 berkas**), `npm run build`, dan `git diff --check` lulus; uji klik pengguna menunggu.
- **2026-10-28** — Integrasi frontend `POST /api/sales/preview` pada `/pos`: pratinjau otomatis setelah debounce, total resmi menggantikan perkiraan, loading/error kontrak ditampilkan, dan halaman struk memperingatkan bila total final posting berubah dari pratinjau. Perhitungan perkiraan subtotal klien dihapus agar aturan bisnis tetap tunggal di backend. `FRONTEND_REQUESTS.md` FR-01 ditutup dari sisi frontend; verifikasi uji klik menunggu.
- **2026-10-28** — Pengguna mengonfirmasi UI Dashboard tampil dan filter tanggal menampilkan data yang benar.
- **2026-10-28** — Perbedaan visual sidebar diperjelas: kelompok menu memakai latar abu tipis, sedangkan submenu berlatar putih dengan teks hitam; submenu aktif ditandai teks tebal dan garis tepi agar tetap jelas tanpa latar gelap.
- **2026-10-28** — UI Dashboard `/dashboard` memakai endpoint laporan gabungan, filter periode WIB dan ID kasir hanya untuk pemegang `shift.review`, kartu penjualan/kas, grafik harian, tabel stok menipis dan batch kedaluwarsa, serta saldo dana hanya bila diizinkan backend. Validasi rentang tanggal dan grafik memakai helper bertest. `npm run typecheck`, `npm test` (**153 lulus, 25 berkas**), `npm run build`, dan `git diff --check` lulus; uji klik pengguna menunggu.
- **2026-10-27** — Lampiran privat pada detail `/goods-receipts`: unggah JPEG/PNG/WebP/PDF maksimal 10 MB per berkas, tampilkan metadata, dan unduh melalui endpoint privat dengan Bearer token. Upload ditutup untuk GR batal atau sudah diverifikasi; API menangani multipart tanpa merusak request JSON yang ada. Typecheck, 149 test frontend, dan build lulus; menunggu verifikasi browser.
- **2026-10-27** — UI Transfer Stok `/inventory/transfers`: daftar/filter dokumen, pembuatan Draft dari saldo sellable per batch/posisi, detail, posting atomik, dan pembatalan Draft dengan alasan opsional. Katalog posisi tujuan belum memiliki endpoint backend, jadi ID posisi tujuan berupa input opsional dan transfer antar lokasi tetap dapat digunakan tanpa posisi. Typecheck, test, dan build lulus; menunggu verifikasi klik browser.
- **2026-10-27** — Perapihan navigasi: menu Kasir dan Shift Saya disembunyikan dari navigasi Admin, sidebar dikelompokkan dalam bagian yang dapat dibuka-tutup, dan scroll dibatasi pada workspace kanan agar sidebar tetap di tempat. Typecheck dan test lulus; menunggu verifikasi browser.
- **2026-10-27** — Tahap frontend Adjustment & Opname: `/inventory/adjustments` menyediakan daftar/filter dokumen, Draft dari snapshot saldo sellable per batch/lokasi, validasi kuantitas desimal, detail, pengajuan/pembatalan, serta approve/reject dengan autentikasi ulang untuk loss/expired. Approver dengan permission `inventory.adjust.approve` dapat membaca antrean/detail tanpa `inventory.adjust.request`. `npm run typecheck`, `npm test` (**141 test, 22 berkas**), `npm run build`, dan `php artisan test` (**223 test, 1.953 assertions**) lulus. Uji klik browser menunggu pengguna.
- **2026-10-27** — Tahap Admin PR/PO: Finance dapat meloloskan atau mengembalikan PR dengan catatan; Owner dapat menyetujui/menolak dengan autentikasi ulang; Purchasing dapat membuat PO Draft per supplier, mengajukan untuk persetujuan otomatis/konfirmasi Owner, dan mengirim PO. UI dan menu dibatasi berdasarkan permission agar role Finance, Owner, dan Purchasing terpisah tetap dapat memakai antrean. Akses daftar/detail PR, PO, dan supplier backend diselaraskan dengan permission alur (bukan hanya izin membuat); test akses Finance, Owner, dan Purchasing ditambahkan. `npm run typecheck`, `npm test` (130), `npm run build`, dan `php artisan test` (222; 1.946 assertions) lulus. Menunggu uji klik pengguna.
- **2026-10-27** — Analisis gap setelah backend adjustment 2.7: UI yang mendahului adjustment dan belum tersedia adalah PR/PO. `/goods-receipts` hanya memakai PO receivable, sehingga PR/PO belum tersedia membuat pembelian tidak dapat dimulai end-to-end dari UI. Adjustment dan transfer juga belum punya UI; tagihan HRD dan manajemen pengguna masih backlog. Dipilih PR Kasir sebagai tahap awal alur pembelian sebelum UI pemeriksaan/PO dan sebelum menyamai backend adjustment.
- **2026-10-27** — Tahap PR Kasir (`/purchase-requisitions`): daftar PR sendiri, pencarian/filter, buat/ubah Draft atau returned, detail item dan riwayat keputusan, ajukan ke Finance, serta batalkan PR yang masih memenuhi status. Validasi qty/harga memakai string desimal dan aritmetika integer; backend tetap otoritatif. Test/typecheck/build dijalankan; menunggu uji klik pengguna.
- **2026-10-27** — Perbaikan daftar PR: sebelumnya frontend selalu mengirim `mine=1`, sehingga Admin/Finance hanya melihat PR miliknya walaupun backend memberi visibilitas semua PR untuk `purchase_requisition.finance_check`, `purchase_requisition.approve`, atau `purchase_order.create`. Filter kini membatasi Kasir ke PR sendiri dan menampilkan semua PR kepada pemegang izin pengelolaan; identitas pemohon ditampilkan pada daftar bersama.

- **2026-10-27** — Tahap frontend penerimaan barang: halaman `/goods-receipts` menampilkan PO yang dapat diterima dan riwayat GR; Kasir dapat mencatat qty diterima/rusak, batch, tanggal kedaluwarsa, serta menyimpan Draft; Draft dapat diposting atau dibatalkan; Admin dengan `goods_receipt.verify_documents` dapat memverifikasi nomor surat jalan dan faktur. Form mendukung beberapa batch untuk satu baris PO dan memakai aritmetika qty `bigint` untuk validasi batas sisa. `npm run typecheck`, `npm test` (**126 lulus, 19 berkas**) dan `npm run build` lulus; uji klik pengguna masih menunggu.
- **2026-10-27** — Desain ulang menu Permintaan Pembelian untuk peran pengelola (Finance/Owner/Purchasing): halaman `/purchase-requisitions` kini berupa papan tab mengikuti alur PR Masuk → Persetujuan Owner → Siap Dibuat PO → PO Diproses → PO Keluar, ditambah tab Riwayat. Tiap tab memuat hitungan dan tombol aksi sesuai permission; dokumen yang pindah tahap memunculkan pemberitahuan dengan tombol ke tab tujuan. Dialog detail PR/PO diberi pelacak tahap, dan PR/PO valid (PR disetujui/selesai dipesan; PO disetujui atau sudah dikirim/diterima) dapat dicetak A4. Kasir tetap memakai daftar PR sendiri. Berkas baru: `purchaseFlow.ts` (+test), `PurchaseBoardPage.tsx`, `PurchaseStageTracker.tsx`, `PurchasePrint.tsx`; `purchaseOrderApi.list` ditambahkan. Typecheck penuh dan uji klik belum dijalankan.
- **2026-10-27** — Pengguna mengonfirmasi uji klik Riwayat Penjualan berjalan lancar. Status `/sales` diubah menjadi ✅.

- **2026-10-27** — Pengguna menguji pembuatan Draft setoran parsial Kasir dan menyatakan hasil sesuai ekspektasi. Uji tindakan setoran lainnya dan Finance masih belum dikonfirmasi.
- **2026-10-27** — Tahap frontend setoran parsial dan penerimaan Finance: Kasir dapat membuat, menyerahkan, melihat riwayat, dan membatalkan hanya Draft parsial; penutupan shift tertahan selama Draft masih ada. Halaman `/cash-deposits` menyediakan antrean/status, detail, penerimaan dengan catatan wajib bila selisih, koreksi beralasan, dan saldo dana. `npm run typecheck`, `npm test` (**118 lulus**) dan `npm run build` lulus; UI menunggu uji klik pengguna.
- **2026-10-27** — Tahap frontend riwayat penjualan: daftar/filter per nomor struk, status, jenis pembayaran dan tanggal WIB; detail/struk, cetak ulang SALINAN, serta pembatalan Admin dengan alasan dan guard shift terbuka/kredit belum ditagihkan. Otomatisasi frontend lulus (**121 test**), typecheck/build lulus; menunggu uji klik pengguna.
- **2026-10-27** — Tahap frontend kas masuk/keluar nonpenjualan: endpoint, validasi nominal dan keterangan, konfirmasi pencatatan yang tidak dapat dibatalkan, riwayat berpaginasi pada halaman Shift, pembaruan ringkasan setelah sukses, dan pemeriksaan permission `cash_movement.create`. `npm run typecheck`, `npm test` (**112 lulus**) dan `npm run build` lulus; pengguna mengonfirmasi pengujian klik berjalan lancar.
- **2026-10-27** — Tahap frontend kebijakan endapan Admin (`/settings/float-policy`): konfigurasi endapan laci dengan nominal/persentase, basis, batas minimum/maksimum, pembulatan, dan alasan perubahan. Dokumen setoran akhir hanya dibuat saat kebijakan aktif; tanpa kebijakan, seluruh kas terhitung menjadi endapan. `npm run typecheck`, `npm test` (**109 lulus**) dan `npm run build` lulus.
- **2026-10-26** — Tahap frontend setoran akhir Kasir: layar Shift menampilkan setoran/endapan dan flag tutup shift, konfirmasi penyerahan ke Finance, pencarian setoran Draft final setelah reload, serta mencegah buka shift baru sampai setoran diserahkan. `npm run typecheck`, `npm test` (**104 lulus**) dan `npm run build` lulus. Setoran parsial dan penerimaan Finance belum dikerjakan.
- **2026-10-26** — Pengguna menjalankan `npm run typecheck` (lulus), `npm test` (**102 lulus**) dan backend `php artisan test` (**200 lulus**). Diskon/PPN dikonfirmasi ✅; backend manajemen pengguna dikonfirmasi ✅, UI-nya masuk backlog.
- **2026-10-25 (2)** — F#2: pengaturan harga untuk Admin: **Diskon** (`/discounts`, daftar + filter + form tambah/ubah, target produk atau kategori, jenis persen/nominal per unit, tanggal WIB) dan **Pengaturan PPN** (`/settings/vat`, dengan konfirmasi dan peringatan R-04); `toWibDate`; menu "Diskon" dan "Pengaturan PPN". Status: 🟡 menunggu `npm test` pengguna dan test backend bagian 9.
- **2026-10-25** — F#2: **layar kasir** (`/pos`): pencarian/scan, keranjang, tunai dan kredit potong gaji, pratinjau server (siap pakai, menunggu FR-01), pengecualian kredit Admin, struk cetak, kunci idempotensi dan penguncian saat hasil tidak diketahui; `lib/money.ts`; tipe `Sale`/`Shift` baru; `FRONTEND_REQUESTS.md` dengan FR-01. Status: ✅ diuji manual dan test hijau (pengguna, 25 Okt 2026).
- **sebelumnya (F#1)** — Fondasi (Vite + React 19 + TS + TanStack Query + Tailwind v4), auth/guard, produk, kategori, supplier, stok awal, riwayat stok, karyawan + notifikasi, shift kasir dan tinjau shift. Status: ✅.
