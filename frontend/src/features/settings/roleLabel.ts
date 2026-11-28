const ROLE_LABELS: Record<string, string> = {
  Owner: 'Pemilik toko (Owner)',
  Finance: 'Keuangan (Finance)',
  Purchasing: 'Pembelian (Purchasing)',
  Accounting: 'Pembukuan (Accounting)',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  Admin: 'Mengelola semua bagian toko pada pembagian tugas sederhana.',
  Kasir: 'Melayani pelanggan dan menjalankan kegiatan kasir.',
  Owner: 'Pemilik toko: mengatur persetujuan dan aturan serta memantau kegiatan toko.',
  Finance: 'Keuangan: memeriksa kasir jaga, menerima setoran, memeriksa permintaan pembelian, dan mengelola piutang.',
  Purchasing: 'Pembelian: mengelola pemasok, pesanan pembelian, dan data barang.',
  Accounting: 'Pembukuan: mengelola tagihan HRD, memeriksa dokumen penerimaan barang, dan melihat riwayat perubahan.',
};

export function displayRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function displayRoleDescription(role: string, fallback: string | null): string | null {
  return ROLE_DESCRIPTIONS[role] ?? fallback;
}
