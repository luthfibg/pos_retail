<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StockAuthorityRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            // Daftar {key, roles}: kunci aturan memuat titik sehingga tidak dipakai sebagai kunci objek JSON.
            'rules' => ['required', 'array', 'min:1', 'max:20'],
            'rules.*.key' => ['required', 'string', 'max:60'],
            // roles: daftar nama role, atau null untuk mengembalikan ke default model administrasi
            'rules.*.roles' => ['present', 'nullable', 'array', 'max:10'],
            'rules.*.roles.*' => ['string', 'max:60'],
        ];
    }
}
