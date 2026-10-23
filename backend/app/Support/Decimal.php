<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * Aritmetika desimal eksak memakai bilangan bulat (satuan terkecil), tanpa float dan tanpa bcmath.
 *  - qty  = skala 3 (DECIMAL(18,3))  -> Decimal::toUnits('12.5', 3) === 12500
 *  - uang = skala 2 (DECIMAL(18,2))
 */
final class Decimal
{
    /** Ubah string/angka desimal nonnegatif menjadi bilangan bulat satuan terkecil. */
    public static function toUnits(string|int|float $value, int $scale): int
    {
        $text = trim((string) $value);

        if (! preg_match('/^(-)?(\d+)(?:\.(\d+))?$/', $text, $m)) {
            throw new InvalidArgumentException("Bukan angka desimal yang valid: '{$text}'.");
        }

        $fraction = $m[3] ?? '';

        if (strlen($fraction) > $scale && trim(substr($fraction, $scale), '0') !== '') {
            throw new InvalidArgumentException("Angka melebihi {$scale} desimal: '{$text}'.");
        }

        $units = (int) ($m[2].str_pad(substr($fraction, 0, $scale), $scale, '0'));

        return $m[1] === '-' ? -$units : $units;
    }

    /** Kebalikan toUnits: 12500, 3 => "12.500". */
    public static function fromUnits(int $units, int $scale): string
    {
        $negative = $units < 0;
        $digits = str_pad((string) abs($units), $scale + 1, '0', STR_PAD_LEFT);

        $text = $scale === 0
            ? $digits
            : substr($digits, 0, -$scale).'.'.substr($digits, -$scale);

        return $negative ? '-'.$text : $text;
    }

    public static function qty(string|int|float $value): int
    {
        return self::toUnits($value, 3);
    }

    public static function qtyString(int $units): string
    {
        return self::fromUnits($units, 3);
    }

    public static function money(string|int|float $value): int
    {
        return self::toUnits($value, 2);
    }

    public static function moneyString(int $units): string
    {
        return self::fromUnits($units, 2);
    }
}
