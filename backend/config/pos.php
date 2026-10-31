<?php

return [
    'default_store_code' => env('POS_STORE_CODE', 'SMK'),
    'default_store_name' => env('POS_STORE_NAME', 'Toko SMK'),

    // Masa berlaku token API (jam)
    'token_ttl_hours' => (int) env('POS_TOKEN_TTL_HOURS', 12),
    'platform_ui_url' => env('PLATFORM_UI_URL', 'http://127.0.0.1:5173'),

    // Batas percobaan gagal autentikasi ulang (persetujuan) per username sebelum dikunci 5 menit
    'reauth_max_attempts' => (int) env('POS_REAUTH_MAX_ATTEMPTS', 5),

    // Akun awal untuk `php artisan db:seed`. Password kosong = dibuat acak dan ditampilkan sekali.
    'seed' => [
        'admin_username' => env('SEED_ADMIN_USERNAME', 'admin'),
        'admin_password' => env('SEED_ADMIN_PASSWORD'),
        'cashier_username' => env('SEED_CASHIER_USERNAME'),
        'cashier_password' => env('SEED_CASHIER_PASSWORD'),
    ],
];
