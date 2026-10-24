<?php

namespace App\Services\Concerns;

use App\Support\DocumentNumber;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Pembantu bersama service pembelian (PR, PO, penerimaan).
 * Memakai properti $this->sequences (NumberSequence) milik kelas pemakai.
 */
trait PurchasingSupport
{
    /** Membaca nilai setting toko (JSON); $default bila belum ada. */
    protected function setting(int $storeId, string $key, mixed $default = null): mixed
    {
        $raw = DB::table('settings')->where('store_id', $storeId)->where('setting_key', $key)->value('setting_value');

        return $raw === null ? $default : json_decode((string) $raw, true);
    }

    protected function nowUtc(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }

    protected function todayWib(): string
    {
        return Carbon::now('Asia/Jakarta')->toDateString();
    }

    /** Nomor dokumen PREFIX-YYYYMM-NNNNNN (periode WIB). WAJIB di dalam DB::transaction. */
    protected function nextDocNumber(int $storeId, string $prefix): string
    {
        $period = Carbon::now('Asia/Jakarta')->format('Ym');

        return DocumentNumber::format($prefix, $this->sequences->next($storeId, $prefix, $period), $period);
    }

    /** Notifikasi untuk satu pengguna (penerima spesifik, mis. pembuat dokumen). */
    protected function notifyUser(int $storeId, int $userId, string $type, string $message, string $entityType, int $entityId): void
    {
        DB::table('notifications')->insert([
            'store_id' => $storeId,
            'user_id' => $userId,
            'type' => $type,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'message' => mb_substr($message, 0, 500),
        ]);
    }
}
