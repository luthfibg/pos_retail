<?php

namespace App\Support;

/**
 * Status stok berbasis aturan (bukan sekadar warna), sesuai brief:
 *  - habis        : stok <= 0
 *  - kritis       : stok di bawah ambang kritis (stok < critical, critical > 0)
 *  - hampir_habis : stok mencapai batas minimum (stok <= min, min > 0)
 *  - aman         : selain itu
 */
final class StockStatus
{
    public const OUT = 'habis';
    public const CRITICAL = 'kritis';
    public const LOW = 'hampir_habis';
    public const OK = 'aman';

    public static function for(string|int|float $stock, string|int|float $min, string|int|float $critical): string
    {
        $stock = (float) $stock;
        $min = (float) $min;
        $critical = (float) $critical;

        if ($stock <= 0) {
            return self::OUT;
        }

        if ($critical > 0 && $stock < $critical) {
            return self::CRITICAL;
        }

        if ($min > 0 && $stock <= $min) {
            return self::LOW;
        }

        return self::OK;
    }
}
