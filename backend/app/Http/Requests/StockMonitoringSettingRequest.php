<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StockMonitoringSettingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'low_stock_threshold' => [
                'required',
                'numeric',
                'min:0',
                'max:99999',
                'regex:/^\d+(?:\.\d{1,3})?$/',
            ],
        ];
    }
}
