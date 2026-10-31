<?php

use App\Models\User;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

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

    $password = $this->secret('Password operator (minimal 12 karakter)', false);
    $passwordConfirmation = $this->secret('Ulangi password operator', false);
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

Artisan::command('platform:operator-credentials-reset', function () {
    $operators = DB::table('platform_operators as po')
        ->join('users as u', 'u.id', '=', 'po.user_id')
        ->where('po.is_active', 1)
        ->where('u.is_active', 1)
        ->orderBy('u.id')
        ->get(['u.id', 'u.name', 'u.username']);

    if ($operators->isEmpty()) {
        $this->error('Tidak ada operator platform aktif yang dapat dipulihkan.');

        return 1;
    }

    $this->table(['ID', 'Nama', 'Username saat ini'], $operators->map(fn ($operator) => [
        $operator->id,
        $operator->name,
        $operator->username,
    ])->all());

    $userId = $this->ask('Masukkan ID operator yang akan dipulihkan');
    $operator = $operators->firstWhere('id', filter_var($userId, FILTER_VALIDATE_INT));
    if ($operator === null) {
        $this->error('ID tidak cocok dengan operator platform aktif.');

        return 1;
    }

    $username = $this->ask('Username baru');
    $usernameValidator = Validator::make(
        ['username' => $username],
        [
            'username' => [
                'required',
                'string',
                'max:60',
                'regex:/^[A-Za-z0-9._-]+$/',
                Rule::unique('users', 'username')->ignore($operator->id),
            ],
        ],
    );
    if ($usernameValidator->fails()) {
        $this->error($usernameValidator->errors()->first('username'));

        return 1;
    }

    $password = $this->secret('Password operator baru (minimal 12 karakter)', false);
    $passwordConfirmation = $this->secret('Ulangi password operator baru', false);
    $passwordValidator = Validator::make(['password' => $password], [
        'password' => ['required', 'string', 'min:12', 'max:255'],
    ]);
    if ($passwordValidator->fails() || ! hash_equals($password, $passwordConfirmation)) {
        $this->error($passwordValidator->errors()->first('password') ?? 'Konfirmasi password tidak cocok.');

        return 1;
    }

    DB::transaction(function () use ($operator, $username, $password) {
        $current = DB::table('users')->where('id', $operator->id)->lockForUpdate()->first();
        $isActiveOperator = DB::table('platform_operators')
            ->where('user_id', $operator->id)
            ->where('is_active', 1)
            ->exists();
        if ($current === null || ! $current->is_active || ! $isActiveOperator) {
            throw new LogicException('Operator tidak lagi aktif; kredensial tidak diubah.');
        }

        DB::table('users')->where('id', $operator->id)->update([
            'username' => $username,
            'password_hash' => Hash::make($password),
            'updated_at' => now(),
        ]);
        DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $operator->id)
            ->delete();
        DB::table('audit_logs')->insert([
            'actor_id' => null,
            'action' => 'platform.operator_credentials_reset',
            'entity_type' => 'platform_operator',
            'entity_id' => $operator->id,
            'before_json' => json_encode(['username' => $operator->username], JSON_UNESCAPED_UNICODE),
            'after_json' => json_encode(['username' => $username], JSON_UNESCAPED_UNICODE),
        ]);
    });

    $this->info("Kredensial operator ID {$operator->id} berhasil diperbarui. Semua token lama telah dicabut.");

    return 0;
})->purpose('Pulihkan username dan password operator platform secara interaktif');
