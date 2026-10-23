<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreOpeningBalanceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'note' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.qty' => ['required', 'numeric', 'gt:0', 'max:999999999', 'decimal:0,3'],
            'items.*.unit_cost' => ['nullable', 'numeric', 'min:0', 'max:999999999999', 'decimal:0,4'],
            'items.*.expiry_date' => ['nullable', 'date_format:Y-m-d'],
            'items.*.batch_code' => ['nullable', 'string', 'max:60'],
            'items.*.shelf_position_id' => ['nullable', 'integer', 'min:1'],
        ];
    }
}
