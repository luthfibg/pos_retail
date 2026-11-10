<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreOpnameCountBatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'operations' => ['required', 'array', 'min:1', 'max:100'],
            'operations.*' => ['required', 'array'],
            'operations.*.client_request_id' => ['required', 'uuid'],
            'operations.*.action' => ['nullable', 'string', 'max:16'],
            'operations.*.item_id' => ['nullable'],
            'operations.*.mode' => ['nullable', 'string', 'max:16'],
            'operations.*.quantity' => ['nullable'],
            'operations.*.client_created_at' => ['nullable', 'string', 'max:64'],
        ];
    }
}
