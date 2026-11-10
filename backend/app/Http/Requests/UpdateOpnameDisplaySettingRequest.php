<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateOpnameDisplaySettingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'show_system_qty' => ['sometimes', 'boolean'],
            'per_product_threshold' => ['sometimes', 'integer', 'min:1'],
            'per_session_threshold' => ['sometimes', 'integer', 'min:1'],
            'require_first_opname' => ['sometimes', 'boolean'],
            'reminder_enabled' => ['sometimes', 'boolean'],
            'reminder_interval_days' => ['sometimes', 'integer', 'min:1', 'max:365'],
            'reminder_basis' => ['sometimes', 'in:all,any'],
        ];
    }
}
