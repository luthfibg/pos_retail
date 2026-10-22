<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateSupplierRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'code' => ['prohibited'],
            'name' => ['sometimes', 'required', 'string', 'max:150'],
            'contact_name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:40'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'default_payment_terms' => ['sometimes', 'required', Rule::in(['prepaid', 'credit', 'cod'])],
            'is_active' => ['sometimes', 'required', 'boolean'],
        ];
    }
}
