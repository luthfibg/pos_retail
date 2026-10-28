<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PreviewSaleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'payment_mode' => ['required', Rule::in(['cash', 'payroll_credit'])],
            'customer_id' => ['nullable', 'integer', 'min:1', 'required_if:payment_mode,payroll_credit'],
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.qty' => ['required', 'numeric', 'gt:0', 'max:99999', 'decimal:0,3'],
        ];
    }
}
