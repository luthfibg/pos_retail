<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:150'],
            'username' => ['required', 'string', 'max:60', 'regex:/^[A-Za-z0-9._\-]+$/', Rule::unique('users', 'username')],
            'email' => ['nullable', 'email', 'max:190', Rule::unique('users', 'email')],
            'password' => ['required', 'string', 'min:8', 'max:255'],
            'role' => ['required', Rule::exists('roles', 'name')],
        ];
    }
}
