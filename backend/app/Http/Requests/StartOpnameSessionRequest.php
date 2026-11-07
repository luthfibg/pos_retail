<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StartOpnameSessionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'scope_type' => ['required', 'in:all,categories'],
            'category_ids' => ['prohibited_if:scope_type,all', 'required_if:scope_type,categories', 'array', 'min:1'],
            'category_ids.*' => ['integer', 'distinct', 'min:1'],
            'name' => ['nullable', 'string', 'max:160'],
            'notes' => ['nullable', 'string', 'max:5000'],
            'client_request_id' => ['required', 'uuid'],
        ];
    }
}
