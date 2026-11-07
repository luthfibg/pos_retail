<?php

namespace App\Exceptions;

use RuntimeException;

class OpnameOverlapException extends RuntimeException
{
    /**
     * @param  list<array{id: int, number: string}>  $conflictingSessions
     */
    public function __construct(public readonly array $conflictingSessions)
    {
        parent::__construct('Cakupan beririsan dengan sesi opname yang masih berjalan.');
    }
}
