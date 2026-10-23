<?php

namespace Tests\Unit;

use App\Support\Decimal;
use App\Support\DocumentNumber;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class DecimalTest extends TestCase
{
    public function test_converts_to_and_from_units(): void
    {
        $this->assertSame(12500, Decimal::qty('12.5'));
        $this->assertSame(12500, Decimal::qty('12.500'));
        $this->assertSame(12500, Decimal::qty('12.5000'));
        $this->assertSame(10000, Decimal::qty(10));
        $this->assertSame(500, Decimal::qty('0.5'));
        $this->assertSame(1, Decimal::qty('0.001'));
        $this->assertSame('12.500', Decimal::qtyString(12500));
        $this->assertSame('0.001', Decimal::qtyString(1));
        $this->assertSame('0.000', Decimal::qtyString(0));
        $this->assertSame('-1.250', Decimal::qtyString(-1250));
        $this->assertSame('3500.00', Decimal::moneyString(Decimal::money('3500')));
        $this->assertSame(350050, Decimal::money('3500.5'));
    }

    public function test_rejects_excess_precision_and_garbage(): void
    {
        $this->expectException(InvalidArgumentException::class);
        Decimal::qty('1.0005');
    }

    public function test_rejects_non_numeric(): void
    {
        $this->expectException(InvalidArgumentException::class);
        Decimal::qty('abc');
    }

    public function test_document_number(): void
    {
        $this->assertSame('OPEN-000007', DocumentNumber::format('OPEN', 7));
        $this->assertSame('SALE-202610-000123', DocumentNumber::format('SALE', 123, '202610'));
    }
}
