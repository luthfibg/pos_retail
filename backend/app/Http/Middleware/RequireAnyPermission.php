<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Lolos bila pengguna memegang SALAH SATU permission yang disebut: `->middleware('can.any:a,b')`.
 * Dipakai untuk endpoint baca yang dilayani lebih dari satu role (mis. Finance meninjau shift milik Kasir).
 * Pembatasan data per pengguna tetap dilakukan di service; middleware ini hanya pintu masuk.
 */
class RequireAnyPermission
{
    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $user = $request->user();

        abort_if($user === null, 401, 'Unauthenticated.');

        foreach ($permissions as $permission) {
            if ($user->can($permission)) {
                return $next($request);
            }
        }

        abort(403, 'This action is unauthorized.');
    }
}
