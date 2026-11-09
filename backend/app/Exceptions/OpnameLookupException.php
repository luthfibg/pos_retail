<?php

namespace App\Exceptions;

use RuntimeException;

class OpnameLookupException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?string $productName = null,
    ) {
        parent::__construct($message);
    }
}
