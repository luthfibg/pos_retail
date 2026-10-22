<?php

namespace App\Support;

/** Utilitas EAN-13 untuk barcode internal toko (rentang 20-29 = pemakaian internal). */
final class Ean13
{
    public static function checkDigit(string $body12): int
    {
        $sum = 0;

        for ($i = 0; $i < 12; $i++) {
            $sum += ((int) $body12[$i]) * ($i % 2 === 0 ? 1 : 3);
        }

        return (10 - ($sum % 10)) % 10;
    }

    public static function withCheckDigit(string $body12): string
    {
        return $body12.self::checkDigit($body12);
    }

    public static function isValid(string $code): bool
    {
        return preg_match('/^\d{13}$/', $code) === 1
            && self::checkDigit(substr($code, 0, 12)) === (int) $code[12];
    }
}
