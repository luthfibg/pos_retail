<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCashMovementRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'type' => ['required', Rule::in(['in', 'out'])],
            'amount' => ['required', 'numeric', 'gt:0', 'max:999999999999', 'decimal:0,2'],
            'reason' => ['required', 'string', 'not_regex:/^\s*$/u', 'max:255'],
        ];
    }
}
