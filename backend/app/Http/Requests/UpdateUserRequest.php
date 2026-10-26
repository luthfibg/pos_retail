<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'username' => ['prohibited'],
            'password' => ['prohibited'],
            'name' => ['sometimes', 'required', 'string', 'max:150'],
            'email' => ['sometimes', 'nullable', 'email', 'max:190', Rule::unique('users', 'email')->ignore((int) $this->route('user'))],
            'is_active' => ['sometimes', 'required', 'boolean'],
            'role' => ['sometimes', 'required', Rule::exists('roles', 'name')],
        ];
    }
}
