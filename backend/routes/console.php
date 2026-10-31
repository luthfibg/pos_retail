<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('platform:operator-create {username} {name}', function (string $username, string $name) {
    $validator = Validator::make(
        ['username' => $username, 'name' => $name],
        [
            'username' => ['required', 'string', 'max:60', 'regex:/^[A-Za-z0-9._-]+$/', 'unique:users,username'],
            'name' => ['required', 'string', 'max:150'],
        ],
    );
    if ($validator->fails()) {
        $this->error($validator->errors()->first());

        return 1;
    }

    $password = $this->secret('Password operator (minimal 12 karakter)');
    $passwordConfirmation = $this->secret('Ulangi password operator');
    $passwordValidator = Validator::make(['password' => $password], ['password' => ['required', 'string', 'min:12', 'max:255']]);
    if ($passwordValidator->fails() || ! hash_equals($password, $passwordConfirmation)) {
        $this->error($passwordValidator->errors()->first('password') ?? 'Konfirmasi password tidak cocok.');

        return 1;
    }

    $userId = DB::transaction(function () use ($username, $name, $password) {
        $id = DB::table('users')->insertGetId([
            'name' => $name,
            'username' => $username,
            'password_hash' => Hash::make($password),
            'is_active' => 1,
        ]);
        DB::table('platform_operators')->insert(['user_id' => $id, 'is_active' => 1]);
        DB::table('audit_logs')->insert([
            'actor_id' => null,
            'action' => 'platform.operator_create',
            'entity_type' => 'platform_operator',
            'entity_id' => $id,
            'after_json' => json_encode(['username' => $username], JSON_UNESCAPED_UNICODE),
        ]);

        return $id;
    });

    $this->info("Operator platform '{$username}' berhasil dibuat (user id {$userId}).");

    return 0;
})->purpose('Buat akun operator platform terpisah dari RBAC toko');
