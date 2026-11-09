<?php

namespace App\Exceptions;

use RuntimeException;

class OpnameWorkflowException extends RuntimeException
{
    /**
     * @param  array<string, mixed>  $details
     */
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $httpStatus = 409,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}
