<?php

namespace App\Support;

/**
 * Pembentuk nomor dokumen dari urutan NumberSequence::next().
 *   format('OPEN', 7)                  => OPEN-000007
 *   format('SALE', 123, '202610')      => SALE-202610-000123
 */
final class DocumentNumber
{
    public static function format(string $prefix, int $number, ?string $period = null): string
    {
        $sequence = str_pad((string) $number, 6, '0', STR_PAD_LEFT);

        return $period === null ? "{$prefix}-{$sequence}" : "{$prefix}-{$period}-{$sequence}";
    }
}
