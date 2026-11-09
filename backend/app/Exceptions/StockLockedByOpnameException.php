<?php

namespace App\Exceptions;

use RuntimeException;

class StockLockedByOpnameException extends RuntimeException
{
    /**
     * @param  list<array{product_id: int, name: string, session_number: string}>  $lockedProducts
     */
    public function __construct(public readonly array $lockedProducts)
    {
        parent::__construct('Perubahan stok ditolak karena produk sedang dikunci oleh sesi opname.');
    }
}
