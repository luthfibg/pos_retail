# HANDOFF #5 — Rangkaian Hitung Berfokus Scanner (2 Sudah Dihitung · 1 Sedang Dihitung · 2 Rekomendasi)

Proyek: POS Retail SMK · Seri: Adjustment & Opname (Handoff #5 dari 8) · Dibuat: 8 November 2026 · Status: siap dikerjakan **setelah Handoff #4 selesai dan di-merge**

## 0. Ringkasan untuk agent yang baru bergabung

Handoff #4 membuat opname bisa dihitung: form input, simpan hitungan, riwayat terbaru, penguncian transaksi. **Handoff #5 menyusun ulang panel Input menjadi satu rangkaian vertikal yang berfokus pada mesin scanner**, supaya petugas bisa menghitung sambil melihat rak, bukan layar:

```
┌──────────────────────────────┐
│  Kartu: sudah dihitung (2)   │  ← kedua terakhir dihitung
│  Kartu: sudah dihitung (1)   │  ← paling baru, tepat di atas form
├──────────────────────────────┤
│  FORM: sedang dihitung       │  ← satu-satunya yang berupa input
├──────────────────────────────┤
│  Kartu: rekomendasi (1)      │  ← berikutnya yang belum dihitung
│  Kartu: rekomendasi (2)      │
└──────────────────────────────┘
```

Keputusan desain dari pengguna: **hanya form di tengah yang menerima input.** Dua kartu di atas dan dua kartu di bawah **bukan form**; hanya tampilan (boleh diketuk untuk memuat produknya ke form). Alur utamanya adalah: **scan → ketik/ketuk jumlah → simpan → produk naik ke deretan 'sudah dihitung' → rekomendasi bergeser**. Ini menggantikan konsep '4 form rekomendasi' pada rencana awal seri.

Pemakaian utama kelak di **HP** (admin keliling rak). Semua UI mobile-first.

## 1. Konteks seri handoff

| # | Isi | Status |
|---|---|---|
| 1 | Kerangka halaman + tab Adjustment | Selesai |
| 2 | Sesi opname: buat, daftar, status, cakupan | Selesai |
| 3 | Kerangka layar opname + peta progres + pengaturan angka stok | Sedang dikerjakan |
| 4 | Input hitungan inti + penguncian transaksi | Berikutnya (prasyarat dokumen ini) |
| **5** | **Rangkaian hitung berfokus scanner** | **Dokumen ini** |
| 6 | Ringkasan selisih + Posting Opname + persetujuan Owner + adjustment otomatis | |
| 7 | Penyempurnaan HP: scan kamera, draft lokal + sinkron | |
| 8 | Riwayat per periode + penutup | |

## 2. Prasyarat dan urutan kerja

**Jangan mulai sebelum Handoff #4 selesai, lolos test, dan di-merge.** Handoff ini mengubah tampilan komponen hasil #4 (`CountEntryForm`, panel Input, `useCountMutation`) dan memakai endpoint `items`, `lookup`, `counts` dari #3 dan #4.

Urutan: **Bagian A (backend, kecil) → Bagian B (frontend)**. Karena perubahan backend hanya aditif dan kecil, Bagian B boleh dimulai paralel setelah kontrak di 6.2 final.

## 3. Cakupan

**Termasuk:**
- Backend (kecil, aditif): perluasan endpoint `items` untuk daftar 'terakhir dihitung'.
- Frontend: komponen rangkaian (kartu atas, form tengah, kartu bawah), penangkap scanner global, keypad jumlah di layar, aturan produk 'sedang dihitung', aturan rekomendasi, kartu 'sub-kategori selesai' dan tombol lanjut, tombol 'Mulai' di Daftar, umpan balik scan (getar dan nada), mode padat untuk layar pendek.

**Tidak termasuk (jangan dikerjakan):**
- Scan lewat kamera HP, antrean offline, draft lokal (Handoff #7).
- Ringkasan selisih, Posting Opname, persetujuan Owner, pengaturan ambang rupiah (Handoff #6).
- Mengubah aturan penyimpanan hitungan, idempotensi, penguncian transaksi, atau kebijakan hitung buta dari #3 dan #4.
- Endpoint baru selain perluasan `items` di 6.2.

## 4. Pemeriksaan awal wajib (sebelum menulis kode)

Dokumen ini ditulis tanpa melihat kode terbaru. **Verifikasi dan catat hasilnya.** Bila sebuah asumsi salah dan memengaruhi desain, **hentikan bagian itu dan laporkan ke pengguna**, jangan improvisasi.

1. Handoff #3 dan #4 selesai dan test hijau. Catat nama dan bentuk akhir: respons `tree`, `items`, `lookup`, `counts`; `OpnameWorkspaceContext` (`activeNodeId`, `selectItem` bila ada); `CountEntryForm`; `useCountMutation`; `ProductPicker` beserta adaptornya; panel Input dan daftar 'Terakhir diinput'.
2. Bagaimana `CountEntryForm` saat ini menangani: pemilihan produk, aturan tombol 'Ganti jadi X' / 'Tambah X', `client_request_id`, galat jaringan, dan galat penguncian. Seluruh perilaku ini **harus tetap**; hanya tampilannya yang disusun ulang.
3. Apakah proyek punya infrastruktur **test frontend** (unit atau komponen). Bila ada, hook penangkap scanner (7.2) wajib diuji dengan penekanan tombol simulasi.
4. Cara aplikasi mendeteksi layar sentuh (pointer kasar) dan tinggi viewport dinamis di HP.
5. Apakah tersedia API getar (`navigator.vibrate`) dan Web Audio pada target perangkat; fitur ini opsional dan harus gagal dengan tenang bila tidak ada.
6. Baca `docs/ROADMAP_PROGRESS.md` (berkas progres tunggal) dan, bila masih dipakai, `docs/BACKEND_PROGRESS.md`.

## 5. Keputusan yang dipakai di handoff ini

**5.1 Bentuk rangkaian.** Urutan dari atas ke bawah: 2 kartu 'sudah dihitung', 1 form 'sedang dihitung', 2 kartu 'rekomendasi'. **Hanya form tengah yang menerima input.** Kartu lain tidak berisi kolom isian apa pun.

**5.2 Aturan kartu 'sudah dihitung' (atas).** Dua produk yang **terakhir dihitung** dalam sesi ini (diurutkan dari waktu hitung terbaru), **tidak peduli sub-kategori**. Yang paling baru berada **tepat di atas form**. Produk yang hitungannya dihapus (`clear`) tidak tampil. Isi kartu: nama produk, jumlah hitungan ('Hitungan: N'), dan bila pengaturan angka stok hidup, lencana cocok/selisih. Mengetuk kartu memuat produk itu ke form untuk dikoreksi (dengan aksi 'Ganti', 'Tambah', 'Hapus hitungan' dari #4).

**5.3 Aturan kartu 'rekomendasi' (bawah).** Dua produk **belum dihitung** berikutnya pada **node kerja** (lihat 5.4), urut abjad seperti di Daftar, **tidak termasuk produk yang sedang ada di form**. Isi kartu: nama, barcode kecil, dan bila pengaturan angka stok hidup, stok sistem. Mengetuk kartu memuat produknya ke form (cadangan bila barcode rusak atau produk tidak ketemu di rak; di form tersedia tombol '0 — tidak ada').

**5.4 Node kerja.** Node kerja ditentukan dari `activeNodeId` (kontekstual dari #3 dan #4):
- Setelah petugas **men-scan atau memilih** sebuah produk, node aktif otomatis menjadi kategori produk itu (sudah dilakukan #4). Rekomendasi mengikuti produk yang sedang di-scan.
- Petugas juga bisa mengetuk **'Mulai'** pada sebuah node di Daftar (7.8) untuk menetapkan node aktif sebelum men-scan apa pun.
- **Resolusi:** bila node aktif punya produk langsung yang belum dihitung, itu node kerjanya. Bila tidak (mis. node induk yang hanya berisi anak), node kerja adalah **node turunan pertama** (urutan pohon, depth-first) yang punya produk langsung belum dihitung. Resolusi dihitung di klien dari cache pohon (`direct_product_count`, `direct_counted_count`).
- Bila belum ada node aktif sama sekali: kartu rekomendasi menampilkan petunjuk 'Scan produk atau ketuk Mulai pada sub-kategori di Daftar'.

**5.5 Sub-kategori selesai.** Bila node kerja tidak punya produk belum dihitung lagi, area rekomendasi diganti **kartu selesai**: '✓ {nama node} selesai ({counted}/{total})' dan, bila stok boleh terlihat, jumlah selisih. Di bawahnya tombol **'Lanjut ke {node berikutnya}'**, dengan node berikutnya = node berikutnya menurut urutan pohon yang masih punya produk belum dihitung (saudara dulu, lalu naik ke induk). Tidak ada lompat otomatis; petugas yang mengetuk. Bila **seluruh sesi** sudah selesai: kartu 'Semua produk sudah dihitung' dengan tautan ke tampilan Ringkasan.

**5.6 Berfokus scanner.**
- Layar menangkap input scanner **di tingkat dokumen**, sehingga scan tetap diterima walau fokus tidak ada di kolom mana pun (7.2).
- Keadaan form 'idle' menampilkan ajakan besar **'Scan barcode produk'**, bukan kolom pencarian. Pencarian nama (`ProductPicker` dengan adaptor sesi dari #4) tetap tersedia sebagai cadangan lewat tombol kecil **'Cari manual'** (untuk barcode rusak, atau saat memakai HP tanpa scanner sebelum scan kamera Handoff #7 ada).
- Jumlah dimasukkan lewat **keypad di layar** dan/atau keyboard fisik (7.3), **bukan** keyboard bawaan sistem operasi yang menutup rangkaian di HP.

**5.7 Aturan saat scan masuk ketika form sedang berisi.**
- Form kosong (idle): produk hasil scan dimuat.
- Form berisi produk **tetapi jumlah belum diketik**: produk hasil scan **menggantikan** isi form.
- Form berisi produk **dan jumlah sudah diketik** (belum disimpan): scan **ditolak sementara** dengan peringatan singkat 'Simpan atau batalkan {nama produk} dulu' (dan tombol Batal). **Isian tidak boleh hilang.**
- **Scan kembar:** scan dengan kode yang sama dalam waktu ±800 ms setelah scan sebelumnya diabaikan (menghindari pengulangan otomatis scanner). Setelah jeda itu, scan produk yang sama diperlakukan normal (mis. memicu 'Ganti'/'Tambah' bila sudah dihitung).

**5.8 Produk yang sudah dihitung.** Perilaku dari #4 tetap: form menampilkan 'Sudah dihitung: N' dan dua tombol eksplisit **'Ganti jadi X'** dan **'Tambah X (jadi N+X)'**. Tidak ada default tersembunyi, dan **Enter saja tidak menyimpan** untuk produk yang sudah dihitung.

**5.9 Hitung buta tetap dari #3 dan #4.** Saat pengaturan angka stok mati, **tidak ada petunjuk stok atau selisih di kartu mana pun** (atas, tengah, bawah), dan tidak ada peringatan yang bergantung pada stok. Saat hidup, kartu atas menampilkan cocok/selisih, form menampilkan stok sistem dan pratinjau selisih, kartu rekomendasi menampilkan stok sistem.

**5.10 Umpan balik scan.** Setiap scan memberi umpan balik tanpa harus melihat layar: sukses = getar singkat + nada pendek; galat (`not_in_session`, `unknown_barcode`, ditolak karena form berisi) = getar ganda + nada berbeda. Ada pengaturan **'Suara dan getar'** (hidup/mati) sebagai **preferensi lokal perangkat**, default hidup. Bila API tidak tersedia, gagal dengan tenang. Nada tidak boleh bergantung pada stok sistem.

**5.11 Syarat operasional scanner (catat di berkas progres, bukan di kode).** Scanner harus dikonfigurasi mengirim **Enter** di akhir kode (default sebagian besar scanner USB/Bluetooth). Aplikasi mengandalkan akhiran Enter (atau Tab).

## 6. Bagian A — Backend (kecil, aditif)

### 6.1 Prinsip
- Perubahan hanya **menambah** parameter dan field pada endpoint `items` dari Handoff #3. Perilaku lama tidak berubah.
- Semua respons tetap melewati kebijakan tampilan opname: **tanpa** `system_qty`, `variance_count`, atau status `matched`/`variance` saat pengaturan mati.

### 6.2 Perluasan `GET /api/stock-opname-sessions/{id}/items`
Tambahan query:
- `only_counted` (boolean): hanya item yang sudah dihitung.
- `sort`: tambahkan nilai `-counted_at` (waktu hitung terbaru dulu). Nilai bawaan lama tidak berubah.
- `exclude_item_ids` (daftar, maksimal 10): item yang dikecualikan dari hasil (dipakai rekomendasi untuk mengecualikan produk yang sedang ada di form).

Tambahan field pada setiap item: `counted_at` (null bila belum dihitung).

Contoh pemakaian frontend:
- Kartu 'sudah dihitung': `items?only_counted=true&sort=-counted_at&per_page=2`.
- Kartu rekomendasi: `items?category_id={nodeKerja}&scope=direct&only_uncounted=true&per_page=2&exclude_item_ids[]={itemDiForm}`.

Tambahkan indeks yang diperlukan (mis. (`session_id`, `counted_at`)) bila belum ada.

### 6.3 Test backend (wajib lolos)
1. `only_counted` + `sort=-counted_at` mengembalikan item dihitung urut dari yang terbaru; item yang di-`clear` tidak ikut.
2. `exclude_item_ids` mengecualikan item yang disebut dan tetap menghormati `only_uncounted`, `scope`, dan `per_page`.
3. `counted_at` terisi pada item dihitung dan null pada yang belum.
4. **Hitung buta:** dengan pengaturan mati, respons dengan parameter baru tidak memuat `system_qty`, `variance_count`, atau status `matched`/`variance` (kunci tidak ada). Dengan pengaturan hidup, kunci muncul.
5. Perilaku `items` tanpa parameter baru **tidak berubah** (seluruh test #3 tetap hijau).
6. Performa: dua panggilan di atas kurang dari sekitar 150 ms pada data uji 5.000 item. Laporkan angkanya bila tidak tercapai.

Pengguna menjalankan `php artisan test` di mesinnya. Sertakan perintah yang tepat dan hasil yang diharapkan di laporan serah terima.

## 7. Bagian B — Frontend

Stack: React + Vite + TypeScript. **Ikuti library, struktur folder, dan pola yang sudah ada.** Jangan menambah library UI baru tanpa alasan kuat.

### 7.1 Komponen dan hook (usulan nama)
- `CountingStack` — wadah rangkaian di panel Input; menggantikan susunan panel Input dari #4.
- `CountedCard` — kartu 'sudah dihitung' (tampilan saja, dapat diketuk).
- `ActiveCountCard` — form tengah; membungkus perilaku `CountEntryForm` dari #4 dengan tampilan baru (ajakan scan, keypad). **Seluruh perilaku #4 tetap.**
- `RecommendationCard` — kartu rekomendasi (tampilan saja, dapat diketuk).
- `NodeCompleteCard` — kartu 'sub-kategori selesai' dan tombol lanjut.
- `ScanPrompt` — keadaan idle form.
- `QuantityKeypad` — keypad di layar.
- Hook: `useScannerCapture`, `useCountedStrip`, `useRecommendations(nodeKerja, itemDiForm)`, `useWorkingNode`, `useNextNode`, `useScanFeedback`.
- Perluas `OpnameWorkspaceContext` dengan: `startNode(nodeId)` dan `workingNodeId` (hasil resolusi 5.4). Catat bentuk akhirnya di berkas progres.
- Daftar 10 'Terakhir diinput' dari #4 **tidak dibuang**: pindahkan menjadi tautan **'Riwayat'** yang membuka lembar berisi daftar itu (tetap bisa diketuk untuk koreksi).

### 7.2 `useScannerCapture` (penangkap scanner)
Scanner keyboard mengetik karakter sangat cepat lalu mengirim Enter. Hook ini memisahkan scan dari ketikan manusia **tanpa membutuhkan fokus pada kolom tertentu**.
- Pasang `keydown` di tingkat dokumen selama layar opname aktif; lepas saat tidak aktif.
- Karakter yang datang dengan jeda antar-tombol **≤ 40 ms** dianggap bagian satu semburan. Kode dianggap **scan** bila semburan berisi **minimal 6 karakter** dan diakhiri **Enter atau Tab** dalam jeda yang sama. Nilai ambang (40 ms, 6 karakter) dibuat sebagai konstanta yang mudah diubah.
- Karakter ketikan manusia (jeda lebih lama) **tidak boleh** diperlakukan sebagai scan. Digit jumlah yang diketik manusia ditunda maksimal ±50 ms sebelum diterapkan supaya digit awal sebuah scan tidak sempat masuk ke jumlah. Bila semburan terdeteksi sebagai scan, tidak ada digit dari scan yang boleh tersisa di jumlah.
- Enter manusia (tanpa semburan di depannya) berarti 'simpan' dan hanya diteruskan ke form.
- Abaikan tombol pengubah (Ctrl, Alt, Meta) dan tombol non-karakter. Cegah perilaku bawaan (mis. menulis ke kolom) untuk karakter yang terbukti bagian scan.
- Keluaran: `onScan(code, { source: 'keyboard' })`. Parameter `source` disiapkan agar Handoff #7 menambahkan `'camera'` lewat penangan yang sama tanpa mengubah rangkaian.
- Aturan scan kembar 800 ms (5.7) diterapkan di sini.
- **Uji** (bila ada infrastruktur test frontend; bila tidak, catat uji manual): scan 13 digit + Enter diterima; ketikan manusia '12' + Enter bukan scan; scan datang saat jumlah sedang diketik tidak menyisakan digit; scan kembar dalam 800 ms diabaikan.

### 7.3 Form tengah (`ActiveCountCard`)
**Keadaan idle:** ajakan besar 'Scan barcode produk', petunjuk node kerja ('Sedang di: Mi Instan'), tombol kecil 'Cari manual' (membuka `ProductPicker` dengan adaptor sesi dari #4, yang menutup kembali setelah memilih), dan tombol Batal tidak tampil.

**Keadaan terisi (produk dimuat):** nama, barcode, `category_path`, status, dan 'Sudah dihitung: N' bila relevan; bila pengaturan angka stok hidup, stok sistem dan pratinjau selisih; bila mati, **tanpa petunjuk stok atau selisih**.

**Jumlah dan keypad:**
- Tampilan jumlah berupa **kolom baca-saja** besar (bukan kolom teks yang memicu keyboard OS). Kosong secara default (bukan 0).
- **Keypad di layar:** tombol 0–9, hapus satu digit (⌫), dan tombol aksi simpan. Tampil secara default di perangkat sentuh (pointer kasar) dan bisa dibuka lewat tombol di perangkat dengan keyboard fisik.
- **Keyboard fisik:** digit 0–9 dan Backspace diterima langsung (lihat 7.2 untuk pemisahan dari scan). Enter menyimpan hanya untuk produk **belum dihitung**.
- Tombol −/+ (±1) dan tombol **'0 — tidak ada'** dari #4 tetap tersedia.
- Digit saja, maksimal 7 digit. Batas atas dan validasi tetap sesuai #4.
- Tombol simpan sesuai #4: produk belum dihitung → **Simpan**; sudah dihitung → **'Ganti jadi X'** dan **'Tambah X (jadi N+X)'**. Tombol batal mengosongkan form ke idle.

**Setelah simpan sukses:** form kembali ke **idle**, produk yang baru disimpan **naik ke kartu 'sudah dihitung' paling dekat dengan form** (kartu terlama keluar dari atas), dan rekomendasi diperbarui. Fokus tangkapan scanner tetap aktif sehingga scan berikutnya langsung diterima.

**Galat dan kasus khusus (perilaku #4 tetap):** gagal jaringan menampilkan pesan dengan opsi coba lagi **tanpa mengosongkan isian** dan memakai `client_request_id` yang sama; 422/409 tampil jelas; `not_in_session` dan `unknown_barcode` tampil sesuai #4 tanpa mengosongkan form; galat penguncian tetap dipetakan oleh penanganan pusat dari #4.

### 7.4 Kartu 'sudah dihitung' (atas)
- Sumber data: `items?only_counted=true&sort=-counted_at&per_page=2`. Perbarui **secara optimis** dari respons simpan (`item` yang baru) agar kartu bergeser seketika, lalu rekonsiliasi dengan polling dari #3.
- Bila belum ada yang dihitung, tampilkan satu kartu kosong ringan ('Belum ada produk yang dihitung'), bukan dua kotak kosong.
- Aksi ketuk: muat ke form (5.2).

### 7.5 Kartu rekomendasi (bawah) dan sub-kategori selesai
- Sumber data: `useRecommendations(nodeKerja, itemDiForm)` memakai `items` dengan parameter di 6.2. Perbarui dari respons simpan (hapus produk yang baru dihitung dari daftar) dan polling.
- Bila produk di form ikut menjadi kandidat, dikecualikan lewat `exclude_item_ids`.
- Bila node kerja habis: tampilkan `NodeCompleteCard` (5.5). Tombol lanjut menetapkan node aktif ke node berikutnya.
- Bila belum ada node kerja: petunjuk di 5.4.

### 7.6 Tata letak dan responsivitas (mobile-first)
- **HP:** rangkaian tersusun vertikal pada tampilan **Input**. Karena keyboard OS tidak dipakai, seluruh rangkaian terlihat sekaligus. Ukuran: kartu atas dan bawah **padat** (satu hingga dua baris, sekitar 56px), form tengah lebih besar dengan keypad besar (target sentuh minimal 44px, ideal 56px) dan tombol simpan yang mudah dijangkau ibu jari.
- **Mode padat untuk layar pendek:** bila tinggi tersedia kurang dari ±560px, kartu atas dan bawah menjadi satu baris dan rekomendasi kedua boleh bergulir keluar; **form tengah dan tombol simpan tidak boleh keluar dari layar**.
- **Tablet dan desktop:** rangkaian yang sama di panel kanan dengan kartu lebih lapang; panel Daftar di kiri tetap seperti #3.
- Animasi geser singkat (±200 ms) saat produk 'naik' dari form ke kartu atas dan rekomendasi bergeser; **hormati `prefers-reduced-motion`** (tanpa animasi bila diminta).
- Aksesibilitas: urutan fokus logis, tombol keypad berlabel, hasil simpan diumumkan lewat `aria-live`, status tidak hanya bergantung pada warna.

### 7.7 Umpan balik scan
- `useScanFeedback`: getar dan nada singkat untuk sukses, getar ganda dan nada berbeda untuk galat. Nada dibuat sederhana (Web Audio), dibuka setelah interaksi pertama pengguna agar lolos kebijakan putar otomatis browser.
- Pengaturan **'Suara dan getar'** (hidup/mati) tersimpan sebagai preferensi lokal perangkat dan mudah dijangkau di layar opname. Gagal dengan tenang bila API tidak ada.

### 7.8 Tombol 'Mulai' di Daftar
- Tambahkan aksi **'Mulai'** pada baris node di panel Daftar (kategori/sub-kategori) yang memanggil `startNode(nodeId)`: menetapkan node aktif; di HP juga berpindah ke tampilan Input. Aksi ini **tidak mengubah** perilaku buka/tutup accordion dari #3 (target sentuh terpisah).
- Node yang sudah `done` menampilkan aksi tersebut dalam keadaan nonaktif atau tersembunyi.

### 7.9 Utilitas uji (hanya pengembangan)
Sediakan fungsi bantu **hanya di build pengembangan** (mis. `window.__simulateScan(kode)`) yang menembakkan rangkaian `keydown` dengan jeda sekitar 10 ms diakhiri Enter, agar tim bisa menguji tanpa mesin scanner. **Tidak boleh ikut ke build produksi.**

### 7.10 Tipe dan data
- Perluas berkas tipe dan modul API dari #3 dan #4 untuk parameter dan field baru di 6.2.
- Bila Bagian A belum selesai, bangun dengan data tiruan yang mengikuti kontrak persis, lalu ganti ke API asli saat Bagian A siap.
- Izin di UI: seluruh rangkaian aktif hanya bagi pemilik `opname.count`; sesi bukan `in_progress` menampilkan mode baca (tanpa penangkap scanner dan tanpa keypad).

## 8. Kriteria selesai (dicek di browser)

Skenario uji manual, semuanya harus lolos. Gunakan `window.__simulateScan` bila tidak ada scanner. Jalankan di lingkungan lokal.

1. Buka sesi aktif. Rangkaian tampil: kartu atas kosong ringan, form idle ('Scan barcode produk'), area rekomendasi berisi petunjuk.
2. Di Daftar, ketuk **'Mulai'** pada sebuah sub-kategori: dua kartu rekomendasi menampilkan dua produk belum dihitung pertama (urut abjad) di sub-kategori itu.
3. Scan produk **A**: form memuat A dan **tanpa** menekan apa pun jumlah siap diketik. Ketik **17** lewat keypad lalu simpan: form kembali ke idle, A muncul di kartu atas tepat di atas form, progres Daftar dan header berubah, rekomendasi bergeser (A tidak tampil lagi di rekomendasi).
4. Scan produk **B**: simpan. Kartu atas menampilkan B (terbaru, paling dekat form) dan A di atasnya. Scan **C**: kartu terlama keluar, hanya dua terakhir yang tampil.
5. Scan produk dari **sub-kategori lain**: node aktif dan rekomendasi pindah ke sub-kategori produk itu.
6. Ketuk kartu **rekomendasi**: produknya dimuat ke form. Tekan **'0 — tidak ada'** lalu simpan: tersimpan 0 dan produk naik ke kartu atas.
7. Ketuk kartu **'sudah dihitung'**: dimuat ke form dengan 'Sudah dihitung: N', dua tombol **'Ganti jadi X'** dan **'Tambah X'** bekerja sesuai #4, dan 'Hapus hitungan' berfungsi.
8. Hitung semua produk dalam satu sub-kategori: rekomendasi diganti kartu **'✓ … selesai'** dan tombol **'Lanjut ke …'** menetapkan node aktif ke node berikutnya yang belum selesai. Selesaikan seluruh sesi: muncul kartu 'Semua produk sudah dihitung' dengan tautan ke Ringkasan.
9. **Jumlah sedang diketik lalu scan masuk:** scan ditolak dengan peringatan 'Simpan atau batalkan … dulu', isian jumlah tetap utuh, dan tidak ada digit dari scan yang masuk ke jumlah. **Form berisi produk tanpa jumlah lalu scan:** produk diganti. **Scan yang sama dua kali dalam <800 ms:** hanya sekali diproses.
10. **Ketikan manusia vs scan:** mengetik '12' lalu Enter pada produk belum dihitung menyimpan 12 (bukan dianggap scan); scan 13 digit tidak pernah meninggalkan digit di jumlah.
11. Scan barcode di luar sesi: pesan 'tidak termasuk dalam sesi ini' dengan getar ganda. Barcode acak: 'Barcode tidak dikenal'. Keduanya tidak mengosongkan form.
12. **Mode buta (default):** periksa semua kartu dan tab Network: tidak ada angka stok, selisih, atau status cocok/selisih di kartu atas, form, maupun rekomendasi. Nyalakan pengaturan angka stok: kartu atas menampilkan cocok/selisih, form menampilkan stok sistem dan pratinjau selisih, rekomendasi menampilkan stok sistem. Matikan lagi: semuanya hilang.
13. Matikan jaringan lalu simpan: pesan galat, isian tetap, dan coba lagi menghasilkan **satu** hitungan. Tekan simpan dua kali dengan cepat: satu hitungan.
14. Di HP (375px): seluruh rangkaian terlihat tanpa keyboard OS; keypad besar dan nyaman; form dan tombol simpan tidak pernah keluar layar; mode padat aktif pada layar pendek (uji tinggi sekitar 550px). Uji juga 768px dan 1280px; tanpa scroll horizontal.
15. Animasi geser berjalan dan **tidak** berjalan bila 'kurangi gerakan' aktif di sistem. Pengaturan 'Suara dan getar' bisa dimatikan dan diingat setelah muat ulang.
16. Tombol 'Mulai' di Daftar tidak mengganggu buka/tutup accordion; 'Riwayat' membuka daftar 10 hitungan terakhir dari #4 dan bisa dipakai untuk koreksi.
17. Form adjustment (Handoff #1), pembuatan sesi (Handoff #2), peta progres (Handoff #3), serta penguncian dan simpan hitungan (Handoff #4) tetap berfungsi normal; `__simulateScan` **tidak ada** di build produksi.
18. `php artisan test` hijau, serta pemeriksaan tipe, lint, dan build frontend bersih.

Setelah pengujian, **batalkan semua sesi uji** agar produk tidak terkunci untuk pekerjaan berikutnya.

## 9. Antarmuka yang akan dipakai handoff berikutnya (jangan diubah tanpa laporan)

- `CountingStack` dan komponen turunannya (dipakai #7 untuk menambah sumber scan kamera tanpa mengubah rangkaian).
- `useScannerCapture` dengan keluaran `onScan(code, { source })` (dipakai #7).
- `startNode`, `workingNodeId`, dan `selectItem` pada `OpnameWorkspaceContext` (dipakai #6 untuk alur hitung ulang dari Ringkasan).
- Parameter `only_counted`, `sort=-counted_at`, `exclude_item_ids`, dan field `counted_at` pada `items` (dipakai #6 dan #8).

**Catatan untuk Handoff #6 (jangan dikerjakan sekarang):** daftar selisih di Ringkasan harus memungkinkan petugas **menghitung ulang** sebuah produk. Pakai `selectItem` agar produk dimuat ke form tengah dan pindah ke tampilan Input. **Catatan untuk Handoff #7:** scan kamera cukup memanggil penangan `onScan` yang sama dengan `source: 'camera'`; antrean offline harus menyimpan `client_request_id` dari #4.

## 10. Dokumentasi dan serah terima

- Perbarui **satu berkas progres tunggal untuk agent frontend: `docs/ROADMAP_PROGRESS.md`**. Tambahkan bagian 'Adjustment & Opname — Handoff #5' berisi: apa yang baru selesai, perubahan endpoint `items`, nama komponen dan hook beserta bentuk akhir konteks, aturan rekomendasi dan node kerja, **syarat operasional scanner (akhiran Enter)**, cara memakai `__simulateScan` di pengembangan, hasil pemeriksaan awal di bagian 4 beserta asumsi yang ternyata berbeda, hasil uji performa, serta fitur UI apa yang kini bisa dibangun. Jangan membuat berkas progres baru.
- Bila `docs/BACKEND_PROGRESS.md` masih dipakai, cukup tambahkan satu baris rujukan. Jangan menduplikasi isi.
- Gunakan commit kecil dan terarah, misalnya: (1) perluasan `items` + test, (2) `useScannerCapture` + uji, (3) `QuantityKeypad` + kolom jumlah baca-saja, (4) `ActiveCountCard` + `ScanPrompt`, (5) `CountedCard` dan `useCountedStrip`, (6) `RecommendationCard`, `useWorkingNode`, `useNextNode`, `NodeCompleteCard`, (7) `CountingStack` + tata letak responsif + mode padat, (8) tombol 'Mulai' di Daftar dan lembar 'Riwayat', (9) umpan balik scan, (10) `__simulateScan` dan dokumentasi.
- Di akhir pekerjaan, tulis **ringkasan serah terima maksimal 10 baris** yang bisa diteruskan ke agent lain: apa yang selesai, apa yang belum, temuan atau asumsi yang berbeda, perintah untuk menjalankan test, dan langkah berikutnya (Handoff #6).

## 11. Larangan

- Jangan membuat kartu atas atau bawah berisi kolom isian. **Hanya form tengah yang menerima input.**
- Jangan mengubah aturan simpan hitungan, idempotensi, penguncian transaksi, atau kebijakan hitung buta dari #3 dan #4.
- Jangan menampilkan atau menyiratkan stok sistem, selisih, atau status cocok/selisih saat pengaturan mati, termasuk lewat nada, getar, urutan kartu, atau peringatan.
- Jangan membuat form menghilangkan isian jumlah yang sudah diketik karena scan masuk.
- Jangan memakai kolom teks bawaan untuk jumlah di perangkat sentuh (memicu keyboard OS yang menutup rangkaian).
- Jangan membuat scan kamera, antrean offline, ringkasan selisih, Posting Opname, atau pengaturan ambang rupiah.
- Jangan menyertakan `__simulateScan` atau utilitas uji lain di build produksi.
- Jangan menambah library UI baru tanpa alasan yang dicatat.
- Jangan melakukan refactor di luar cakupan dokumen ini.
- Jangan menyimpan data sungguhan, kredensial, atau berkas `.env` ke repositori.
