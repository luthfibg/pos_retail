<?php

namespace App\Http\Requests;

use App\Services\StoreContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCategoryRequest extends FormRequest
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
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'parent_id' => ['sometimes', 'nullable', 'integer', Rule::exists('categories', 'id')->where('store_id', $storeId)],
            'is_active' => ['sometimes', 'required', 'boolean'],
        ];
    }
}
