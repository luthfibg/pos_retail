<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class NotificationTest extends SeededTestCase
{
    private function notify(int $userId, string $message, ?string $readAt = null): int
    {
        return DB::table('notifications')->insertGetId([
            'store_id' => $this->storeId(), 'user_id' => $userId, 'type' => 'customer.limit_needed',
            'entity_type' => 'customer', 'entity_id' => 1, 'message' => $message, 'read_at' => $readAt,
        ]);
    }

    public function test_lists_only_own_notifications_with_unread_count(): void
    {
        $me = $this->signIn('Admin', 'admin-n');
        $other = $this->makeUser('Kasir', 'kasir-n');

        $this->notify($me->id, 'untuk saya 1');
        $this->notify($me->id, 'untuk saya 2 (sudah dibaca)', now()->toDateTimeString());
        $this->notify($other->id, 'bukan untuk saya');

        $this->getJson('/api/notifications')->assertOk()
            ->assertJsonPath('total', 2)->assertJsonPath('unread_count', 1);

        $this->getJson('/api/notifications?unread=1')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.message', 'untuk saya 1');
    }

    public function test_mark_one_read_and_cannot_touch_someone_elses(): void
    {
        $me = $this->signIn('Admin', 'admin-m');
        $other = $this->makeUser('Kasir', 'kasir-m');
        $mine = $this->notify($me->id, 'milik saya');
        $theirs = $this->notify($other->id, 'milik orang lain');

        $this->postJson("/api/notifications/{$mine}/read")->assertOk();
        $this->assertNotNull(DB::table('notifications')->where('id', $mine)->value('read_at'));

        $this->postJson("/api/notifications/{$theirs}/read")->assertNotFound();
        $this->assertNull(DB::table('notifications')->where('id', $theirs)->value('read_at'));
    }

    public function test_mark_all_read_affects_only_own(): void
    {
        $me = $this->signIn('Admin', 'admin-r');
        $other = $this->makeUser('Kasir', 'kasir-r');
        $this->notify($me->id, 'a');
        $this->notify($me->id, 'b');
        $this->notify($other->id, 'c');

        $this->postJson('/api/notifications/read-all')->assertOk()->assertJsonPath('data.marked', 2);

        $this->assertSame(0, DB::table('notifications')->where('user_id', $me->id)->whereNull('read_at')->count());
        $this->assertSame(1, DB::table('notifications')->where('user_id', $other->id)->whereNull('read_at')->count());
    }

    public function test_requires_login(): void
    {
        $this->getJson('/api/notifications')->assertUnauthorized();
    }
}
