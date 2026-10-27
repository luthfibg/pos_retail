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
            'reason' => ['required', Rule::in(['opname', 'loss', 'damage', 'expired', 'other'])],
            'note' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.batch_id' => ['nullable', 'integer', 'min:1'],
            'items.*.location_id' => ['required', 'integer', 'min:1'],
            'items.*.shelf_position_id' => ['nullable', 'integer', 'min:1'],
            'items.*.qty_counted' => ['required', 'numeric', 'min:0', 'max:999999999', 'decimal:0,3'],
        ];
    }
}
