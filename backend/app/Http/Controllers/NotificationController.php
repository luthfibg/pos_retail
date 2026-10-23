<?php

namespace App\Http\Controllers;

use App\Services\NotificationService;
use App\Services\StoreContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Notifikasi milik pengguna yang sedang login (tanpa permission khusus: hanya data sendiri). */
class NotificationController extends Controller
{
    public function __construct(private NotificationService $notifications, private StoreContext $stores)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'unread' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $user = $request->user();

        return response()->json($this->notifications->listFor(
            $user,
            $this->stores->requireIdFor($user),
            $request->boolean('unread'),
            (int) ($filters['per_page'] ?? 20),
        ));
    }

    public function read(Request $request, int $notification): JsonResponse
    {
        $user = $request->user();

        abort_unless($this->notifications->markRead($user, $this->stores->requireIdFor($user), $notification), 404, 'Notifikasi tidak ditemukan.');

        return response()->json(['data' => ['id' => $notification, 'read' => true]]);
    }

    public function readAll(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => ['marked' => $this->notifications->markAllRead($user, $this->stores->requireIdFor($user))]]);
    }
}
