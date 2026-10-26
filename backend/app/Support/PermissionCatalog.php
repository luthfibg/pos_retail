<?php

namespace App\Support;

/**
 * Daftar permission Paket 1 (sesuai Bagian 14.3 dokumen kebutuhan).
 * Admin memegang semua; Kasir memegang subset di cashier().
 * Catatan: `product.create` dan `reports.view` untuk Kasir dibatasi lebih lanjut di service
 * (produk baru berstatus pending_price; laporan hanya shift/stok sendiri).
 */
final class PermissionCatalog
{
    /** @return array<string, string> code => deskripsi */
    public static function all(): array
    {
        return [
            'user.manage' => 'Kelola pengguna',
            'role.manage' => 'Kelola role dan permission',
            'settings.manage' => 'Kelola pengaturan sistem',
            'audit_log.view' => 'Melihat audit log',
            'product.create' => 'Membuat produk baru (Kasir: status menunggu harga)',
            'product.update' => 'Mengubah data produk',
            'product.activate' => 'Mengaktifkan produk untuk dijual',
            'price.change' => 'Mengubah harga jual',
            'category.manage' => 'Kelola kategori produk',
            'supplier.manage' => 'Kelola supplier',
            'shelf_layout.manage' => 'Kelola denah rak',
            'shelf_layout.view' => 'Melihat denah rak',
            'inventory.view' => 'Melihat stok dan pergerakan stok',
            'discount.manage' => 'Kelola diskon',
            'customer.create' => 'Menambah data karyawan (status menunggu verifikasi)',
            'customer.verify' => 'Memverifikasi karyawan',
            'customer.update' => 'Mengubah data karyawan',
            'customer.set_limit' => 'Menetapkan batas kredit karyawan',
            'customer.select' => 'Memilih karyawan di POS',
            'purchase_requisition.create' => 'Membuat Purchase Requisition',
            'purchase_requisition.finance_check' => 'Memeriksa PR (saldo/kelayakan)',
            'purchase_requisition.approve' => 'Menyetujui PR (autentikasi ulang Owner)',
            'purchase_order.create' => 'Membuat Purchase Order',
            'purchase_order.send' => 'Mengirim PO ke supplier',
            'goods_receipt.create' => 'Mencatat penerimaan barang',
            'goods_receipt.verify_documents' => 'Memverifikasi surat jalan dan faktur',
            'stock_transfer.create' => 'Membuat transfer stok',
            'inventory.adjust.request' => 'Mengajukan adjustment stok',
            'inventory.adjust.approve' => 'Menyetujui adjustment stok',
            'sales.create' => 'Melakukan penjualan',
            'sales.credit_exception' => 'Memberi pengecualian kredit melebihi batas',
            'sales.void' => 'Membatalkan penjualan terposting',
            'receipt.reprint' => 'Mencetak ulang struk (berlabel salinan)',
            'shift.open' => 'Membuka shift kas',
            'shift.close' => 'Menutup shift kas',
            'shift.review' => 'Meninjau shift dan selisih kas',
            'cash_movement.create' => 'Mencatat kas masuk/keluar nonpenjualan',
            'float.propose' => 'Mengusulkan endapan kas',
            'float.configure' => 'Menetapkan kebijakan endapan kas',
            'cash_deposit.create' => 'Membuat setoran kasir',
            'cash_deposit.receive' => 'Menerima dan menghitung setoran',
            'billing_period.manage' => 'Mengatur periode tagihan',
            'billing_period.close' => 'Menutup periode tagihan',
            'invoice.generate' => 'Membuat invoice bulanan',
            'invoice.issue' => 'Menerbitkan invoice',
            'invoice.record_payment' => 'Mencatat pembayaran invoice dari HRD',
            'reports.view' => 'Melihat laporan',
        ];
    }

    /** @return list<string> */
    public static function cashier(): array
    {
        return [
            'product.create',
            'shelf_layout.view',
            'inventory.view',
            'customer.create',
            'customer.select',
            'purchase_requisition.create',
            'goods_receipt.create',
            'stock_transfer.create',
            'inventory.adjust.request',
            'sales.create',
            'receipt.reprint',
            'shift.open',
            'shift.close',
            'cash_movement.create',
            'float.propose',
            'cash_deposit.create',
            'reports.view',
        ];
    }

    public static function module(string $code): string
    {
        return explode('.', $code, 2)[0];
    }
}
