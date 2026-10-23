<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SetCreditLimitRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'limit_amount' => ['required', 'numeric', 'min:0', 'max:999999999999', 'decimal:0,2'],
            'note' => ['nullable', 'string', 'max:255'],
        ];
    }
}
