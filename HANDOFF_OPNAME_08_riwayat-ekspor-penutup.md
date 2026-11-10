# HANDOFF #8 — Riwayat Per Periode, Ekspor, dan Penutup Seri Adjustment & Opname

Proyek: POS Retail SMK · Seri: Adjustment & Opname (Handoff #8 dari 8, terakhir) · Dibuat: 10 November 2026 · Status: siap dikerjakan **setelah Handoff #7 selesai dan di-merge**

## 0. Ringkasan untuk agent yang baru bergabung

Handoff #1 sampai #7 membangun seluruh siklus: adjustment manual, sesi opname, penghitungan dengan scanner, penguncian toko, laporan, persetujuan Owner, posting, serta dukungan scanner Bluetooth dan sinyal buruk. **Handoff #8 menutup seri dengan tiga hal:**

1. **Riwayat per periode:** daftar opname dikelompokkan per periode (bulan, kuartal, tahun) dengan rekap ringkas, filter lintas sesi, dan tampilan 'produk yang sering berselisih'.
2. **Ekspor:** unduh laporan per sesi dan rekap per periode (CSV), dan cetak/PDF lewat gaya cetak yang sudah ada.
3. **Penutup:** pengujian menyeluruh (termasuk uji kebocoran hitung buta di seluruh endpoint), pengerasan untuk produksi, dan **konsolidasi dokumentasi** agar agent atau pengembang baru bisa langsung memahami seluruh fitur.

Pengguna **belum memastikan** bahwa toko memiliki aturan jadwal opname, walaupun biasanya dilakukan bulanan. Karena itu:
- Pengelompokan periode **fleksibel** (bulan, kuartal, tahun, atau tanpa grup), bukan jadwal yang dipaksakan.
- **Pengingat opname bersifat opsional dan mati secara default.**

Pemakaian utama tetap di **HP**. Semua UI mobile-first.

## 1. Konteks seri handoff

| # | Isi | Status |
|---|---|---|
| 1 | Kerangka halaman + tab Adjustment | Selesai |
| 2 | Sesi opname: buat, daftar, status, cakupan | Selesai |
| 3 | Kerangka layar opname + peta progres + pengaturan angka stok | Sedang dikerjakan |
| 4 | Input hitungan inti + penguncian transaksi | Berikutnya |
| 5 | Rangkaian hitung berfokus scanner | |
| 6 | Laporan opname + persetujuan Owner + Posting Opname | |
| 7 | Scanner Bluetooth, kalibrasi, dan hitungan tahan sinyal buruk | Prasyarat dokumen ini |
| **8** | **Riwayat per periode, ekspor, dan penutup** | **Dokumen ini** |

## 2. Prasyarat dan urutan kerja

**Jangan mulai sebelum Handoff #3 sampai #7 selesai, lolos test, dan di-merge.** Handoff ini membaca hasil beku dari #6 (laporan, total beku, kolom `diff_qty`, `unit_cost_snapshot`, `diff_value`), memakai komponen `OpnameReport` dan gaya cetak dari #6, dan menguji seluruh endpoint dari #2 sampai #7.

Urutan: **Bagian A (backend) → Bagian B (frontend riwayat dan ekspor)** → **Bagian C (penutup: uji, pengerasan, dokumentasi)**. Bagian C dikerjakan terakhir dan **wajib** diselesaikan; seri belum dianggap selesai tanpa Bagian C.

## 3. Cakupan

**Termasuk:**
- Backend: endpoint rekap periode, filter riwayat, daftar produk sering berselisih, status opname terakhir dan pengingat opsional, ekspor CSV, pengaturan pengingat, test.
- Frontend: tab Opname dengan pengelompokan per periode, rekap dan tren sederhana, filter, 'produk sering berselisih', indikator 'opname terakhir', pengingat opsional, tombol ekspor dan cetak, pengaturan pengingat.
- Penutup: uji kebocoran dan izin menyeluruh, uji performa, pengerasan produksi, panduan operator opname, konsolidasi berkas progres.

**Tidak termasuk (jangan dikerjakan):**
- Jadwal opname yang dipaksakan atau dikunci, atau penjadwalan otomatis pembuatan sesi.
- Pustaka PDF/Excel baru di server (PDF lewat cetak peramban; ekspor berformat CSV).
- Perubahan aturan hitungan, penguncian, hitung buta, persetujuan, atau posting dari #3 sampai #7.
- Penghapusan kolom dan alasan yang tidak terpakai dari Handoff #1 (hanya direkomendasikan, lihat 5.8).
- Notifikasi pengingat berbasis push atau email (hanya spanduk di aplikasi).

## 4. Pemeriksaan awal wajib (sebelum menulis kode)

Dokumen ini ditulis tanpa melihat kode terbaru. **Verifikasi dan catat hasilnya.** Bila sebuah asumsi salah dan memengaruhi desain, **hentikan bagian itu dan laporkan ke pengguna**, jangan improvisasi.

1. Handoff #3 sampai #7 selesai dan test hijau. Catat nama dan bentuk akhir: laporan `OpnameReportBuilder`, kolom beku pada sesi dan item, komponen `OpnameReport`, gaya cetak, izin (`opname.view`, `opname.review`, `opname.post`, `opname.approve`, `opname.view_value`, `opname.count`), kunci pengaturan, daftar sesi.
2. **Zona waktu:** konfigurasi zona waktu aplikasi dan cara basis data menyimpan waktu (UTC atau lokal). **Batas bulan, kuartal, dan tahun harus dihitung dalam zona waktu toko (WIB)**, bukan UTC.
3. Apakah ada pustaka ekspor CSV yang sudah dipakai di proyek (mis. untuk laporan lain). Bila ada, pakai; bila tidak, tulis penghasil CSV kecil dengan aturan di 6.6.
4. Cara proyek menangani tampilan **Excel berbahasa Indonesia** pada laporan yang sudah ada (pemisah kolom koma atau titik koma). Ikuti bila sudah ada pola.
5. Infrastruktur audit log dan cara mencatat tindakan (untuk mencatat ekspor).
6. Seluruh daftar endpoint opname dan izinnya (`routes`), untuk dipakai uji kebocoran dan uji izin di Bagian C.
7. Kolom dan alasan yang dicadangkan di Handoff #1 (`stock_adjustments.source`, `opname_session_id`, alasan `opname_result`): cari **semua** referensi di kode dan data.
8. Baca `docs/ROADMAP_PROGRESS.md` (berkas progres tunggal) dan, bila masih dipakai, `docs/BACKEND_PROGRESS.md`.

## 5. Keputusan yang dipakai di handoff ini

**5.1 Periode fleksibel.** Riwayat dapat dikelompokkan per **bulan** (bawaan), **kuartal**, **tahun**, atau **tanpa grup**. Pilihan tampilan disimpan lokal per pengguna di perangkat. Tidak ada aturan bahwa opname harus dilakukan pada periode tertentu.

**5.2 Tanggal dasar periode.** Sesi `posted` dikelompokkan berdasarkan `posted_at`. Sesi lain (`in_progress`, `pending_approval`, `cancelled`) berdasarkan `started_at`. **Rekap angka (selisih, kurang, lebih) hanya menghitung sesi `posted`**; sesi dibatalkan atau belum diposting tidak ikut dalam angka rekap.

**5.3 Isi rekap per periode.** Per periode: jumlah sesi `posted`, jumlah sesi bersih, jumlah produk berselisih, jumlah kurang dan lebih, tanggal posting terakhir, dan (hanya bagi peran berhak melihat nilai) nilai mutlak total selisih. **Nilai rupiah tidak pernah dikirim kepada peran yang tidak berhak** (dihapus di server).

**5.4 'Produk sering berselisih'.** Daftar sampai 10 produk dengan jumlah sesi `posted` berselisih terbanyak dalam rentang terpilih (bawaan: 6 periode terakhir), disertai total kurang dan lebih. Tujuannya membantu menemukan produk yang rentan hilang atau salah catat. Nilai rupiah hanya bagi peran berhak. Pengelompokan berdasarkan `product_id` dengan nama terbaru dari snapshot item.

**5.5 Opname terakhir dan pengingat opsional.**
- Tab Opname selalu menampilkan **indikator 'Opname terakhir'**: nomor, berapa hari lalu, dan hasilnya ('✓ Bersih' atau 'n selisih'). Bila belum pernah ada: 'Belum pernah opname'. Ini hanya informasi.
- **Pengingat bersifat opsional, mati secara default**, dan hanya berupa **spanduk di tab Opname** saat sudah melewati interval. Tanpa notifikasi push/email dan tanpa memblokir apa pun.
- Pengaturan (di bagian 'Opname' pada setting admin): `opname.reminder.enabled` (default `false`), `opname.reminder.interval_days` (bilangan bulat 1–365, default 30), `opname.reminder.basis` (`all` = hanya opname seluruh toko, atau `any` = sesi `posted` apa pun; default `all`).
- Dapat diubah oleh Owner dan Admin.

**5.6 Ekspor berformat CSV, cetak untuk PDF.** Server menghasilkan CSV (tanpa pustaka baru kecuali yang sudah dipakai proyek). PDF diperoleh lewat fungsi cetak peramban dengan gaya cetak dari #6. Ekspor mengikuti izin yang sama dengan laporan; **kolom nilai rupiah dihapus di server** untuk peran yang tidak berhak.

**5.7 Aman terhadap injeksi rumus CSV.** Sel teks (nama produk, nama kategori, nama sesi, catatan) yang diawali `=`, `+`, `-`, `@`, tab, atau carriage return harus **dinetralkan** (awali dengan tanda kutip tunggal) agar tidak dieksekusi sebagai rumus di Excel/Sheets.

**5.8 Kolom cadangan dari Handoff #1: rekomendasi saja.** `stock_adjustments.source`, `opname_session_id`, dan alasan `opname_result` tidak terpakai oleh desain akhir (lihat Handoff #6). **Jangan menghapusnya.** Verifikasi benar-benar tidak terpakai (kode dan data), lalu tulis **rekomendasi** di berkas progres lengkap dengan bunyi migrasi yang diusulkan, dan **tanyakan keputusan pengguna**. Penghapusan hanya dilakukan di tugas terpisah setelah disetujui.

**5.9 Riwayat tetap baca-saja.** Sesi `posted` dan laporannya tidak dapat diubah atau dihapus; riwayat hanyalah tampilan dan ekspor.

## 6. Bagian A — Backend

### 6.1 Prinsip
- Seluruh endpoint baru bersifat **baca-saja** (tidak mengubah stok maupun sesi), kecuali pengaturan pengingat.
- Rekap dihitung dari **data beku** (`posted` dengan total beku dan kolom item), bukan dari harga atau stok yang berubah belakangan.
- Perubahan pada kode yang sudah ada bersifat **aditif**.
- Hindari N+1; gunakan query berkelompok dan indeks yang memadai (mis. `posted_at`, `status`).

### 6.2 Kontrak API

Ikuti envelope dan format galat yang sudah ada. Bentuk di bawah adalah isi logisnya. Semua endpoint butuh `opname.view`.

**GET `/api/stock-opname-sessions/periods`** — rekap per periode
Query: `group` (`month` default, `quarter`, `year`), `date_from`, `date_to`, `limit` (jumlah periode terbaru, default 12, maks 60), `cursor` (untuk periode lebih lama).
```
{
  periods: [
    { period_key: "2026-11", label: "November 2026",
      sessions_total, sessions_posted, sessions_clean,
      variance_products, short_qty, over_qty,
      abs_value?,                      // hanya peran berhak
      last_posted_at }
  ],
  next_cursor?: string
}
```
- `sessions_total` menghitung semua sesi pada periode itu (menurut 5.2), sedangkan angka lain hanya dari sesi `posted`.
- Periode tanpa sesi tidak ditampilkan.
- Batas periode dihitung dalam **zona waktu toko**.

**Perluasan GET `/api/stock-opname-sessions`** (aditif)
Parameter baru: `period` (mis. `2026-11`, `2026-Q4`, `2026`), `result` (`clean` | `variance`), `scope_type` (`all` | `categories`), `date_from`, `date_to` (menurut tanggal dasar 5.2). Parameter lama tidak berubah.

**GET `/api/stock-opname-sessions/frequent-variance`** — produk sering berselisih
Query: `date_from`, `date_to`, `limit` (default 10, maks 50).
```
{ items: [ { product_id, name, barcode, sessions_with_variance, short_qty, over_qty, value? } ] }
```
`value` hanya bagi peran berhak.

**GET `/api/stock-opname/last-status`** — indikator dan pengingat
```
{
  last_posted: { id, number, posted_at, scope_type, clean, variance_products } | null,
  days_since: number | null,
  reminder: { enabled, interval_days, basis, due }   // due = true bila enabled dan lewat interval
}
```

**Ekspor (CSV)** — izin `opname.view`
- **GET `/api/stock-opname-sessions/{id}/export?part=summary|detail&delimiter=comma|semicolon`**
  - `summary` (ringkasan per kategori): kolom Kategori, Sub-kategori, Produk dihitung, Produk berselisih. **Memuat seluruh kategori dan sub-kategori, termasuk yang '0 selisih'**, selaras dengan laporan.
  - `detail` (detail selisih): kolom Kategori, Sub-kategori, Produk, Barcode, Stok sistem, Hitungan, Selisih, Arah (Kurang/Lebih), Dihitung ulang (Ya/Tidak), dan **Nilai** (hanya bila peran berhak). Hanya produk berselisih.
  - Hanya sesi `posted` dan `pending_approval`. Sesi lain: 409 dengan kode jelas.
- **GET `/api/stock-opname-sessions/periods/export?group=...&date_from=...&date_to=...&delimiter=...`** — rekap periode (kolom sesuai 5.3; nilai hanya bagi peran berhak).
- Aturan berkas di 6.6.

**Pengaturan pengingat:** kunci di 5.5 melalui endpoint konfigurasi yang sudah ada (ubah oleh Owner dan Admin; validasi `interval_days` 1–365; catat di audit log).

### 6.3 Izin akses
Tidak ada izin baru. Ekspor dan riwayat memakai `opname.view`; nilai rupiah memakai `opname.view_value`. Pengaturan pengingat dapat diubah Owner dan Admin.

### 6.4 Perhitungan periode
- Satu fungsi tunggal untuk memetakan waktu ke `period_key` (dengan zona waktu toko) dipakai oleh semua endpoint, agar daftar, rekap, dan ekspor selalu konsisten.
- Kuartal berdasarkan bulan kalender (Q1 Januari–Maret, dan seterusnya). Tahun berdasarkan tahun kalender.
- Label berbahasa Indonesia (mis. 'November 2026', 'Kuartal 4 2026', '2026').

### 6.5 Performa
Pada data uji sekitar 60 sesi `posted` dengan total sekitar 5.000 item per sesi: `periods` dan `frequent-variance` kurang dari sekitar 500 ms; ekspor `detail` untuk satu sesi dengan 300 baris selisih kurang dari sekitar 1 detik. Laporkan angka ukurnya bila tidak tercapai.

### 6.6 Aturan berkas CSV
- Pengodean **UTF-8 dengan BOM** agar Excel membaca karakter dengan benar.
- Pemisah kolom sesuai parameter `delimiter` (bawaan `comma`; `semicolon` untuk Excel berbahasa Indonesia). Kutip nilai yang mengandung pemisah, tanda kutip, atau baris baru.
- Baris pertama berisi judul kolom berbahasa Indonesia.
- **Netralisasi injeksi rumus** sesuai 5.7 pada semua sel teks.
- Nama berkas informatif, mis. `opname-OPN-261106-0001-detail.csv`, `opname-rekap-bulan-2026.csv`.
- Respons dialirkan atau dibangun efisien (tanpa memuat seluruh data ke memori pada sesi besar).
- Pencatatan ke audit log (siapa, kapan, apa yang diekspor) bila infrastrukturnya ada.

### 6.7 Test backend (wajib lolos)

**Periode dan riwayat**
1. `periods` mengelompokkan benar per bulan, kuartal, dan tahun; angka sesuai data beku.
2. **Batas zona waktu:** sesi diposting 31 Oktober 23:30 WIB masuk Oktober (bukan November karena UTC); sesi 1 November 00:10 WIB masuk November.
3. Sesi `cancelled`, `in_progress`, `pending_approval` tidak masuk angka rekap, tetapi masuk `sessions_total` menurut 5.2.
4. `sessions_clean` menghitung sesi `posted` tanpa selisih.
5. Filter `period`, `result`, `scope_type`, rentang tanggal pada daftar sesi bekerja, dan perilaku tanpa parameter baru tidak berubah.
6. `frequent-variance`: urutan benar, hanya sesi `posted`, nama terbaru, batas `limit` dihormati.
7. `last-status`: nilai `null` bila belum ada sesi; `days_since` benar; `due` benar untuk `basis = all` dan `any`, dan bila pengingat mati selalu `false`.

**Ekspor**
8. `summary` memuat seluruh kategori dan sub-kategori cakupan, **termasuk yang 0 selisih**; sesi bersih menghasilkan berkas tidak kosong.
9. `detail` hanya memuat produk berselisih; kolom Nilai **tidak ada** untuk peran tanpa hak (header dan sel), dan ada untuk peran berhak.
10. Aturan berkas: BOM, pemisah koma dan titik koma, kutip yang benar, **netralisasi injeksi rumus** (nama diawali `=`, `+`, `-`, `@` ternetralisasi).
11. Ekspor sesi `in_progress` atau `cancelled`: 409.
12. Rekap periode: kolom dan angka sesuai endpoint `periods`; nilai hanya bagi peran berhak.
13. Ekspor tercatat di audit log (bila ada).

**Pengaturan dan izin**
14. Pengaturan pengingat: default mati, validasi 1–365, peran tak berizin ditolak, perubahan tercatat.
15. Matriks izin: 401, 403 dan berhasil untuk setiap endpoint baru dan peran.
16. **Nilai rupiah tidak ada** di respons `periods`, `frequent-variance`, dan ekspor bagi peran tak berhak.
17. Seluruh test Handoff #1 sampai #7 tetap hijau.
18. Uji performa (6.5) dan laporkan angkanya.

Pengguna menjalankan `php artisan test` di mesinnya. Sertakan perintah yang tepat dan hasil yang diharapkan di laporan serah terima.

## 7. Bagian B — Frontend: riwayat dan ekspor

Stack: React + Vite + TypeScript. **Ikuti library, struktur folder, dan pola yang sudah ada.** Jangan menambah library UI baru tanpa alasan kuat (termasuk pustaka grafik: tren dibuat dengan CSS sederhana).

### 7.1 Tab Opname: struktur halaman
Dari atas ke bawah:
1. **Indikator 'Opname terakhir'** (satu baris): nomor, 'n hari lalu', hasil ('✓ Bersih' atau 'n selisih'), dapat diketuk untuk membuka laporannya. Bila belum pernah: 'Belum pernah opname'.
2. **Spanduk pengingat** (hanya bila `reminder.due`): 'Sudah {n} hari sejak opname terakhir' dengan tombol 'Mulai Opname'. Dapat ditutup untuk sesi tampilan itu. Tidak memblokir apa pun.
3. **Kontrol:** pilihan pengelompokan **Bulan | Kuartal | Tahun | Semua** (disimpan lokal per pengguna), tombol filter, kolom cari nomor/nama, tombol **'Mulai Opname'** (perilaku dari #2, tombol bawah di HP).
4. **Tren sederhana** (maksimal 12 periode terbaru): deretan batang CSS yang menunjukkan jumlah produk berselisih per periode, dengan angka tertulis dan label yang dapat dibaca pembaca layar (bukan sekadar grafik). Mengetuk batang menggulir ke periodenya.
5. **Daftar periode** (akordeon): setiap header periode menampilkan label, jumlah sesi, dan rekap ringkas (jumlah produk berselisih, kurang, lebih; sesi bersih). Bagi peran berhak, tampil nilai mutlak. Isi periode (daftar sesi) dimuat **saat dibuka** lewat daftar sesi dengan `period`.
6. **'Produk sering berselisih'** (kartu yang dapat dilipat): daftar sampai 10 produk, dengan jumlah sesi berselisih dan total kurang/lebih; mengikuti rentang tanggal filter (bawaan 6 periode terakhir).
7. Bila pengelompokan **'Semua'**: daftar sesi biasa berpaginasi (perilaku #2 dan #6).

### 7.2 Filter
Panel filter (panel geser dari bawah di HP): status, hasil (Bersih/Berselisih), cakupan (Seluruh toko/Kategori), rentang tanggal. Chip penanda filter aktif. Filter memengaruhi daftar periode, tren, dan 'produk sering berselisih' secara konsisten.

### 7.3 Baris sesi dalam periode
Sama dengan daftar sesi dari #2 dan #6: nomor, nama, cakupan ringkas, status, hasil ('✓ Bersih' atau 'n selisih'), waktu, pembuat. Mengetuk membuka halaman sesi (laporan untuk `posted` dan `pending_approval`).

### 7.4 Ekspor dan cetak
- Pada halaman laporan sesi `posted`/`pending_approval`: tombol **'Cetak'** (memakai gaya cetak dari #6 untuk menghasilkan PDF lewat peramban) dan menu **'Unduh CSV'** berisi **Ringkasan per kategori** dan **Detail selisih**.
- Pilihan **'Format Excel Indonesia (titik koma)'** (bawaan mengikuti pola proyek; bila belum ada pola, bawaan koma dengan sakelar titik koma). Pilihan diingat lokal.
- Pada tab Opname: tombol **'Unduh rekap periode'** (CSV) sesuai pengelompokan dan rentang yang sedang dipilih. Gaya cetak untuk rekap periode (tanpa elemen navigasi).
- Unduhan memakai tautan yang diautentikasi sesuai pola proyek (bukan token di URL yang dapat bocor). Tampilkan indikator saat berkas disiapkan dan pesan jelas bila gagal.

### 7.5 Pengaturan pengingat
Pada bagian 'Opname' di setting admin: sakelar **'Pengingat opname'** (default mati), kolom **'Ingatkan setiap … hari'** (1–365, default 30), dan pilihan **'Hitung dari'**: 'Opname seluruh toko' (bawaan) atau 'Opname apa pun'. Penjelasan singkat: hanya menampilkan spanduk di tab Opname, tidak memblokir apa pun. Dapat diubah Owner dan Admin.

### 7.6 Responsivitas (mobile-first)
- Titik patah: ikuti konfigurasi yang ada (HP di bawah 768px, tablet 768–1023px, desktop mulai 1024px). Target sentuh minimal 44px. Tanpa scroll horizontal.
- Di HP: header periode ringkas dua baris; tren menggulir mendatar di dalam wadahnya (bukan halaman); filter sebagai panel geser dari bawah.
- Status tidak hanya warna (ikon dan teks), kontras cukup.
- Daftar panjang tetap lincah: periode dimuat saat dibuka, 'Muat periode sebelumnya' di bawah daftar.

### 7.7 Tipe dan data
- Tipe TypeScript untuk kontrak di 6.2 di satu berkas tipe, dan perluas modul API opname.
- Bila Bagian A belum selesai, bangun dengan data tiruan yang mengikuti kontrak persis, termasuk periode tanpa selisih dan periode dengan sesi dibatalkan.
- Kunci nilai rupiah yang tidak ada di respons **tidak boleh** dihitung atau dimunculkan dari sumber lain.

## 8. Bagian C — Penutup (wajib)

### 8.1 Uji kebocoran hitung buta di seluruh endpoint
Buat **satu rangkaian uji backend terparameter** yang memanggil **semua endpoint opname** (dari daftar rute di 4.6) untuk setiap peran (Owner, Admin, Accounting, Kasir) dan keadaan sesi, lalu memeriksa kunci terlarang. Aturan:

| Keadaan | Kunci stok/selisih (`system_qty`, `variance_count`, status `matched`/`variance`, `diff_qty`, `short_*`/`over_*`) |
|---|---|
| `in_progress`, pengaturan angka stok **mati**, belum semua dihitung | **Tidak boleh ada** di endpoint mana pun |
| `in_progress`, pengaturan **mati**, semua sudah dihitung | Hanya `report` (pratinjau) yang boleh memuatnya; endpoint lain tidak |
| `in_progress`, pengaturan **hidup** | Boleh di `tree`, `items`, `counts`, `lookup`, `batch` |
| `offline-index` pada keadaan apa pun | **Tidak boleh ada** |
| `pending_approval`, `posted` | Boleh di `report` dan ekspor bagi peran berhak |

Kunci **nilai rupiah dan ambang** (`value`, `*_value`, `unit_cost*`, `thresholds`, nilai ambang di pengaturan): hanya untuk peran berhak, di semua keadaan, termasuk riwayat dan ekspor. Rangkaian uji ini **wajib hijau** dan ditambahkan ke suite test tetap agar kebocoran di masa depan terdeteksi.

### 8.2 Uji izin menyeluruh
Rangkaian uji terparameter untuk **seluruh endpoint opname dan adjustment** yang memverifikasi 401 (tanpa login), 403 (peran tanpa izin), dan berhasil (peran berizin) sesuai matriks izin. Tambahkan juga: peran tanpa `opname.count` tidak dapat menyimpan hitungan; Admin tidak dapat menyetujui atau mengubah ambang; Kasir tidak dapat mengakses fitur opname kecuali `lock-status`.

### 8.3 Uji penguncian dan integritas lintas fitur
Satu rangkaian uji ujung ke ujung (backend) yang menjalankan siklus penuh: mulai sesi → penguncian aktif (penjualan ditolak) → hitung semua (termasuk dua kali pada satu produk) → tinjau → ajukan → setujui Owner → posting → stok sesuai hitungan → kunci dilepas → riwayat dan ekspor mencerminkan hasil. Ulangi untuk sesi bersih dan sesi tanpa persetujuan. Sertakan skenario sesi dibatalkan dan sesi ditolak lalu diajukan ulang.

### 8.4 Uji performa menyeluruh
Pada data uji **5.000 produk** dan **60 sesi** riwayat, ukur dan laporkan: memulai sesi, `tree`, `items`, simpan hitungan, `batch` 100 operasi, `offline-index`, `report`, posting 300 baris selisih, `periods`, `frequent-variance`, ekspor. Bandingkan dengan target di dokumen #2 sampai #8 dan laporkan yang tidak tercapai beserta usulan.

### 8.5 Pengerasan produksi (daftar periksa)
- Perintah artisan simulasi (`opname:simulate-counts`) menolak berjalan di luar `local`/`testing` (buktikan dengan uji).
- `window.__simulateScan` **tidak ada** di build produksi (periksa hasil build).
- Tidak ada rute atau halaman debug tersisa; tingkat log sesuai produksi; tidak ada data sungguhan atau kredensial di repositori.
- Seluruh migrasi seri ini dapat dijalankan dari awal pada basis data kosong **dan** pada salinan basis data yang sudah berisi data (dengan data sesi uji dibersihkan). Laporkan hasilnya.
- Seluruh pesan galat opname tidak memuat angka stok (periksa pengambilan sampel).

### 8.6 Skenario penerimaan akhir (uji manual di staging)
Satu skenario utuh dengan sedikitnya 300 produk dan dua perangkat (satu HP dengan scanner Bluetooth): opname seluruh toko dengan sinyal diputus sebentar, selisih kecil dan satu selisih yang melewati ambang, tolak lalu hitung ulang lalu setujui, posting, cek stok, cek penjualan normal kembali, cek laporan, riwayat per bulan, ekspor CSV dibuka di Excel, dan cetak. Catat hasil dan temuan di berkas progres.

### 8.7 Dokumentasi dan konsolidasi (wajib)
- **Konsolidasi `docs/ROADMAP_PROGRESS.md`** (berkas progres tunggal): selain bagian per-handoff yang sudah ada, tambahkan satu bagian **'Adjustment & Opname — Ikhtisar'** di bagian atas yang merangkum: apa saja fitur dan layar, alur lengkap, daftar endpoint, daftar izin dan peran, kunci pengaturan, aturan penguncian, aturan persetujuan, kebijakan hitung buta dan visibilitas nilai, batasan yang diketahui, perintah pengembangan (simulasi), dan rekomendasi utang teknis (termasuk 5.8). Tujuannya: agent atau pengembang baru bisa memahami seluruh fitur hanya dengan membaca bagian ini. Jangan membuat berkas progres baru dan jangan menghapus catatan per-handoff.
- Tulis **`docs/PANDUAN_OPNAME.md`**: panduan operator singkat berbahasa Indonesia untuk **admin dan Owner**: persiapan (toko ditutup, scanner, sinyal), memulai opname, menghitung (scan, jumlah, tidak ketemu = 0), meninjau selisih dan menghitung ulang, posting dan persetujuan Owner, membaca laporan, riwayat dan ekspor, serta yang harus dilakukan bila sinyal putus atau sesi macet. Berkas ini **bukan** berkas progres. Tautkan ke `docs/PANDUAN_SCANNER_BLUETOOTH.md` dari Handoff #7.
- Bila `docs/BACKEND_PROGRESS.md` masih dipakai, cukup tambahkan satu baris rujukan.

## 9. Kriteria selesai (dicek di browser dan lewat test)

**Riwayat dan ekspor**
1. Buka tab Opname: indikator 'Opname terakhir' benar; pada sistem tanpa sesi `posted` tampil 'Belum pernah opname'.
2. Pengelompokan **Bulan/Kuartal/Tahun/Semua** bekerja dan pilihan diingat setelah muat ulang. Header periode menampilkan rekap yang cocok dengan jumlah sesi dan selisih sebenarnya.
3. **Batas bulan** benar: sesi diposting 31 Oktober malam (WIB) berada di Oktober.
4. Sesi dibatalkan muncul dalam daftar periode tetapi tidak mengubah angka rekap.
5. Tren batang tampil dengan angka tertulis, dapat diketuk untuk menggulir ke periode; terbaca pembaca layar.
6. 'Produk sering berselisih' menampilkan urutan yang benar dan mengikuti filter rentang.
7. Filter (status, hasil, cakupan, tanggal) bekerja konsisten pada daftar, tren, dan 'produk sering berselisih'.
8. **Pengingat:** mati secara default; setelah dinyalakan dengan interval kecil, spanduk muncul pada sistem yang sudah lewat interval, dan tidak memblokir apa pun. Pilihan 'Hitung dari' mengubah hasil sesuai data.
9. **Laporan sesi** `posted`: tombol Cetak menghasilkan keluaran rapi; **CSV ringkasan** memuat **semua kategori dan sub-kategori termasuk '0 selisih'** dan **CSV detail** hanya memuat produk berselisih. Sesi bersih menghasilkan CSV ringkasan yang tidak kosong dan CSV detail tanpa baris produk.
10. Buka CSV di Excel: karakter benar (BOM), kolom terpisah benar pada mode koma dan titik koma, dan nama produk berawalan `=`/`+`/`-`/`@` tidak dieksekusi sebagai rumus.
11. Peran **tanpa hak nilai** (mis. Admin): tidak ada nilai rupiah di riwayat, tren, 'produk sering berselisih', laporan, maupun CSV (periksa juga tab Network).
12. Rekap periode dapat diunduh dan angkanya sama dengan tampilan.
13. Di HP (375px): seluruh halaman terbaca tanpa terpotong, tren menggulir di dalam wadahnya, filter sebagai panel bawah; uji juga 768px dan 1280px.

**Penutup**
14. Rangkaian uji kebocoran (8.1), uji izin (8.2), dan uji siklus penuh (8.3) **hijau** dan sudah masuk suite test tetap.
15. Laporan uji performa (8.4) tersedia di berkas progres.
16. Daftar periksa pengerasan (8.5) terpenuhi, termasuk bukti bahwa `__simulateScan` tidak ada di build produksi dan perintah simulasi menolak berjalan di luar lokal/test.
17. Skenario penerimaan akhir (8.6) dijalankan dan hasilnya dicatat.
18. `docs/ROADMAP_PROGRESS.md` memiliki bagian 'Ikhtisar' yang lengkap dan `docs/PANDUAN_OPNAME.md` tersedia.
19. Seluruh fitur Handoff #1 sampai #7 tetap berfungsi normal.
20. `php artisan test` hijau, serta pemeriksaan tipe, lint, uji otomatis frontend (bila ada), dan build bersih.

Setelah pengujian, **batalkan atau selesaikan semua sesi uji** dan bersihkan data uji dari lingkungan.

## 10. Antarmuka akhir seri

Seri ini selesai setelah handoff ini. Hal yang perlu dijaga kelak (tidak diubah tanpa alasan dan catatan): laporan beku sesi `posted`, kunci pengaturan opname, kebijakan tampilan opname (satu sumber kebenaran hitung buta), `OpnameLockService`, aturan persetujuan, dan rangkaian uji kebocoran serta izin di 8.1 dan 8.2.

**Pengembangan lanjutan yang sudah teridentifikasi (di luar seri ini):** scan kamera sebagai cadangan scanner, service worker/PWA untuk memuat ulang saat offline, opsi Owner memposting dengan produk belum dihitung, penghapusan kolom cadangan di `stock_adjustments` (5.8), ekspor Excel/PDF dari server.

## 11. Dokumentasi dan serah terima

- Perbarui `docs/ROADMAP_PROGRESS.md` sesuai 8.7 (ikhtisar + bagian 'Handoff #8': apa yang baru selesai, endpoint dan bentuknya, kunci pengaturan, izin, hasil pemeriksaan awal di bagian 4 beserta asumsi yang berbeda, hasil uji performa dan penerimaan, dan fitur UI yang kini tersedia).
- Gunakan commit kecil dan terarah, misalnya: (1) fungsi periode + `periods` + test, (2) perluasan daftar sesi + `frequent-variance` + test, (3) `last-status` + pengaturan pengingat, (4) ekspor CSV + aturan berkas + test, (5) uji kebocoran, izin, dan siklus penuh, (6) tab Opname per periode + tren, (7) filter + 'produk sering berselisih', (8) indikator, pengingat, dan ekspor di UI, (9) pengaturan pengingat, (10) pengerasan produksi, (11) dokumentasi dan panduan.
- Di akhir pekerjaan, tulis **ringkasan serah terima maksimal 10 baris** yang bisa diteruskan ke agent lain: apa yang selesai, apa yang belum, temuan atau asumsi yang berbeda, perintah untuk menjalankan test, rekomendasi utang teknis, dan pengembangan lanjutan yang disarankan.

## 12. Larangan

- Jangan memaksakan jadwal opname, membuat sesi otomatis, atau memblokir pekerjaan karena pengingat.
- Jangan mengubah stok, sesi, atau laporan beku lewat fitur riwayat dan ekspor; semuanya baca-saja.
- Jangan mengirim nilai rupiah, ambang, atau harga pokok kepada peran yang tidak berhak (hapus di server, termasuk di ekspor).
- Jangan menghasilkan CSV tanpa netralisasi injeksi rumus.
- Jangan menghitung batas periode dengan zona waktu UTC.
- Jangan menyertakan sesi dibatalkan atau belum diposting dalam angka rekap.
- Jangan menambah pustaka baru (PDF, Excel, grafik) tanpa alasan yang dicatat.
- Jangan menghapus kolom atau alasan cadangan dari Handoff #1 tanpa keputusan pengguna.
- Jangan mengubah aturan hitungan, penguncian, hitung buta, persetujuan, atau posting dari #3 sampai #7.
- Jangan menyertakan alat pengembangan (`__simulateScan`, perintah simulasi aktif di produksi) di lingkungan produksi.
- Jangan melakukan refactor di luar cakupan dokumen ini.
- Jangan menyimpan data sungguhan, kredensial, atau berkas `.env` ke repositori.
