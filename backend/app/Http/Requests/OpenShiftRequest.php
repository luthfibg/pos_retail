<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class OpenShiftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'register_id' => ['nullable', 'integer', 'min:1'],
            'added_opening_cash' => ['nullable', 'numeric', 'min:0', 'max:999999999999', 'decimal:0,2'],
        ];
    }
}
