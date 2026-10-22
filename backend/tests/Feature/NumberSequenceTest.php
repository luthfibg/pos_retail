<?php

namespace Tests\Feature;

use App\Services\NumberSequence;
use Illuminate\Support\Facades\DB;
use Tests\SeededTestCase;

class NumberSequenceTest extends SeededTestCase
{
    public function test_sequences_increment_per_type_and_period(): void
    {
        $sequence = app(NumberSequence::class);
        $storeId = $this->storeId();

        DB::transaction(function () use ($sequence, $storeId) {
            $this->assertSame(1, $sequence->next($storeId, 'SKU'));
            $this->assertSame(2, $sequence->next($storeId, 'SKU'));
            $this->assertSame(1, $sequence->next($storeId, 'BARCODE'));
            $this->assertSame(1, $sequence->next($storeId, 'PR', '202610'));
            $this->assertSame(1, $sequence->next($storeId, 'PR', '202611'));
            $this->assertSame(2, $sequence->next($storeId, 'PR', '202610'));
        });
    }
}
