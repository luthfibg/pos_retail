<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreGoodsReceiptRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'po_id' => ['required', 'integer', 'min:1'],
            'delivery_note_no' => ['nullable', 'string', 'max:60'],
            'invoice_no' => ['nullable', 'string', 'max:60'],
            'note' => ['nullable', 'string', 'max:500'],
            'post' => ['sometimes', 'boolean'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.po_item_id' => ['required', 'integer', 'min:1'],
            'items.*.qty_received' => ['required', 'numeric', 'min:0', 'max:99999', 'decimal:0,3'],
            'items.*.qty_damaged' => ['nullable', 'numeric', 'min:0', 'max:99999', 'decimal:0,3'],
            'items.*.unit_cost' => ['nullable', 'numeric', 'min:0', 'max:99999999.99', 'decimal:0,2'],
            'items.*.expiry_date' => ['nullable', 'date_format:Y-m-d'],
            'items.*.batch_code' => ['nullable', 'string', 'max:60'],
            'items.*.shelf_position_id' => ['nullable', 'integer', 'min:1'],
            'items.*.note' => ['nullable', 'string', 'max:255'],
        ];
    }
}
