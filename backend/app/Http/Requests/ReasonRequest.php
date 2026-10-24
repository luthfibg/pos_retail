<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** Pembatalan/penutupan dokumen dengan alasan wajib. */
class ReasonRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'min:3', 'max:500'],
        ];
    }
}
