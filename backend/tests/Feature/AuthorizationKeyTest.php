<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\AuthorizationKeyService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsPurchasing;
use Tests\SeededTestCase;

class AuthorizationKeyTest extends SeededTestCase
{
    use BuildsPurchasing;

    private const PASSWORD = 'rahasia-12345';

    /** Admin seed dinonaktifkan agar pemegang izin persetujuan hanya akun uji. */
    private function onlyTestAdmin(): User
    {
        DB::table('users')->where('username', 'admin')->update(['is_active' => 0]);

        return $this->signIn('Admin');
    }

    private function setKey(string $type, ?string $key, bool $generate = false)
    {
        return $this->putJson('/api/authorization-key', array_filter([
            'current_password' => self::PASSWORD, 'type' => $type, 'key' => $key, 'generate' => $generate ?: null,
        ], fn ($v) => $v !== null));
    }

    private function service(): AuthorizationKeyService
    {
        return app(AuthorizationKeyService::class);
    }

    /** PR yang siap disetujui Owner. */
    private function pendingPr(): int
    {
        $kasir = User::where('username', 'kasir-k')->first() ?? $this->makeUser('Kasir', 'kasir-k');
        $p = $this->product();

        return $this->pr($kasir->id, [$p => ['2', '5000']], 'finance_checked');
    }

    private function approve(int $pr, array $credentials)
    {
        return $this->postJson("/api/purchase-requisitions/{$pr}/approve", ['decision' => 'approve', 'approver_username' => 'admin-uji'] + $credentials);
    }

    private function setMode(string $mode)
    {
        return $this->putJson('/api/settings/approval-auth', ['mode' => $mode, 'current_password' => self::PASSWORD]);
    }

    public function test_only_approvers_hold_keys(): void
    {
        $this->signIn('Kasir');
        $this->getJson('/api/authorization-key')->assertOk()->assertJsonPath('data.eligible', false)->assertJsonPath('data.has_key', false);
        $this->setKey('code', 'AB12CD')->assertForbidden();
        $this->getJson('/api/authorization-keys')->assertForbidden();

        $this->signIn('Admin');
        $this->getJson('/api/authorization-key')->assertOk()->assertJsonPath('data.eligible', true)->assertJsonPath('data.mode', 'password');
        $this->getJson('/api/auth/me')->assertJsonPath('approval_auth_mode', 'password')->assertJsonPath('authorization_key.has_key', false);
    }

    public function test_guest_is_unauthenticated(): void
    {
        $this->getJson('/api/authorization-key')->assertUnauthorized();
        $this->putJson('/api/authorization-key', [])->assertUnauthorized();
        $this->getJson('/api/settings/approval-auth')->assertUnauthorized();
    }

    public function test_code_is_normalized_and_stored_only_as_hash(): void
    {
        $admin = $this->signIn('Admin');

        $this->putJson('/api/authorization-key', ['current_password' => 'salah', 'type' => 'code', 'key' => 'AB12CD'])
            ->assertUnprocessable()->assertJsonValidationErrors(['current_password']);
        $this->assertSame(0, DB::table('authorization_keys')->count());

        $res = $this->setKey('code', 'ab12cd')->assertOk()->assertJsonPath('data.has_key', true)->assertJsonPath('data.type', 'code')
            ->assertJsonMissingPath('data.generated_key');
        $this->assertStringNotContainsString('AB12CD', $res->getContent());
        $this->assertStringNotContainsString('hash', strtolower($res->getContent()));

        $hash = (string) DB::table('authorization_keys')->where('user_id', $admin->id)->value('key_hash');
        $this->assertNotSame('AB12CD', $hash);
        $this->assertTrue(Hash::check('AB12CD', $hash));
        $this->assertTrue($this->service()->verify($admin, 'ab12cd'));
        $this->assertTrue($this->service()->verify($admin, ' AB12CD '));
        $this->assertFalse($this->service()->verify($admin, 'AB12CE'));
    }

    public function test_key_strength_rules(): void
    {
        $this->makeUser('Admin', 'adm-pw', 'XYZ789');
        Sanctum::actingAs(User::where('username', 'adm-pw')->first(), ['*']);
        $put = fn (array $b) => $this->putJson('/api/authorization-key', ['current_password' => 'XYZ789'] + $b);

        $put(['type' => 'code', 'key' => 'ABC12'])->assertUnprocessable()->assertJsonValidationErrors(['key']);      // 5 karakter
        $put(['type' => 'code', 'key' => 'ABC12!'])->assertUnprocessable()->assertJsonValidationErrors(['key']);     // simbol
        $put(['type' => 'code', 'key' => 'AAAAAA'])->assertUnprocessable()->assertJsonValidationErrors(['key']);     // satu karakter berulang
        $put(['type' => 'code', 'key' => 'xyz789'])->assertUnprocessable()->assertJsonValidationErrors(['key']);     // sama dengan password akun
        $put(['type' => 'code'])->assertUnprocessable()->assertJsonValidationErrors(['key']);                        // tanpa kunci dan tanpa generate
        $put(['type' => 'passphrase', 'key' => 'dua kata'])->assertUnprocessable()->assertJsonValidationErrors(['key']);
        $put(['type' => 'passphrase', 'key' => 'kucing hitam'])->assertUnprocessable()->assertJsonValidationErrors(['key']);
        $put(['type' => 'bogus', 'key' => 'ABC123'])->assertUnprocessable()->assertJsonValidationErrors(['type']);
        $put(['type' => 'passphrase', 'generate' => true])->assertUnprocessable()->assertJsonValidationErrors(['generate']);
        $put(['type' => 'code', 'key' => 'ABC123', 'generate' => true])->assertUnprocessable()->assertJsonValidationErrors(['generate']);
        $this->assertSame(0, DB::table('authorization_keys')->count());

        $put(['type' => 'passphrase', 'key' => 'kucing hitam melompat pagi hari'])->assertOk()->assertJsonPath('data.type', 'passphrase');
        $admin = User::where('username', 'adm-pw')->first();
        $this->assertTrue($this->service()->verify($admin, "  kucing   hitam melompat pagi hari "));   // spasi dirapikan
        $this->assertFalse($this->service()->verify($admin, 'Kucing hitam melompat pagi hari'));         // huruf besar/kecil dibedakan
    }

    public function test_generated_code_is_shown_once_and_works(): void
    {
        $admin = $this->signIn('Admin');

        $code = $this->setKey('code', null, true)->assertOk()->json('data.generated_key');
        $this->assertMatchesRegularExpression('/^[A-HJ-NP-Z2-9]{6}$/', $code);
        $this->assertTrue($this->service()->verify($admin, $code));

        $this->getJson('/api/authorization-key')->assertOk()->assertJsonMissingPath('data.generated_key')->assertJsonPath('data.has_key', true);
    }

    public function test_rotate_delete_and_audit_never_contains_the_key(): void
    {
        $admin = $this->signIn('Admin');

        $this->setKey('code', 'AB12CD')->assertOk()->assertJsonPath('data.rotated_at', null);
        $this->setKey('code', 'ZX98YW')->assertOk();
        $this->assertNotNull(DB::table('authorization_keys')->where('user_id', $admin->id)->value('rotated_at'));
        $this->assertFalse($this->service()->verify($admin, 'AB12CD'));
        $this->assertTrue($this->service()->verify($admin, 'ZX98YW'));
        $this->assertSame(1, DB::table('authorization_keys')->count());

        $this->assertSame(2, DB::table('audit_logs')->where('action', 'authorization_key.set')->count());
        foreach (['AB12CD', 'ZX98YW'] as $secret) {
            $this->assertSame(0, DB::table('audit_logs')->whereRaw('CAST(after_json AS CHAR) LIKE ?', ["%{$secret}%"])->count());
        }

        $this->deleteJson('/api/authorization-key', ['current_password' => 'salah'])->assertUnprocessable()->assertJsonValidationErrors(['current_password']);
        $this->deleteJson('/api/authorization-key', ['current_password' => self::PASSWORD])->assertOk()->assertJsonPath('data.has_key', false);
        $this->assertSame(0, DB::table('authorization_keys')->count());
        $this->deleteJson('/api/authorization-key', ['current_password' => self::PASSWORD])->assertUnprocessable()->assertJsonValidationErrors(['key']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'authorization_key.delete', 'actor_id' => $admin->id]);
    }

    public function test_manager_lists_holders_and_revokes_other_keys(): void
    {
        $admin = $this->onlyTestAdmin();
        $other = $this->makeUser('Admin', 'admin-b');
        $this->makeUser('Kasir', 'kasir-x');
        $this->setKey('code', 'AB12CD')->assertOk();
        Sanctum::actingAs($other, ['*']);
        $this->setKey('code', 'QW34ER')->assertOk();

        Sanctum::actingAs($admin, ['*']);
        $holders = $this->getJson('/api/authorization-keys')->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['admin-uji', 'admin-b'], array_column($holders, 'username'));   // Kasir tidak termasuk
        $this->assertSame([true, true], array_column($holders, 'has_key'));

        $this->deleteJson("/api/authorization-keys/{$other->id}", [])->assertUnprocessable()->assertJsonValidationErrors(['reason']);
        $this->deleteJson("/api/authorization-keys/{$admin->id}", ['reason' => 'uji'])->assertUnprocessable()->assertJsonValidationErrors(['user']);
        $this->deleteJson("/api/authorization-keys/{$other->id}", ['reason' => 'kunci dicurigai bocor'])->assertOk();
        $this->assertFalse($this->service()->verify($other, 'QW34ER'));
        $this->deleteJson("/api/authorization-keys/{$other->id}", ['reason' => 'ulang'])->assertUnprocessable()->assertJsonValidationErrors(['user']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'authorization_key.revoke', 'entity_id' => $other->id, 'reason' => 'kunci dicurigai bocor', 'actor_id' => $admin->id]);

        $this->signIn('Kasir', 'kasir-y');
        $this->deleteJson("/api/authorization-keys/{$other->id}", ['reason' => 'uji'])->assertForbidden();
    }

    public function test_mode_switch_requires_every_holder_to_have_a_key_and_protects_the_last_key(): void
    {
        $this->onlyTestAdmin();

        $info = $this->getJson('/api/settings/approval-auth')->assertOk()->assertJsonPath('data.mode', 'password')->json('data');
        $this->assertSame('key_missing', $info['modes'][1]['blockers'][0]['code']);
        $this->assertFalse($info['modes'][1]['can_switch']);
        $this->assertTrue($info['modes'][0]['can_switch']);

        $this->setMode('key')->assertUnprocessable()->assertJsonValidationErrors(['mode']);
        $this->setKey('code', 'AB12CD')->assertOk();
        $this->putJson('/api/settings/approval-auth', ['mode' => 'key', 'current_password' => 'salah'])->assertUnprocessable()->assertJsonValidationErrors(['current_password']);
        $this->setMode('key')->assertOk()->assertJsonPath('data.mode', 'key');
        $this->setMode('key')->assertUnprocessable()->assertJsonValidationErrors(['mode']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'settings.approval_auth']);
        $this->getJson('/api/auth/me')->assertJsonPath('approval_auth_mode', 'key')->assertJsonPath('authorization_key.has_key', true);

        // kunci terakhir tidak boleh dihapus selama mode kunci
        $this->deleteJson('/api/authorization-key', ['current_password' => self::PASSWORD])->assertUnprocessable()->assertJsonValidationErrors(['key']);

        $this->setMode('password')->assertOk();
        $this->deleteJson('/api/authorization-key', ['current_password' => self::PASSWORD])->assertOk();

        $this->signIn('Kasir', 'kasir-z');
        $this->getJson('/api/settings/approval-auth')->assertForbidden();
    }

    public function test_approval_uses_the_credentials_required_by_the_mode(): void
    {
        $this->onlyTestAdmin();
        $this->setKey('code', 'K7M2QX')->assertOk();

        // mode password (default): perilaku lama, kunci diabaikan
        $this->approve($this->pendingPr(), ['approver_password' => self::PASSWORD])->assertOk()->assertJsonPath('data.status', 'approved');

        // mode key: password saja tidak cukup
        $this->setMode('key')->assertOk();
        $pr = $this->pendingPr();
        $this->approve($pr, ['approver_password' => self::PASSWORD])->assertUnprocessable()->assertJsonValidationErrors(['approver_key']);
        $this->approve($pr, ['approver_key' => 'SALAH1'])->assertUnprocessable()->assertJsonValidationErrors(['approver_key']);
        $this->approve($pr, ['approver_key' => 'k7m2qx'])->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertNotNull(DB::table('authorization_keys')->value('last_used_at'));
        $this->assertTrue(DB::table('audit_logs')->where('action', 'auth.reauth_ok')->where('after_json->method', 'key')->exists());

        // mode password_and_key: keduanya wajib
        $this->setMode('password_and_key')->assertOk();
        RateLimiter::clear('reauth:admin-uji');
        $pr = $this->pendingPr();
        $this->approve($pr, ['approver_key' => 'K7M2QX'])->assertUnprocessable()->assertJsonValidationErrors(['approver_password']);
        $this->approve($pr, ['approver_password' => 'salah', 'approver_key' => 'K7M2QX'])->assertUnprocessable()->assertJsonValidationErrors(['approver_key']);
        $this->approve($pr, ['approver_password' => self::PASSWORD, 'approver_key' => 'K7M2QX'])->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertTrue(DB::table('audit_logs')->where('action', 'auth.reauth_ok')->where('after_json->method', 'password_and_key')->exists());
    }

    public function test_approver_without_a_key_is_rejected_in_key_mode_even_with_password(): void
    {
        $this->onlyTestAdmin();
        $this->setKey('code', 'K7M2QX')->assertOk();
        $this->setMode('key')->assertOk();

        $second = $this->makeUser('Admin', 'admin-nokey');          // dibuat sesudah mode aktif: belum punya kunci
        $pr = $this->pendingPr();
        $this->postJson("/api/purchase-requisitions/{$pr}/approve", ['decision' => 'approve', 'approver_username' => $second->username, 'approver_key' => 'K7M2QX'])
            ->assertUnprocessable()->assertJsonValidationErrors(['approver_key']);   // kunci orang lain tidak berlaku
        $this->assertSame('finance_checked', DB::table('purchase_requisitions')->where('id', $pr)->value('status'));
    }

    public function test_repeated_wrong_keys_lock_the_key_until_the_owner_resets_it(): void
    {
        $this->onlyTestAdmin();
        $this->setKey('code', 'K7M2QX')->assertOk();
        $this->setMode('key')->assertOk();
        $pr = $this->pendingPr();

        for ($i = 0; $i < AuthorizationKeyService::MAX_FAILED; $i++) {
            RateLimiter::clear('reauth:admin-uji');   // lewati pembatas laju agar penghitung permanen yang diuji
            $this->approve($pr, ['approver_key' => 'SALAH'.$i])->assertUnprocessable();
        }

        $row = DB::table('authorization_keys')->first();
        $this->assertSame(AuthorizationKeyService::MAX_FAILED, (int) $row->failed_attempts);
        $this->assertNotNull($row->locked_at);
        $this->assertDatabaseHas('audit_logs', ['action' => 'authorization_key.locked']);

        RateLimiter::clear('reauth:admin-uji');
        $this->approve($pr, ['approver_key' => 'K7M2QX'])->assertUnprocessable()->assertJsonValidationErrors(['approver_key']);   // benar pun ditolak saat terkunci
        $this->getJson('/api/authorization-key')->assertJsonPath('data.locked', true);
        $this->getJson('/api/auth/me')->assertJsonPath('authorization_key.locked', true);

        // pemilik menyetel ulang dengan password -> terbuka
        $this->setKey('code', 'N8P5TV')->assertOk()->assertJsonPath('data.locked', false);
        $this->approve($pr, ['approver_key' => 'K7M2QX'])->assertUnprocessable();
        RateLimiter::clear('reauth:admin-uji');
        $this->approve($pr, ['approver_key' => 'N8P5TV'])->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertSame(0, (int) DB::table('authorization_keys')->value('failed_attempts'));
    }

    public function test_rate_limiter_blocks_a_burst_of_attempts_even_with_the_right_key(): void
    {
        $this->onlyTestAdmin();
        $this->setKey('code', 'K7M2QX')->assertOk();
        $this->setMode('key')->assertOk();
        RateLimiter::clear('reauth:admin-uji');
        $pr = $this->pendingPr();

        for ($i = 0; $i < 5; $i++) {
            $this->approve($pr, ['approver_key' => 'SALAH'.$i])->assertUnprocessable();
        }

        $this->approve($pr, ['approver_key' => 'K7M2QX'])->assertUnprocessable()->assertJsonValidationErrors(['approver_key']);
        $this->assertSame('finance_checked', DB::table('purchase_requisitions')->where('id', $pr)->value('status'));
    }
}
