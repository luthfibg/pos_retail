<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

class PlatformAccess
{
    public function isOperator(User $user): bool
    {
        return DB::table('platform_operators')
            ->where('user_id', $user->id)
            ->where('is_active', 1)
            ->exists();
    }
}
