<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class AnnualReceivableReportSettingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'print_on' => [
                'required',
                'regex:/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (is_string($value) && preg_match('/^(\d{2})-(\d{2})$/', $value, $matches)
                        && ! checkdate((int) $matches[1], (int) $matches[2], 2000)) {
                        $fail('Tanggal tidak valid.');
                    }
                },
            ],
        ];
    }
}
