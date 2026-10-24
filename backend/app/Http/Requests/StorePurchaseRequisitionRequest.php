<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePurchaseRequisitionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.qty' => ['required', 'numeric', 'gt:0', 'max:99999', 'decimal:0,3'],
            'items.*.est_price' => ['nullable', 'numeric', 'min:0', 'max:99999999.99', 'decimal:0,2'],
            'items.*.note' => ['nullable', 'string', 'max:255'],
        ];
    }
}
