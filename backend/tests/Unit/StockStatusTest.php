<?php

namespace Tests\Unit;

use App\Support\StockStatus;
use PHPUnit\Framework\TestCase;

class StockStatusTest extends TestCase
{
    public function test_zero_or_negative_stock_is_out(): void
    {
        $this->assertSame('habis', StockStatus::for(0, 10, 3));
        $this->assertSame('habis', StockStatus::for('0.000', '10.000', '3.000'));
        $this->assertSame('habis', StockStatus::for(-1, 10, 3));
    }

    public function test_below_critical_is_critical(): void
    {
        $this->assertSame('kritis', StockStatus::for(2, 10, 3));
        $this->assertSame('kritis', StockStatus::for('2.500', '10.000', '3.000'));
    }

    public function test_reaching_minimum_is_low(): void
    {
        $this->assertSame('hampir_habis', StockStatus::for(3, 10, 3));   // sama dengan kritis => belum kritis
        $this->assertSame('hampir_habis', StockStatus::for(10, 10, 3));  // mencapai minimum
    }

    public function test_above_minimum_is_safe(): void
    {
        $this->assertSame('aman', StockStatus::for(11, 10, 3));
    }

    public function test_zero_thresholds_mean_no_warning_levels(): void
    {
        $this->assertSame('aman', StockStatus::for(1, 0, 0));
        $this->assertSame('habis', StockStatus::for(0, 0, 0));
    }
}
