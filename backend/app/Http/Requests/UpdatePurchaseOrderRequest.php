<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdatePurchaseOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'pr_id' => ['prohibited'],
            'supplier_id' => ['sometimes', 'required', 'integer', 'min:1'],
            'payment_terms' => ['sometimes', 'required', Rule::in(['prepaid', 'credit', 'cod'])],
            'order_date' => ['sometimes', 'required', 'date_format:Y-m-d'],
            'expected_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'items' => ['sometimes', 'required', 'array', 'min:1', 'max:100'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.qty_ordered' => ['required', 'numeric', 'gt:0', 'max:99999', 'decimal:0,3'],
            'items.*.unit_price' => ['required', 'numeric', 'min:0', 'max:99999999.99', 'decimal:0,2'],
        ];
    }
}
