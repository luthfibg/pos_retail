import type { ReactNode } from 'react';

/**
 * Halaman pengaturan dapat tampil mandiri (rute lama) atau tertanam sebagai bagian di layar Pengaturan.
 * Saat tertanam, judul halaman disembunyikan secara visual (judul bagian dipegang layar Pengaturan)
 * dan bingkai halaman (padding, lebar maksimum) dilepas.
 */
export function pageClass(embedded: boolean, width = ''): string {
  return embedded ? 'space-y-4' : `${width} space-y-4 p-6`.trim();
}

export function SettingsTitle({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  return embedded
    ? <h3 className="sr-only">{children}</h3>
    : <h1 className="text-xl font-semibold">{children}</h1>;
}
