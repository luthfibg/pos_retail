<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Penomoran berurutan per toko/jenis/periode. WAJIB dipanggil di dalam DB::transaction
 * agar kunci baris (FOR UPDATE) bertahan sampai transaksi selesai.
 */
class NumberSequence
{
    public function next(int $storeId, string $docType, string $periodKey = 'ALL'): int
    {
        $where = ['store_id' => $storeId, 'doc_type' => $docType, 'period_key' => $periodKey];

        $row = DB::table('number_sequences')->where($where)->lockForUpdate()->first();

        if ($row === null) {
            DB::table('number_sequences')->insertOrIgnore($where + ['last_number' => 0]);
            $row = DB::table('number_sequences')->where($where)->lockForUpdate()->first();
        }

        $next = (int) $row->last_number + 1;

        DB::table('number_sequences')->where($where)->update(['last_number' => $next]);

        return $next;
    }
}
