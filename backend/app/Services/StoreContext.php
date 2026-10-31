<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Menentukan toko aktif pengguna. Default: toko pertama yang ditugaskan.
 * Header `X-Store-Id` boleh memilih toko lain, tetapi hanya jika pengguna ditugaskan ke toko itu;
 * jika tidak, hasilnya null (semua permission ditolak).
 */
class StoreContext
{
    /** @var array<int, int|null> */
    private array $memo = [];

    public function idFor(User $user): ?int
    {
        if (array_key_exists($user->id, $this->memo)) {
            return $this->memo[$user->id];
        }

        $ids = DB::table('user_roles')
            ->join('stores', 'stores.id', '=', 'user_roles.store_id')
            ->where('user_id', $user->id)
            ->where('stores.is_active', 1)
            ->distinct()
            ->orderBy('user_roles.store_id')
            ->pluck('user_roles.store_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $requested = request()->header('X-Store-Id');

        if ($ids === []) {
            $id = null;
        } elseif ($requested === null || $requested === '') {
            $id = $ids[0];
        } else {
            $id = in_array((int) $requested, $ids, true) ? (int) $requested : null;
        }

        return $this->memo[$user->id] = $id;
    }

    public function requireIdFor(User $user): int
    {
        $id = $this->idFor($user);

        abort_if($id === null, 403, 'Pengguna belum ditugaskan ke toko ini.');

        return $id;
    }

    public function flush(): void
    {
        $this->memo = [];
    }
}
