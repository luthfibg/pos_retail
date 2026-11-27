<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCustomerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'customer_no' => ['sometimes', 'required', 'string', 'max:40', 'regex:/^[A-Za-z0-9._\-\/]+$/'],
            'ktp_no' => ['sometimes', 'required', 'digits:16'],
            'name' => ['sometimes', 'required', 'string', 'max:150'],
            'phone' => ['sometimes', 'required', 'string', 'max:30', 'regex:/^[+0-9()\-\s]{6,30}$/'],
            'address' => ['sometimes', 'required', 'string', 'max:1000'],
            'domicile' => ['sometimes', 'required', 'string', 'max:1000'],
            'company_name' => ['sometimes', 'required', 'string', 'max:190'],
            'position' => ['sometimes', 'required', 'string', 'max:100'],
            'department' => ['sometimes', 'required', 'string', 'max:100'],
            'employment_type' => ['sometimes', 'required', Rule::in(['permanent', 'contract'])],
            'employment_start_date' => ['sometimes', 'required', 'date_format:Y-m-d'],
            'hrd_name' => ['sometimes', 'required', 'string', 'max:150'],
            'hrd_phone' => ['sometimes', 'required', 'string', 'max:30', 'regex:/^[+0-9()\-\s]{6,30}$/'],
            'supervisor_name' => ['sometimes', 'required', 'string', 'max:150'],
            'supervisor_phone' => ['sometimes', 'required', 'string', 'max:30', 'regex:/^[+0-9()\-\s]{6,30}$/'],
        ];
    }
}
