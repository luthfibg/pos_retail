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
            'period_month' => [
                'sometimes',
                'required',
                'date_format:Y-m-d',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (substr((string) $value, 8, 2) !== '01') {
                        $fail('Bulan periode harus berupa tanggal pertama pada bulan tersebut.');
                    }
                },
            ],
            'scheduled_close_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
        ];
    }
}
