<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** Dipakai untuk membuka dan mengubah periode tagihan. */
class BillingPeriodRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'label' => ['sometimes', 'nullable', 'string', 'max:40'],
            'scheduled_close_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
        ];
    }
}
