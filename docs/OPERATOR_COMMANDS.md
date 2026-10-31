# Daftar Command Operator

Dokumen ini mencatat command CLI yang tersedia untuk operator sistem POS Retail. Daftar diperiksa dari `php artisan list --raw` pada 31 Oktober 2026.

## Command khusus aplikasi

Command bisnis CLI untuk operator platform:

| Command | Fungsi |
|---|---|
| `php artisan platform:operator-create <username> "<nama>"` | Membuat akun operator platform yang terpisah dari RBAC toko. |
| `php artisan platform:operator-credentials-reset` | Memulihkan username dan password operator aktif secara interaktif; mencabut semua token lama. |
| `php artisan platform:operator-login` | Meminta kredensial operator secara interaktif, lalu membuka UI langsung ke daftar tenant. |

### Membuat operator platform

Jalankan command dari direktori `backend`:

```powershell
php artisan platform:operator-create admin-sistem "Admin Sistem"
```

Command akan meminta password dua kali melalui prompt tersembunyi. Password harus 12–255 karakter dan tidak boleh diberikan sebagai argumen command. Username wajib unik, maksimal 60 karakter, dan hanya boleh mengandung huruf, angka, titik, garis bawah, atau tanda hubung. Nama maksimal 150 karakter.

Akun yang dibuat aktif dan dicatat pada tabel `platform_operators`; akun tidak memerlukan penugasan role toko. Pembuatan juga tercatat di audit log. Simpan password melalui password manager dan jangan menaruhnya di terminal yang direkam, script, source code, atau log.

### Memulihkan username atau password operator

Jika operator lupa username atau password, UI login menyediakan instruksi untuk meminta administrator server menjalankan recovery. Pemulihan sengaja tidak tersedia sebagai endpoint publik atau alur email; hanya seseorang yang memiliki akses CLI server dapat menetapkan kredensial baru.

Jalankan dari direktori `backend`:

```powershell
php artisan platform:operator-credentials-reset
```

Command menampilkan daftar operator platform aktif dengan ID, nama, dan username saat ini. Pilih akun menggunakan ID—ini tetap dapat dilakukan jika username terlupa—lalu masukkan username baru dan password baru dua kali melalui prompt password tersembunyi. Username mengikuti batasan command pembuatan operator; password harus 12–255 karakter. Command tidak mengaktifkan kembali akun yang sudah dinonaktifkan.

Setelah berhasil, command memperbarui username/password secara atomik, mencabut seluruh token Sanctum operator tersebut, dan mencatat perubahan username (tanpa password) pada audit log. Operator harus login kembali menggunakan kredensial baru. Jangan meminta operator mengirim password baru melalui chat atau email.

### Login operator dan membuka daftar tenant

Jalankan dari direktori `backend`:

```powershell
php artisan platform:operator-login
```

Masukkan username dan password pada prompt; password tidak ditampilkan. Jika autentikasi gagal atau akun bukan operator platform aktif, command menolak login tanpa membuat tiket. Jika berhasil, command membuka browser langsung ke layar daftar tenant (`/platform/stores`).

Atur `PLATFORM_UI_URL` di environment backend ke origin/base URL frontend yang digunakan, misalnya `http://127.0.0.1:5173` untuk Vite lokal atau `https://retail.example.com` untuk deployment. Default-nya `http://127.0.0.1:5173`. Jangan menyetel URL berisi username/password, query, atau fragment.

Login browser menggunakan tiket acak sekali pakai yang disimpan dalam bentuk hash di database, berlaku 60 detik, dan ditukar melalui API ber-rate-limit. Tiket ditempatkan pada URL fragment (tidak dikirim sebagai request ke web server); frontend segera menghapus fragment dan menukarnya dengan sesi Sanctum. Password dan token API tidak dicetak ke terminal atau dikirim di URL. Jika browser gagal dibuka atau tiket kedaluwarsa, jalankan ulang command. Opsi `--no-browser` hanya menyiapkan tiket tanpa membuka browser dan ditujukan untuk otomasi/test.

## Command Artisan untuk operasi terkait

Command berikut adalah command Laravel yang tersedia di aplikasi dan berguna untuk memeriksa atau menjalankan operasi dasar. Command ini bukan fitur khusus operator platform.

| Command | Kegunaan |
|---|---|
| `php artisan list --raw` | Melihat seluruh command Artisan yang terpasang, termasuk command vendor. |
| `php artisan migrate:status` | Memeriksa status migration. |
| `php artisan migrate` | Menjalankan migration yang belum diterapkan. |
| `php artisan db:seed` | Menjalankan seeder aplikasi; diperlukan untuk data dasar seperti role Admin sebelum onboarding tenant. |
| `php artisan route:list` | Memeriksa route API yang terdaftar. |
| `php artisan test` | Menjalankan seluruh test backend. |
| `php artisan test tests/Feature/PlatformStoreManagementTest.php` | Menjalankan test Management Retail/operator platform. |

Pastikan konfigurasi database dan environment sudah benar sebelum menjalankan migration atau seeder. Di production, lakukan backup dan ikuti prosedur deployment sebelum mengubah schema atau data.

## Fitur operator yang belum tersedia sebagai command CLI

- Tidak ada command untuk menonaktifkan, mengaktifkan kembali, atau menghapus operator platform.
- Tidak ada command CLI untuk membuat atau mengubah tenant; provisioning tenant tersedia melalui API Management Retail.
- Jangan mengubah status operator atau data tenant langsung melalui SQL sebagai pengganti fitur resmi.

## API Management Retail (bukan command terminal)

API berikut memerlukan autentikasi Sanctum dan operator platform aktif. Frontend mengarahkan operator yang login ke layar `/platform/stores`:

| Method | Path | Kegunaan |
|---|---|---|
| `GET` | `/api/platform/stores` | Mencari dan memfilter tenant. |
| `POST` | `/api/platform/stores` | Membuat tenant beserta akun Admin awal dan konfigurasi dasar secara atomik. |
| `GET` | `/api/platform/stores/{id}` | Melihat detail tenant. |
| `PATCH` | `/api/platform/stores/{id}/status` | Mengaktifkan atau menonaktifkan tenant tanpa menghapus datanya. |
| `POST` | `/api/platform/cli-login/exchange` | Menukar tiket CLI sekali pakai berumur 60 detik dengan token Sanctum; khusus handoff browser, jangan dipanggil UI sebagai alur login biasa. |

Untuk inventaris command Laravel/vendor terbaru, jalankan `php artisan list --raw`; command yang tersedia dapat berubah mengikuti versi framework dan paket.
