<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreStockTransferRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'from_location_id' => ['required', 'integer', 'min:1'],
            'to_location_id' => ['required', 'integer', 'min:1'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.batch_id' => ['nullable', 'integer', 'min:1'],
            'items.*.from_position_id' => ['nullable', 'integer', 'min:1'],
            'items.*.to_position_id' => ['nullable', 'integer', 'min:1'],
            'items.*.qty' => ['required', 'numeric', 'gt:0', 'max:999999999', 'decimal:0,3'],
        ];
    }
}
