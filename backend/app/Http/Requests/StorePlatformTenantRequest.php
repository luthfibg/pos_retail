<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePlatformTenantRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:20', 'regex:/^[A-Za-z0-9._-]+$/', Rule::unique('stores', 'code')],
            'name' => ['required', 'string', 'max:150'],
            'timezone' => ['sometimes', 'required', 'timezone'],
            'currency' => ['sometimes', 'required', 'string', 'size:3', 'alpha'],
            'owner.name' => ['required', 'string', 'max:150'],
            'owner.username' => ['required', 'string', 'max:60', 'regex:/^[A-Za-z0-9._-]+$/', Rule::unique('users', 'username')],
            'owner.email' => ['nullable', 'email', 'max:190', Rule::unique('users', 'email')],
            'owner.password' => ['required', 'string', 'min:12', 'max:255'],
        ];
    }
}
