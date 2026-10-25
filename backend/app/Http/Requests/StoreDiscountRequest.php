<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDiscountRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'target_type' => ['required', Rule::in(['product', 'category'])],
            'target_id' => ['required', 'integer', 'min:1'],
            'discount_type' => ['required', Rule::in(['percent', 'amount'])],
            'value' => ['required', 'numeric', 'gt:0', 'max:999999999999', 'decimal:0,2'],
            'starts_at' => ['nullable', 'date_format:Y-m-d'],
            'ends_at' => ['nullable', 'date_format:Y-m-d'],
        ];
    }
}
