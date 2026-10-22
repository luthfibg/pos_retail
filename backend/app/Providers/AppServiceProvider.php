<?php

namespace App\Providers;

use App\Models\User;
use App\Services\PermissionResolver;
use App\Services\StoreContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(StoreContext::class);
        $this->app->singleton(PermissionResolver::class);
    }

    public function boot(): void
    {
        RateLimiter::for('login', function (Request $request) {
            return Limit::perMinute(5)->by(Str::lower((string) $request->input('username')).'|'.$request->ip());
        });

        // Ability bernama kode permission (mengandung titik), mis. `sales.create`, diputuskan dari RBAC.
        // Ability lain (mis. `update` pada policy model) diteruskan ke policy: return null.
        Gate::before(function (User $user, string $ability) {
            if (! str_contains($ability, '.')) {
                return null;
            }

            return app(PermissionResolver::class)->allows($user, $ability);
        });
    }
}
