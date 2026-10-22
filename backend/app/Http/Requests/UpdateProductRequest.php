<?php

namespace App\Http\Requests;

use App\Services\StoreContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $storeId = app(StoreContext::class)->requireIdFor($this->user());

        return [
            // SKU dan barcode tidak dapat diubah (barcode tidak boleh dipakai ulang)
            'sku' => ['prohibited'],
            'barcode' => ['prohibited'],
            'name' => ['sometimes', 'required', 'string', 'max:200'],
            'category_id' => ['sometimes', 'nullable', 'integer', Rule::exists('categories', 'id')->where('store_id', $storeId)->where('is_active', 1)],
            'unit_name' => ['sometimes', 'required', 'string', 'max:20'],
            'track_expiry' => ['sometimes', 'required', 'boolean'],
            'sell_price' => ['sometimes', 'required', 'numeric', 'min:0', 'max:999999999999'],
            'min_stock' => ['sometimes', 'required', 'numeric', 'min:0', 'max:999999999'],
            'critical_stock' => ['sometimes', 'required', 'numeric', 'min:0', 'max:999999999'],
            'status' => ['sometimes', 'required', Rule::in(['active', 'inactive'])],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
