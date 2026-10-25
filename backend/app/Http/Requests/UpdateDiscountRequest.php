<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateDiscountRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'target_type' => ['prohibited'],
            'target_id' => ['prohibited'],
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'discount_type' => ['sometimes', 'required', Rule::in(['percent', 'amount'])],
            'value' => ['sometimes', 'required', 'numeric', 'gt:0', 'max:999999999999', 'decimal:0,2'],
            'starts_at' => ['sometimes', 'required', 'date_format:Y-m-d'],
            'ends_at' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'is_active' => ['sometimes', 'required', 'boolean'],
        ];
    }
}
