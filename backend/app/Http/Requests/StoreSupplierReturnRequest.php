<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSupplierReturnRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'return_type' => ['sometimes', Rule::in(['incoming', 'outgoing'])],
            'supplier_id' => ['required', 'integer', 'min:1'],
            'goods_receipt_id' => ['required_if:return_type,incoming', 'nullable', 'integer', 'min:1'],
            'invoice_no' => ['nullable', 'string', 'max:60'],
            'note' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.goods_receipt_item_id' => ['required_if:return_type,incoming', 'integer', 'min:1'],
            'items.*.disposition' => ['required_if:return_type,incoming', Rule::in(['direct_return', 'quarantine'])],
            'items.*.product_id' => ['required_unless:return_type,incoming', 'integer', 'min:1'],
            'items.*.batch_id' => ['nullable', 'integer', 'min:1'],
            'items.*.location_id' => ['sometimes', 'required_with:items.*.batch_id', 'integer', 'min:1'],
            'items.*.shelf_position_id' => ['nullable', 'integer', 'min:1'],
            'items.*.source_bucket' => ['sometimes', Rule::in(['sellable', 'damaged'])],
            'items.*.qty' => ['required_unless:return_type,incoming', 'numeric', 'gt:0', 'max:99999.999', 'decimal:0,3'],
        ];
    }
}
