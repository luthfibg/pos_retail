# HANDOFF #3 — Kerangka Layar Opname + Peta Progres (Hanya Baca) + Pengaturan Angka Stok

Proyek: POS Retail SMK · Seri: Adjustment & Opname (Handoff #3 dari 8) · Dibuat: 7 November 2026 · Status: siap dikerjakan (Handoff #1 dan #2 sudah lolos test)

## 0. Ringkasan untuk agent yang baru bergabung

Handoff #2 membuat **sesi opname** (cakupan, item, status). Handoff #3 membangun **layar kerja opname** di rute `opname/:sessionId`: kerangka responsif (mobile-first), **peta progres** berupa daftar kategori > sub-kategori > produk dengan penanda status, header progres, dan pengaturan **'Tampilkan angka stok saat opname'** (default: disembunyikan, hitung buta).

Layar ini **hanya baca**. Panel input (form kosong, scan, simpan hitungan) adalah Handoff #4. Di sini panel input hanya placeholder bersebelahan dengan peta progres yang sudah hidup.

Pemakaian utama kelak di **HP** (admin keliling rak). Semua UI mobile-first.

## 1. Konteks seri handoff

| # | Isi | Status |
|---|---|---|
| 1 | Kerangka halaman + tab Adjustment | Selesai |
| 2 | Sesi opname: buat, daftar, status, cakupan | Selesai (lolos test) |
| **3** | **Kerangka layar opname + peta progres (baca saja) + pengaturan angka stok** | **Dokumen ini** |
| 4 | Input hitungan inti: form kosong, scan/cari, autosave, progres berwarna | Berikutnya |
| 5 | Form rekomendasi + alur terpandu per sub-kategori | |
| 6 | Ringkasan selisih + Posting Opname + persetujuan Owner + adjustment otomatis | |
| 7 | Penyempurnaan HP: scan kamera, draft lokal + sinkron | |
| 8 | Riwayat per periode + penutup | |

## 2. Cakupan

**Termasuk:**
- Backend: endpoint pohon progres, endpoint daftar item (lazy per kategori + pencarian), kebijakan tampil/sembunyi stok yang dipaksa di server, pengaturan 'tampilkan angka stok', perbaikan perhitungan `counted_products`, perintah artisan simulasi hitungan (khusus lokal/test).
- Frontend: layar opname responsif (HP: tiga tampilan dengan bottom bar; tablet dan desktop: dua panel), peta progres, filter 'belum dihitung', pencarian, header progres, state konteks aktif, pengaturan di menu setting admin.

**Tidak termasuk (jangan dikerjakan):**
- Form input hitungan, scan barcode, simpan hasil hitung, endpoint yang menulis `counted_qty` (Handoff #4).
- Form rekomendasi dan alur terpandu (Handoff #5).
- Ringkasan selisih, tombol Posting Opname, persetujuan Owner, pengaturan ambang rupiah (Handoff #6).
- Menambah produk ke sesi yang berjalan, scan kamera, mode offline.

## 3. Pemeriksaan awal wajib (sebelum menulis kode)

Dokumen ini ditulis tanpa melihat kode terbaru. **Verifikasi dan catat hasilnya.** Bila sebuah asumsi salah dan memengaruhi desain, **hentikan bagian itu dan laporkan ke pengguna**, jangan improvisasi.

1. Handoff #1 dan #2 selesai dan test hijau: `stock_opname_sessions`, `stock_opname_session_categories`, `stock_opname_items` (termasuk kolom hitung yang nullable), `OpnameSessionService`, rute `opname/:sessionId` sebagai slot, halaman ringkasan sesi dan tombol batalkan.
2. **Kedalaman hierarki kategori** yang sebenarnya di master data dan bagaimana produk terkait (hanya ke daun, atau juga ke induk). Desain UI untuk dua tingkat (kategori > sub-kategori) tetapi harus bekerja untuk kedalaman berapa pun.
3. **Mekanisme pengaturan/konfigurasi yang sudah ada** (tempat disimpannya konfigurasi seperti persentase endapan atau mode gudang), halaman setting admin di frontend, dan izin yang dipakai untuk mengubahnya.
4. Apakah sudah ada **audit log** untuk perubahan konfigurasi.
5. Komponen **accordion/collapse** di library UI yang dipakai, dan pola data-fetching (mis. React Query) beserta dukungan refetch berkala.
6. Cara aplikasi saat ini menangani **safe-area** dan tinggi layar di HP.
7. Baca `docs/ROADMAP_PROGRESS.md` (berkas progres tunggal) dan, bila masih dipakai, `docs/BACKEND_PROGRESS.md`.

## 4. Keputusan yang dipakai di handoff ini

**4.1 Hitung buta.** Stok sistem **disembunyikan secara default**. Pengaturan 'Tampilkan angka stok saat opname' bersifat **satu untuk seluruh toko**, bisa diubah Admin dan Owner, berlaku langsung pada semua sesi, dan perubahannya dicatat di audit log (bila infrastrukturnya ada). **Penyembunyian dipaksa di server**: bila pengaturan mati, field stok tidak dikirim sama sekali (kuncinya tidak ada, bukan bernilai null). Ini mencegah petugas mengintip lewat tab Network. Catatan batas: ini menjaga layar opname agar hitungan tidak terpengaruh, bukan batas keamanan penuh, karena stok tetap terlihat di halaman stok lain.

**4.2 Status selisih ikut disembunyikan saat mode buta (keputusan baru, perlu konfirmasi pengguna).** Bila status 'cocok' dan 'selisih' tampil langsung setelah produk dihitung, petugas bisa mengulang input sampai 'cocok', sehingga hitung buta tidak berarti. Maka:
- Pengaturan **mati** (default): setelah dihitung, produk hanya berstatus **'Sudah dihitung'** (tanpa cocok/selisih). Selisih baru terlihat di Ringkasan (Handoff #6).
- Pengaturan **hidup**: status produk membedakan **cocok** dan **selisih** secara langsung, dan node induk menampilkan jumlah selisih.
- Jumlah hitungan yang diinput petugas sendiri (`counted_qty`) boleh ditampilkan setelah dihitung, karena itu data yang dia masukkan, bukan stok sistem.

**4.3 Kosakata status** (backend menjadi sumber kebenaran):
- Produk: `uncounted`, `counted`; bila stok boleh terlihat: `matched`, `variance` (menggantikan `counted`).
- Node (kategori/sub-kategori): `not_started` (belum ada yang dihitung), `partial` (sebagian), `done` (seluruh produk di bawahnya sudah dihitung).
- Aturan agregasi: node `done` **hanya jika semua produk di seluruh turunannya sudah dihitung**; `not_started` jika tidak ada satu pun; selain itu `partial`. Satu anak `done` dan anak lain belum membuat induk tetap `partial`.

**4.4 Penanda status** (tidak boleh hanya warna; selalu ada ikon dan teks): `not_started`/`uncounted` abu-abu + lingkaran kosong + 'Belum'; `partial` oranye + setengah lingkaran + 'Sebagian'; `done`/`counted` hijau + centang + 'Selesai'/'Sudah dihitung'; `variance` kuning + ikon ± + 'Selisih'. Gunakan token warna tema yang sudah ada, dan pastikan kontras cukup untuk dibaca di bawah lampu toko.

**4.5 'Realtime'** diwujudkan dengan **refetch berkala (±15 detik) hanya saat layar terlihat dan tab aktif**, ditambah refetch saat jendela kembali fokus dan tombol muat ulang manual. Bukan websocket. Memadai untuk satu admin sekarang dan beberapa perangkat nanti.

**4.6 Konteks aktif.** Layar menyimpan satu **node aktif** (kategori/sub-kategori yang sedang dikerjakan). Handoff #4 dan #5 memakainya untuk mengisi form rekomendasi dan lompat otomatis. Di handoff ini node aktif hanya dipilih dengan mengetuk node di Daftar, disorot, dan ditampilkan di header progres.

**4.7 Sesi berstatus selain `in_progress`** (mis. dibatalkan) tetap bisa dibuka dalam mode baca dengan spanduk status yang jelas.

## 5. Bagian A — Backend

Kerjakan Bagian A lebih dulu. Setelah kontrak di 5.4 final, Bagian B boleh jalan paralel memakai data tiruan.

### 5.1 Prinsip
- Handoff ini **tidak menulis `counted_qty`** lewat endpoint HTTP apa pun. Satu-satunya penulis di handoff ini adalah perintah artisan simulasi (5.6).
- Seluruh aturan 'boleh lihat stok atau tidak' berada di **satu tempat** (mis. kelas kebijakan tampilan opname) yang dipakai semua endpoint opname. Handoff berikutnya wajib memakainya juga.
- Hindari N+1 query. Agregasi dilakukan dengan query berkelompok, bukan perulangan per kategori.
- Perubahan pada kode yang sudah ada bersifat **aditif**, kecuali perbaikan `counted_products` di 5.5.

### 5.2 Pengaturan 'tampilkan angka stok saat opname'
- Kunci (usulan): `opname.show_system_qty`, boolean, default `false`. Simpan lewat mekanisme konfigurasi yang sudah ada (hasil pemeriksaan 3.3).
- Dibaca dan diubah lewat endpoint konfigurasi yang sudah ada (tambah kunci baru secara aditif). Bila belum ada pola yang cocok, buat endpoint kecil yang mengikuti konvensi, dan catat keputusannya.
- Izin mengubah: Owner dan Admin (ikuti permission untuk konfigurasi yang sudah ada).
- Setiap perubahan dicatat (siapa, kapan, nilai lama dan baru) bila audit log tersedia.

### 5.3 Kebijakan tampilan (satu sumber kebenaran)
Buat satu komponen (mis. `OpnameDisplayPolicy`) dengan method seperti `revealsSystemQty(): bool`. Seluruh resource/serializer opname memakainya. Bila `false`:
- Kunci `system_qty` tidak ada di respons item.
- Status produk yang dikembalikan hanya `uncounted` atau `counted`.
- Kunci `variance_count` tidak ada di node pohon.
Bila `true`: kunci-kunci itu muncul dan status produk `matched`/`variance` dipakai. `system_qty` yang ditampilkan adalah `system_qty_at_start` (atau `system_qty_at_count` bila sudah dihitung, mulai Handoff #4).

### 5.4 Kontrak API

Ikuti envelope dan format galat yang sudah ada. Bentuk di bawah adalah isi logisnya. Semua endpoint butuh `opname.view`.

**GET `/api/stock-opname-sessions/{id}/tree`** — pohon progres
```
{
  session: { id, number, status },
  display: { reveals_system_qty: boolean },
  summary: { total_products, counted_products },
  nodes: [
    {
      id, name, parent_id, depth,
      product_count,            // jenis produk di seluruh turunan, dalam sesi ini
      counted_count,            // yang sudah dihitung di seluruh turunan
      status,                   // not_started | partial | done
      direct_product_count,     // produk yang langsung di node ini
      direct_counted_count,
      variance_count?,          // HANYA bila reveals_system_qty = true
      children: [ ...node ]
    }
  ]
}
```
Aturan:
- Hanya kategori yang punya minimal satu item dalam sesi (beserta induknya) yang muncul.
- Urutan: ikuti `sort_order` kategori bila ada, jika tidak urut abjad nama. Stabil antar permintaan.
- Bila sebuah kategori sudah dihapus atau dipindah sejak sesi dimulai, tampilkan item-nya di bawah simpul akar 'Lainnya' memakai nama snapshot. Jangan membuat galat.
- Payload **tidak memuat item produk**. Item diambil lewat endpoint di bawah.

**GET `/api/stock-opname-sessions/{id}/items`** — daftar item (dimuat saat accordion dibuka, dan untuk pencarian)
Query: `category_id`, `scope` (`direct` default, atau `all` untuk seluruh turunan), `q` (nama atau barcode), `only_uncounted` (boolean), `page`, `per_page` (default 100, maks 200).
Item:
```
{
  id, product_id, name, barcode,
  category_path: ["Makanan", "Mi Instan"],
  status,                       // uncounted | counted (atau matched | variance bila reveal)
  counted_qty,                  // null bila belum dihitung
  system_qty?                   // HANYA bila reveals_system_qty = true
}
```
- Tanpa `category_id`, endpoint ini mencari di seluruh sesi (dipakai pencarian produk di Daftar). `q` minimal 2 karakter.
- Urutan: nama produk, abjad. Pencarian dengan kecocokan barcode persis didahulukan.
- Gunakan nama/barcode snapshot dari item, bukan master live.

**Perubahan pada endpoint #2 (aditif/perbaikan):**
- `counted_products` di daftar dan detail sesi kini dihitung dari item yang `counted_qty`-nya tidak null (sebelumnya selalu 0). Hitung secara berkelompok untuk satu halaman daftar, jangan per sesi.
- Detail sesi tidak perlu menambah informasi tampilan; `display.reveals_system_qty` cukup ada di endpoint `tree`.

**Endpoint pengaturan:** lihat 5.2.

### 5.5 Performa
Target pada sesi `all` berisi ±5.000 item: `tree` kurang dari sekitar 1 detik, `items` (100 baris) kurang dari sekitar 300 ms. Gunakan indeks yang sudah dibuat di Handoff #2 (`session_id`, `category_id`). Bila target tidak tercapai pada data uji, laporkan angka ukurnya dan usulan perbaikan, jangan menyembunyikannya.

### 5.6 Perintah artisan simulasi (khusus pengembangan)
Agar progres bisa dilihat di browser sebelum Handoff #4, buat `php artisan opname:simulate-counts {sessionId} {--percent=30} {--variance=10} {--reset}`:
- **Hanya boleh berjalan di environment `local` dan `testing`.** Di environment lain, tolak dengan pesan jelas dan kode keluar tidak nol.
- Menandai sebagian item (`--percent` dari total) sebagai sudah dihitung: isi `counted_qty`, `system_qty_at_count`, `counted_at`, `counted_by`. Sebagian dari yang dihitung (`--variance` persen) diberi `counted_qty` berbeda dari stok sistem.
- `--reset` mengosongkan kembali kolom hitung sesi tersebut.
- Tidak ada endpoint HTTP untuk ini.

### 5.7 Test backend (wajib lolos)
1. `tree`: struktur dua tingkat benar, `product_count`/`counted_count`/`status` benar, hanya kategori ber-item yang muncul.
2. Agregasi: semua `uncounted` → `not_started`; sebagian → `partial`; satu anak `done` + anak lain belum → induk tetap `partial`; semua dihitung → `done`. Termasuk node yang memiliki produk langsung **dan** anak.
3. Kategori yang dihapus atau dipindah setelah sesi dimulai: item tampil di 'Lainnya', tidak error.
4. **Hitung buta:** dengan pengaturan mati, respons `tree` dan `items` **tidak mengandung** kunci `system_qty` maupun `variance_count`, dan status hanya `uncounted`/`counted` (periksa kunci tidak ada, bukan null). Dengan pengaturan hidup: kunci muncul dan status `matched`/`variance` dipakai.
5. `items`: filter kategori dengan `scope` direct/all, pencarian nama dan barcode, `only_uncounted`, paginasi, `category_path` benar, kecocokan barcode didahulukan.
6. `counted_products` di daftar dan detail sesi mencerminkan item yang dihitung.
7. Pengaturan: default `false`, hanya peran berizin yang bisa mengubah, perubahan tercatat bila audit log ada.
8. Izin: 401, 403 untuk role tanpa `opname.view`, berhasil untuk role berizin. Sesi `cancelled` tetap bisa dibaca.
9. Perintah artisan: menolak di environment non-lokal; di `testing` mengisi kolom hitung sesuai persentase; `--reset` mengosongkan.
10. Tidak ada N+1 (batasi jumlah query pada `tree` dan `items`).
11. Uji beban sederhana pada data buatan (lihat 5.5) dan laporkan waktunya.

Pengguna menjalankan `php artisan test` di mesinnya. Sertakan perintah yang tepat dan hasil yang diharapkan di laporan serah terima.

## 6. Bagian B — Frontend

Stack: React + Vite + TypeScript. **Ikuti library, struktur folder, dan pola yang sudah ada.** Jangan menambah library UI baru tanpa alasan kuat.

### 6.1 Struktur halaman `opname/:sessionId`
Halaman ini kini menjadi **layar kerja opname**. Konten ringkasan dari Handoff #2 (kartu informasi, tombol batalkan) **dipindahkan, bukan dibuang**: menjadi isi tampilan **Ringkasan**.

Header tipis (lengket di atas): tombol kembali ke daftar sesi, nomor dan nama sesi, lencana status, bar progres 'X/Y dihitung', dan menu overflow (⋯) berisi 'Batalkan sesi' (hanya bila `in_progress` dan berizin; alurnya sama seperti Handoff #2). Sediakan **ruang kosong di header untuk tombol Posting Opname** yang dikerjakan Handoff #6, tetapi **jangan membuat tombolnya**.

### 6.2 Tata letak responsif (mobile-first)
- **HP (di bawah 768px):** satu panel dengan **bottom bar tiga tampilan: Input · Daftar · Ringkasan**, tinggi sekitar 56px, memperhitungkan safe-area. Tampilan terbuka secara default: **Input** (placeholder di handoff ini). Tampilan aktif disimpan di parameter URL (`?view=input|daftar|ringkasan`) agar refresh tidak mengubahnya.
- **Header progres tipis di HP** (satu baris, lengket): menampilkan konteks aktif dan progresnya, mis. 'Mi Instan 13/30 · Makanan 4/11'. Bila belum ada node aktif: 'Progres total X/Y'.
- **Tablet (768–1023px):** dua panel. Daftar di kiri (sekitar 340px, kepadatan ringkas) yang **bisa dilipat** menjadi rel ikon agar panel kanan mengambil lebar penuh. Panel kanan berisi Input (placeholder).
- **Desktop (mulai 1024px):** dua panel berdampingan, Daftar di kiri (sekitar 40%), Input di kanan. Ringkasan dibuka sebagai panel geser atau dialog dari header.
- Target sentuh minimal 44px. Tidak boleh ada scroll horizontal di semua lebar. Panel Daftar dan Input masing-masing menggulir sendiri.

### 6.3 Panel Daftar (peta progres)
- Bagian atas: kolom pencarian, dan chip filter **Semua | Belum dihitung**.
- Accordion: **kategori → sub-kategori → produk**. Struktur umum mendukung kedalaman berapa pun. Node yang punya produk langsung **dan** anak menampilkan anak-anaknya lalu kelompok 'Tanpa sub-kategori (n)' untuk produk langsungnya.
- Baris node: nama dan jumlah jenis produk dalam kurung, mis. **'Makanan (235)'**; di kanan ikon status, bar progres tipis, dan teks 'counted/total', mis. '12/235'. Bila stok boleh terlihat dan ada selisih, tampilkan lencana jumlah selisih.
- Baris produk: nama, barcode kecil, dan lencana status (teks + ikon). Bila `system_qty` ada di respons, tampilkan sebagai angka redup di kanan. Bila `counted_qty` ada, tampilkan sebagai 'Hitungan: N'. **Jangan menampilkan angka stok bila kuncinya tidak ada di respons**, dan jangan menurunkannya dari sumber lain.
- Produk dimuat **malas** saat node dibuka (`items` dengan `category_id` dan `scope=direct`), dengan skeleton saat memuat dan tombol 'Muat lagi' bila lebih dari satu halaman.
- **Filter 'Belum dihitung':** sembunyikan node yang `counted_count == product_count`, dan di dalam node tampilkan hanya produk yang belum dihitung (`only_uncounted=true`). Node yang disembunyikan tidak mengubah angka header.
- **Pencarian:** nama kategori dicocokkan di klien dari data pohon; nama produk/barcode lewat `items?q=` (tanpa `category_id`). Hasil produk menampilkan `category_path` dan mengetuknya membuka dan menyorot node induknya.
- Mengetuk baris node/sub-kategori **membuka-menutup** accordion dan menjadikannya **node aktif** (disorot). Status terbuka/tutup dan posisi gulir **dipertahankan saat refetch** (tidak boleh menutup sendiri atau melompat).
- Keadaan wajib: memuat (skeleton), kosong, galat (dengan tombol coba lagi), dan spanduk bila sesi bukan `in_progress`.
- Aksesibilitas: atribut accordion yang benar (`aria-expanded`), navigasi keyboard, status selalu dengan teks atau ikon.

### 6.4 Panel Input (placeholder) dan konteks aktif
- Komponen `OpnameInputPanel` berisi kartu keterangan: 'Panel input dibangun di tahap berikutnya'. **Jangan membuat apa pun selain itu.**
- Buat **konteks/state bersama** untuk layar (mis. `OpnameWorkspaceContext`) yang menyimpan: `activeNodeId`, `setActiveNode`, dan data pohon yang sedang termuat. Handoff #4 dan #5 akan membaca ini. Catat bentuk akhirnya di berkas progres.

### 6.5 Tampilan Ringkasan
Isi tampilan Ringkasan: kartu informasi sesi dari Handoff #2 (nomor, nama, status, cakupan, total produk, progres, waktu mulai, pembuat, catatan, informasi pembatalan), ditambah rincian progres: jumlah produk sudah/belum dihitung, dan jumlah kategori `done`/`partial`/`not_started` dihitung dari pohon. **Tidak ada daftar selisih** di sini (itu Handoff #6); sediakan area kosong yang jelas untuk itu.

### 6.6 Pengaturan 'Tampilkan angka stok saat opname'
- Letakkan di halaman setting admin yang sudah ada, dalam bagian baru **'Opname'** (bagian ini akan menampung pengaturan ambang persetujuan di Handoff #6, jadi buat sebagai bagian tersendiri, bukan satu toggle lepas).
- Toggle dengan penjelasan singkat: bila **mati** (disarankan), petugas menghitung tanpa melihat stok sistem agar hasil hitungan tidak terpengaruh; bila **hidup**, stok sistem dan status cocok/selisih terlihat selama menghitung.
- Default **mati**. Perubahan berlaku langsung; tampilkan konfirmasi singkat dan nyatakan bahwa berlaku untuk seluruh sesi.
- Hanya Owner dan Admin yang melihat dan mengubahnya.

### 6.7 Tipe dan data
- Buat tipe TypeScript untuk kontrak di 5.4 di satu berkas tipe, dan satu modul API untuk pohon dan item.
- **Refetch berkala** ±15 detik hanya saat layar terlihat (Page Visibility) dan tab aktif, ditambah refetch saat fokus jendela kembali dan tombol muat ulang manual. Gunakan mekanisme yang sudah ada di library data-fetching.
- Saat refetch, pertahankan status buka/tutup node dan posisi gulir.
- Bila Bagian A belum selesai, bangun Bagian B dengan data tiruan yang mengikuti kontrak persis, lalu ganti ke API asli saat Bagian A siap.
- Izin di UI: layar opname dan tombol terkait hanya tampil sesuai izin; akses langsung ke rute tanpa izin ditolak dengan halaman yang sesuai.

## 7. Kriteria selesai (dicek di browser)

Skenario uji manual, semuanya harus lolos. Jalankan di lingkungan lokal.

1. Mulai sesi opname (Handoff #2), lalu buka sesinya: layar kerja terbuka dengan header, bar progres 0/Y, dan Daftar berisi kategori dengan jumlah jenis produk yang benar.
2. Buka satu kategori lalu sub-kategori: produk dimuat dengan status 'Belum', **tanpa angka stok** (periksa juga tab Network: tidak ada kunci `system_qty` di respons `tree` maupun `items`).
3. Jalankan `php artisan opname:simulate-counts <id> --percent=40 --variance=15`, lalu tunggu refetch otomatis atau tekan muat ulang: progres, ikon, dan bar berubah sesuai aturan agregasi (induk `partial` bila ada anak yang belum selesai; `done` hanya bila semua selesai). Status produk yang dihitung hanya 'Sudah dihitung' (tanpa cocok/selisih).
4. Nyalakan **'Tampilkan angka stok saat opname'** di setting admin: angka stok sistem muncul di baris produk, status membedakan **cocok** dan **selisih**, dan node menampilkan jumlah selisih. Matikan lagi: semuanya hilang dan kunci tidak ada lagi di respons.
5. Filter **'Belum dihitung'**: node yang sudah selesai tersembunyi, produk yang tampil hanya yang belum dihitung. Matikan filter: kembali normal.
6. Cari nama produk atau barcode: hasil muncul dengan `category_path`; mengetuknya membuka dan menyorot node induknya.
7. Saat refetch berjalan, node yang sedang terbuka **tidak menutup** dan posisi gulir tidak melompat.
8. Ketuk sub-kategori: menjadi node aktif, disorot, dan tampil di header progres (di HP: 'Sub-kategori X/Y · Kategori X/Y').
9. Layout diuji di **375px** (bottom bar tiga tampilan, tampilan aktif tersimpan di URL dan bertahan saat refresh), **768px** (Daftar bisa dilipat), dan **1280px** (dua panel). Tanpa scroll horizontal.
10. Batalkan sesi dari menu ⋯: layar menjadi mode baca dengan spanduk status; data tetap bisa dilihat.
11. Buka `opname/:id?view=daftar` langsung (deep link): tampilan benar.
12. Login sebagai Kasir: tidak ada akses ke layar opname maupun pengaturannya.
13. Tab Adjustment (Handoff #1) dan daftar serta pembuatan sesi (Handoff #2) tetap berfungsi normal.
14. `php artisan test` hijau, serta pemeriksaan tipe, lint, dan build frontend bersih.

Setelah pengujian, jalankan `--reset` pada sesi uji lalu **batalkan semua sesi uji** agar produk tidak terkunci untuk pekerjaan berikutnya.

## 8. Antarmuka yang akan dipakai handoff berikutnya (jangan diubah tanpa laporan)

- Endpoint `tree` dan `items` dengan kosakata status di bagian 4.3 (dipakai #4, #5, #6).
- Kebijakan tampilan opname dan kunci pengaturan `opname.show_system_qty` (dipakai semua endpoint opname berikutnya).
- `OpnameWorkspaceContext` dengan `activeNodeId` (dipakai #4 dan #5).
- Slot `OpnameInputPanel` dan tampilan Ringkasan (dipakai #4 dan #6).
- Bagian **'Opname'** di halaman setting admin (dipakai #6 untuk ambang persetujuan).
- Ruang kosong di header untuk tombol Posting Opname (dipakai #6).

**Catatan untuk Handoff #6 (jangan dikerjakan sekarang):** ambang persetujuan Owner disetujui pengguna dalam rupiah dan harus berada di bagian 'Opname' pada setting admin. Usulan nilai awal: **Rp25.000 per produk** dan **Rp200.000 total mutlak per sesi** (jumlah nilai semua selisih, kurang dan lebih dijumlahkan sebagai nilai positif). Persetujuan lewat konfirmasi password Owner. Opname pertama setelah migrasi data sebaiknya selalu disetujui Owner.

## 9. Dokumentasi dan serah terima

- Perbarui **satu berkas progres tunggal untuk agent frontend: `docs/ROADMAP_PROGRESS.md`**. Tambahkan bagian 'Adjustment & Opname — Handoff #3' berisi: apa yang baru selesai, daftar endpoint beserta bentuknya, kunci pengaturan, nama kebijakan tampilan dan konteks bersama, hasil pemeriksaan awal di bagian 3 beserta asumsi yang ternyata berbeda, hasil uji performa, cara memakai perintah simulasi, serta fitur UI apa yang kini bisa dibangun. Jangan membuat berkas progres baru.
- Bila `docs/BACKEND_PROGRESS.md` masih dipakai, cukup tambahkan satu baris rujukan. Jangan menduplikasi isi.
- Gunakan commit kecil dan terarah, misalnya: (1) pengaturan + kebijakan tampilan, (2) endpoint `tree` + test, (3) endpoint `items` + test, (4) perintah simulasi + perbaikan `counted_products`, (5) kerangka layar + bottom bar + header, (6) panel Daftar, (7) tampilan Ringkasan + menu batalkan, (8) pengaturan di setting admin, (9) dokumentasi.
- Di akhir pekerjaan, tulis **ringkasan serah terima maksimal 10 baris** yang bisa diteruskan ke agent lain: apa yang selesai, apa yang belum, temuan atau asumsi yang berbeda, perintah untuk menjalankan test, dan langkah berikutnya (Handoff #4).

## 10. Larangan

- Jangan membuat form input hitungan, scan barcode, endpoint penulis `counted_qty`, atau logika posting.
- Jangan mengirim `system_qty`, `variance_count`, atau status `matched`/`variance` bila pengaturan mati. Penyembunyian harus di server, bukan hanya di UI.
- Jangan menurunkan stok sistem dari endpoint atau sumber lain di layar opname.
- Jangan menjalankan perintah simulasi di environment selain `local` dan `testing`.
- Jangan membuat tombol Posting Opname atau pengaturan ambang rupiah (itu Handoff #6).
- Jangan mengubah perilaku `InventoryService`, tab Adjustment, atau respons endpoint yang dipakai fitur lain (hanya penambahan aditif dan perbaikan `counted_products`).
- Jangan menambah library UI baru tanpa alasan yang dicatat.
- Jangan melakukan refactor di luar cakupan dokumen ini.
- Jangan menyimpan data sungguhan, kredensial, atau berkas `.env` ke repositori.
