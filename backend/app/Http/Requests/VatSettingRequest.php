<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class VatSettingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'enabled' => ['required', 'boolean'],
            'rate' => ['nullable', 'numeric', 'min:0', 'max:100', 'decimal:0,2'],
            'price_includes_tax' => ['nullable', 'boolean'],
        ];
    }
}
