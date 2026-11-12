# Panduan Scanner Bluetooth Stock Opname

## Syarat scanner

Gunakan scanner Bluetooth yang bekerja sebagai **keyboard (HID / keyboard wedge)**. Mode serial/SPP tidak didukung browser. Atur agar scanner:

- mengirim **Enter** setelah setiap barcode;
- tidak menambahkan awalan/prefix sebelum kode;
- mengirim karakter barcode sebagai ketikan keyboard.

Nama menu pengaturan bergantung pada merek scanner. Ikuti petunjuk produsennya untuk memilih mode HID dan akhiran Enter.

## Memasangkan scanner ke HP

1. Nyalakan scanner dan aktifkan mode pairing sesuai petunjuk produsennya.
2. Di Android, buka **Setelan → Bluetooth**, pilih scanner pada daftar perangkat, lalu pasangkan.
3. Di iPhone, buka **Settings → Bluetooth**, pilih scanner, lalu pasangkan.
4. Bila scanner meminta PIN, gunakan PIN yang tercantum pada panduan scanner.
5. Kembali ke browser dan buka sesi opname yang sedang berjalan. Jika sambungan terputus, bangunkan scanner dan pilih kembali dari pengaturan Bluetooth HP.

Label menu dan PIN dapat berbeda menurut model scanner dan versi sistem operasi.

## Memindai produk pada kasir dan adjustment

- Pairing Bluetooth tetap dilakukan dari pengaturan perangkat. Di halaman kasir atau form adjustment, klik kolom produk terlebih dahulu lalu scan; aplikasi menerima scanner sebagai input keyboard, tidak membuat koneksi Bluetooth tersendiri.
- Saat membuat produk baru, kolom **Scan barcode** langsung aktif. Scan barcode dan akhiri dengan Enter; hasilnya masuk ke kolom barcode produk. Jika scanner tidak tersedia, isi **Barcode manual**. Barcode boleh dikosongkan agar sistem membuatnya otomatis. Barcode produk hanya bisa ditetapkan saat produk dibuat.
- Di kasir, scan barcode memilih produk tepat dan menambahkannya ke keranjang. Untuk scan pertama produk, jumlah otomatis difokuskan agar bisa diubah; tekan Enter dari kolom jumlah untuk kembali ke kolom scan. Scan ulang produk yang sudah ada menambah jumlah satu.
- Di form adjustment, scan barcode memilih produk tepat dan memfokuskan kolom jumlah. Pilih tipe dan alasan adjustment, lengkapi data wajib lain, lalu simpan.
- Jika barcode tidak dikenal, aplikasi tidak memilih produk lain secara otomatis. Cari berdasarkan nama atau SKU dan pilih hasil yang benar secara manual.

## Uji dan kalibrasi

Pada sesi opname, buka menu **⋯ → Uji scanner**. Scan tiga barcode yang berbeda dan pastikan kode, jeda, panjang, serta akhiran **Enter** terbaca. Pilih **Hitung ambang**, lalu **Simpan hasil kalibrasi**. Pengaturan disimpan di browser pada HP tersebut; lakukan lagi jika memakai browser/perangkat berbeda.

Jika scan tidak terbaca, pastikan mode HID aktif, akhiran Enter terpasang, tidak ada prefix, lalu jalankan kalibrasi. Tombol **Kembalikan ke bawaan** mengatur jeda 40 ms dan panjang minimal 6 karakter.

## Baterai dan sambungan

- Isi daya scanner sebelum menghitung dan siapkan charger atau baterai cadangan.
- Jika scanner tidur, tekan tombol pemindai untuk membangunkannya. Tunggu indikator koneksi stabil sebelum melanjutkan.
- Jika scan tidak masuk, periksa Bluetooth HP, bangunkan scanner, sambungkan ulang bila perlu, lalu gunakan **Uji scanner**.
- Sakelar **Jaga layar tetap menyala** berusaha mencegah layar tidur selama sesi. Dukungan bergantung pada browser dan perangkat.

## Saat jaringan terputus

Halaman opname yang sudah terbuka dapat menyimpan hitungan ke antrean lokal. Chip status menampilkan jumlah operasi yang menunggu; produk yang belum dikirim diberi tanda **belum tersinkron**. Antrean dikirim otomatis saat koneksi kembali. Operasi yang ditolak server tetap tersedia di **Gagal tersinkron** untuk ditinjau.

**Sebelum Posting Opname, pastikan antrean hitungan sudah kosong pada semua perangkat yang ikut menghitung.** Posting, persetujuan, pembuatan sesi, dan memuat ulang halaman saat offline tidak didukung. Jika jaringan terputus, jangan tutup atau muat ulang halaman; tunggu hingga sinkron selesai.

## Catatan penyimpanan iPhone

Safari dapat menghapus penyimpanan situs yang lama tidak dibuka. Aktifkan perlindungan penyimpanan dari lembar **Uji scanner** jika browser mengizinkannya. Menambahkan situs ke **Layar Utama** dapat membantu, tetapi bukan jaminan data akan disimpan selamanya. Sinkronkan antrean sebelum meninggalkan pekerjaan.
