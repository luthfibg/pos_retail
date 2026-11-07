<?php

use App\Models\User;
use App\Services\PlatformCliLoginTicket;
use App\Support\Decimal;
use Carbon\Carbon;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Symfony\Component\Process\Process;

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

Artisan::command('platform:operator-login {--no-browser : Siapkan tiket tanpa membuka browser (untuk otomasi/test)}', function () {
    $username = $this->ask('Username operator');
    $password = $this->secret('Password operator', false);

    $user = DB::table('users')
        ->join('platform_operators', 'platform_operators.user_id', '=', 'users.id')
        ->where('users.username', $username)
        ->where('users.is_active', 1)
        ->where('platform_operators.is_active', 1)
        ->select('users.id', 'users.username', 'users.password_hash')
        ->first();

    if ($user === null || ! Hash::check($password, $user->password_hash)) {
        $this->error('Username atau password operator tidak valid.');

        return 1;
    }

    $uiUrl = rtrim((string) config('pos.platform_ui_url'), '/');
    $parsedUrl = parse_url($uiUrl);
    if (
        ! is_array($parsedUrl)
        || ! in_array($parsedUrl['scheme'] ?? null, ['http', 'https'], true)
        || empty($parsedUrl['host'])
        || isset($parsedUrl['user'])
        || isset($parsedUrl['pass'])
        || isset($parsedUrl['query'])
        || isset($parsedUrl['fragment'])
    ) {
        $this->error('PLATFORM_UI_URL harus berupa URL HTTP/HTTPS origin atau base path yang valid.');

        return 1;
    }

    $expiresAt = now()->addMinutes(5);
    DB::table('platform_cli_login_tickets')->where('expires_at', '<=', now())->delete();
    $ticket = app(PlatformCliLoginTicket::class)->issue((int) $user->id, $expiresAt->timestamp);
    $ticketFingerprint = substr(hash('sha256', $ticket), 0, 12);
    Log::info('Platform CLI login ticket issued.', [
        'user_id' => (int) $user->id,
        'ticket_fingerprint' => $ticketFingerprint,
        'expires_at' => $expiresAt->toDateTimeString(),
        'ui_host' => $parsedUrl['host'],
        'database_connection' => DB::connection()->getName(),
        'database_host' => DB::connection()->getConfig('host'),
        'database_port' => DB::connection()->getConfig('port'),
        'database' => DB::connection()->getDatabaseName(),
    ]);

    $loginUrl = $uiUrl.'/platform/cli-login#ticket='.rawurlencode($ticket).'&fingerprint='.$ticketFingerprint;
    if ($this->option('no-browser')) {
        $this->info('Tiket login terenkripsi telah disiapkan (berlaku 5 menit); mode --no-browser aktif.');

        return 0;
    }

    $browserCommand = match (PHP_OS_FAMILY) {
        'Windows' => ['explorer.exe', $loginUrl],
        'Darwin' => ['open', $loginUrl],
        default => ['xdg-open', $loginUrl],
    };
    $process = new Process($browserCommand);
    $process->run();
    if (! $process->isSuccessful()) {
        $this->error('Browser gagal dibuka. Pastikan PLATFORM_UI_URL benar dan jalankan ulang command.');

        return 1;
    }

    $this->info('Login berhasil. Browser dibuka menuju daftar tenant.');

    return 0;
})->purpose('Login operator dan buka UI daftar tenant');

Artisan::command('opname:simulate-counts {sessionId} {--percent=30} {--variance=10} {--reset}', function () {
    if (! app()->environment(['local', 'testing'])) {
        $this->error('Perintah simulasi opname hanya boleh dijalankan pada environment local atau testing.');

        return 1;
    }

    $sessionId = (int) $this->argument('sessionId');
    $session = DB::table('stock_opname_sessions')->where('id', $sessionId)->first(['id', 'created_by']);
    if ($session === null) {
        $this->error("Sesi opname {$sessionId} tidak ditemukan.");

        return 1;
    }

    if ($this->option('reset')) {
        DB::table('stock_opname_items')->where('session_id', $sessionId)->update([
            'counted_qty' => null,
            'system_qty_at_count' => null,
            'counted_at' => null,
            'counted_by' => null,
        ]);
        $this->info("Data hitungan sesi {$sessionId} dikosongkan.");

        return 0;
    }

    $percent = filter_var($this->option('percent'), FILTER_VALIDATE_INT);
    $variancePercent = filter_var($this->option('variance'), FILTER_VALIDATE_INT);
    if ($percent === false || $percent < 0 || $percent > 100 || $variancePercent === false || $variancePercent < 0 || $variancePercent > 100) {
        $this->error('Nilai --percent dan --variance harus berupa bilangan bulat antara 0 dan 100.');

        return 1;
    }

    $items = DB::table('stock_opname_items')->where('session_id', $sessionId)->orderBy('id')->get([
        'id', 'system_qty_at_start',
    ]);
    $countTotal = (int) round($items->count() * $percent / 100);
    $varianceTotal = (int) round($countTotal * $variancePercent / 100);
    $counted = $items->take($countTotal)->values();
    $now = Carbon::now('UTC')->format('Y-m-d H:i:s.v');

    DB::transaction(function () use ($sessionId, $session, $counted, $varianceTotal, $now) {
        $processed = 0;
        foreach ($counted->chunk(400) as $chunk) {
            $countedCases = [];
            $systemCases = [];
            $ids = [];
            $bindings = [];
            foreach ($chunk as $index => $item) {
                $id = (int) $item->id;
                $systemQty = (string) $item->system_qty_at_start;
                $countedQty = $systemQty;
                if ($processed + $index < $varianceTotal) {
                    $countedQty = Decimal::qtyString(Decimal::qty($systemQty) + 1000);
                }
                $ids[] = $id;
                $countedCases[] = 'WHEN ? THEN ?';
                $systemCases[] = 'WHEN ? THEN ?';
                $bindings[] = $id;
                $bindings[] = $countedQty;
                $bindings[] = $id;
                $bindings[] = $systemQty;
            }
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $sql = 'UPDATE stock_opname_items SET counted_qty = CASE id '.implode(' ', $countedCases).' ELSE counted_qty END, '
                .'system_qty_at_count = CASE id '.implode(' ', $systemCases).' ELSE system_qty_at_count END, '
                .'counted_at = ?, counted_by = ?, updated_at = ? WHERE session_id = ? AND id IN ('.$placeholders.')';
            $bindings[] = $now;
            $bindings[] = (int) $session->created_by;
            $bindings[] = $now;
            $bindings[] = $sessionId;
            array_push($bindings, ...$ids);
            DB::update($sql, $bindings);
            $processed += count($ids);
        }
    });

    $this->info("Ditandai {$counted->count()} produk dihitung, termasuk {$varianceTotal} produk dengan selisih.");

    return 0;
})->purpose('Mengisi progres hitungan simulasi untuk sesi opname lokal/test');
