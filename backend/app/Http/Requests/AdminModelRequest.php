<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AdminModelRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'model' => ['required', Rule::in(['simple', 'standard'])],
            // Peralihan mengubah role pengguna (Admin <-> Owner): wajib konfirmasi eksplisit.
            'confirm' => ['required', 'accepted'],
        ];
    }
}
