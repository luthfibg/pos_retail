<?php

namespace App\Support;

/**
 * Total satu baris dokumen pembelian: qty (skala 3) x harga satuan (skala 2) -> sen, dibulatkan setengah ke atas.
 * Memakai bilangan bulat (tanpa float). Batas input (qty <= 99999, harga <= 99.999.999,99) menjaga hasil < 2^63.
 */
final class LineTotal
{
    public static function cents(string|int|float $qty, string|int|float|null $price): int
    {
        if ($price === null || $price === '') {
            return 0;
        }

        return intdiv(Decimal::qty($qty) * Decimal::money($price) + 500, 1000);
    }

    public static function money(string|int|float $qty, string|int|float|null $price): string
    {
        return Decimal::moneyString(self::cents($qty, $price));
    }
}
