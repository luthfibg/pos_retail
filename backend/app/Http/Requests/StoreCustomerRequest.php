<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreCustomerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'customer_no' => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9._\-\/]+$/'],
            'name' => ['required', 'string', 'max:150'],
            'department' => ['nullable', 'string', 'max:100'],
        ];
    }
}
