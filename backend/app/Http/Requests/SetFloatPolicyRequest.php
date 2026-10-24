<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SetFloatPolicyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'mode' => ['required', Rule::in(['fixed', 'percent'])],
            'fixed_amount' => ['required_if:mode,fixed', 'nullable', 'numeric', 'min:0', 'max:999999999999', 'decimal:0,2'],
            'percent' => ['required_if:mode,percent', 'nullable', 'numeric', 'min:0', 'max:100', 'decimal:0,2'],
            'percent_base' => ['required_if:mode,percent', 'nullable', Rule::in(['cash_sales_shift', 'cash_on_hand'])],
            'min_amount' => ['nullable', 'numeric', 'min:0', 'max:999999999999', 'decimal:0,2'],
            'max_amount' => ['nullable', 'numeric', 'min:0', 'max:999999999999', 'decimal:0,2'],
            'rounding_unit' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
