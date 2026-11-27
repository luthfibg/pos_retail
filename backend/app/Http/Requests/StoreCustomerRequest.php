<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCustomerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'customer_no' => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9._\-\/]+$/'],
            'ktp_no' => ['required', 'digits:16'],
            'name' => ['required', 'string', 'max:150'],
            'phone' => ['required', 'string', 'max:30', 'regex:/^[+0-9()\-\s]{6,30}$/'],
            'address' => ['required', 'string', 'max:1000'],
            'domicile' => ['required', 'string', 'max:1000'],
            'company_name' => ['required', 'string', 'max:190'],
            'position' => ['required', 'string', 'max:100'],
            'department' => ['required', 'string', 'max:100'],
            'employment_type' => ['required', Rule::in(['permanent', 'contract'])],
            'employment_start_date' => ['required', 'date_format:Y-m-d'],
            'hrd_name' => ['required', 'string', 'max:150'],
            'hrd_phone' => ['required', 'string', 'max:30', 'regex:/^[+0-9()\-\s]{6,30}$/'],
            'supervisor_name' => ['required', 'string', 'max:150'],
            'supervisor_phone' => ['required', 'string', 'max:30', 'regex:/^[+0-9()\-\s]{6,30}$/'],
        ];
    }
}
