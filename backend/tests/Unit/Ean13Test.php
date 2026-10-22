<?php

namespace Tests\Unit;

use App\Support\Ean13;
use PHPUnit\Framework\TestCase;

class Ean13Test extends TestCase
{
    public function test_check_digit_matches_known_example(): void
    {
        $this->assertSame(1, Ean13::checkDigit('400638133393'));
        $this->assertSame('4006381333931', Ean13::withCheckDigit('400638133393'));
    }

    public function test_is_valid(): void
    {
        $this->assertTrue(Ean13::isValid('4006381333931'));
        $this->assertFalse(Ean13::isValid('4006381333932'));
        $this->assertFalse(Ean13::isValid('40063813339'));
        $this->assertFalse(Ean13::isValid('abcdefghijklm'));
    }
}
