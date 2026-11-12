<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreStockAdjustmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'product_id' => ['required', 'integer', 'min:1'],
            'type' => ['required_without:target_quantity', 'nullable', Rule::in(['increase', 'decrease'])],
            'quantity' => ['required_without:target_quantity', 'nullable', 'integer', 'min:1', 'max:999999999'],
            'target_quantity' => ['required_without:quantity', 'numeric', 'decimal:0,3', 'min:0', 'max:999999999'],
            'reason_code' => ['required', Rule::in([
                'damaged', 'expired', 'lost', 'found', 'input_correction', 'own_use', 'sample', 'other',
            ])],
            'notes' => ['nullable', 'required_if:reason_code,other', 'string', 'max:500'],
            'expiry_date' => ['nullable', 'date'],
            'client_request_id' => ['required', 'uuid'],
        ];
    }
}
