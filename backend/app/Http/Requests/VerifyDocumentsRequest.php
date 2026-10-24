<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class VerifyDocumentsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'delivery_note_no' => ['nullable', 'string', 'max:60'],
            'invoice_no' => ['nullable', 'string', 'max:60'],
        ];
    }
}
