<?php

namespace App\Http\Requests;

use App\Services\StoreContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreProductRequest extends FormRequest
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
            'sku' => ['nullable', 'string', 'max:40', 'regex:/^[A-Za-z0-9._\-]+$/', Rule::unique('products', 'sku')->where('store_id', $storeId)],
            'barcode' => ['nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9\-]+$/', Rule::unique('products', 'barcode')],
            'name' => ['required', 'string', 'max:200'],
            'category_id' => ['nullable', 'integer', Rule::exists('categories', 'id')->where('store_id', $storeId)->where('is_active', 1)],
            'unit_name' => ['nullable', 'string', 'max:20'],
            'track_expiry' => ['nullable', 'boolean'],
            'sell_price' => ['nullable', 'numeric', 'min:0', 'max:999999999999'],
            'min_stock' => ['nullable', 'numeric', 'min:0', 'max:999999999'],
            'critical_stock' => ['nullable', 'numeric', 'min:0', 'max:999999999'],
        ];
    }
}
