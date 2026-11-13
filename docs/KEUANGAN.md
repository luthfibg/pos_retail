# Keuangan

## Pembayaran dan biaya

- PO yang penerimaannya lengkap otomatis dilunasi dan mendebit Kas Besar saat penerimaan diposting. Pembayaran PO sebelumnya diperhitungkan; penerimaan parsial tidak otomatis melunasi.
- Pembayaran manual PO dapat dicicil, tidak boleh melebihi sisa PO atau saldo Kas Besar, dan mengurangi Kas Besar saat dicatat. Pelunasan otomatis tetap diposting meski saldo tidak cukup sehingga saldo Kas Besar dapat negatif.
- Termin PO tetap menjadi informasi supplier. Rekening yang tercantum di PO adalah referensi dokumen; pembayaran mendebit ledger Kas Besar.
- Biaya operasional dan gaji langsung mengurangi Kas Besar saat disimpan. Keterangan wajib; untuk gaji, cantumkan nama karyawan dan periode.
- Pengeluaran tidak dapat melebihi saldo Kas Besar yang tercatat. Catatan transaksi dan ledger bersifat append-only.

## Laporan

- Periode menggunakan tanggal WIB dan dapat dicetak.
- Arus kas dan saldo berasal dari ledger Kas Besar.
- Laba kotor memakai laporan penjualan dan snapshot HPP yang sudah ada.
- Laba bersih = laba kotor - biaya operasional - gaji - nilai retur supplier yang sudah disetujui untuk write-off. Retur yang baru ditolak supplier belum dihitung sebagai kerugian.
- Pembayaran PO ditampilkan sebagai arus kas keluar, tetapi tidak dikurangkan lagi dari laba bersih karena HPP sudah diperhitungkan pada laba kotor.

## Akses

- Finance dan Accounting dapat melihat laporan serta mencatat pembayaran/biaya.
- Owner dapat melihat laporan; Admin memiliki seluruh izin.
