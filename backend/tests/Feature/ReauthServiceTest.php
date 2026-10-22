<?php

namespace Tests\Feature;

use App\Services\ReauthService;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Concerns\CreatesUsers;
use Tests\TestCase;

class ReauthServiceTest extends TestCase
{
    use CreatesUsers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(DatabaseSeeder::class);
    }

    public function test_authorized_approver_with_correct_password_is_confirmed(): void
    {
        $owner = $this->makeUser('Admin', 'owner', 'sandi-owner-1');
        $cashier = $this->makeUser('Kasir', 'sari');

        $approver = app(ReauthService::class)->confirm('owner', 'sandi-owner-1', 'purchase_requisition.approve', $cashier);

        $this->assertSame($owner->id, $approver->id);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'auth.reauth_ok',
            'entity_id' => $owner->id,
            'actor_id' => $cashier->id,
            'is_self_approval' => 0,
        ]);
    }

    public function test_self_confirmation_is_flagged_in_audit_log(): void
    {
        $owner = $this->makeUser('Admin', 'owner', 'sandi-owner-1');

        app(ReauthService::class)->confirm('owner', 'sandi-owner-1', 'purchase_requisition.approve', $owner);

        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.reauth_ok', 'is_self_approval' => 1]);
    }

    public function test_wrong_password_is_rejected_and_logged(): void
    {
        $this->makeUser('Admin', 'owner', 'sandi-owner-1');

        try {
            app(ReauthService::class)->confirm('owner', 'salah', 'purchase_requisition.approve');
            $this->fail('Seharusnya menolak password yang salah.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('approver_password', $e->errors());
        }

        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.reauth_failed']);
    }

    public function test_user_without_the_permission_is_rejected_even_with_correct_password(): void
    {
        $this->makeUser('Kasir', 'sari', 'sandi-kasir-1');

        $this->expectException(ValidationException::class);

        app(ReauthService::class)->confirm('sari', 'sandi-kasir-1', 'purchase_requisition.approve');
    }

    public function test_inactive_approver_is_rejected(): void
    {
        $this->makeUser('Admin', 'owner', 'sandi-owner-1', active: false);

        $this->expectException(ValidationException::class);

        app(ReauthService::class)->confirm('owner', 'sandi-owner-1', 'purchase_requisition.approve');
    }

    public function test_repeated_failures_lock_the_approver_even_for_the_correct_password(): void
    {
        $this->makeUser('Admin', 'owner', 'sandi-owner-1');
        $service = app(ReauthService::class);

        for ($i = 0; $i < 5; $i++) {
            try {
                $service->confirm('owner', 'salah', 'purchase_requisition.approve');
            } catch (ValidationException) {
                // diharapkan
            }
        }

        try {
            $service->confirm('owner', 'sandi-owner-1', 'purchase_requisition.approve');
            $this->fail('Seharusnya terkunci setelah 5 kegagalan.');
        } catch (ValidationException $e) {
            $this->assertStringContainsString('Terlalu banyak', $e->errors()['approver_password'][0]);
        }

        $this->assertSame(5, DB::table('audit_logs')->where('action', 'auth.reauth_failed')->count());
    }
}
