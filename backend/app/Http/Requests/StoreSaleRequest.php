<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSaleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'uuid'],
            'payment_mode' => ['required', Rule::in(['cash', 'payroll_credit'])],
            'customer_id' => ['nullable', 'integer', 'min:1', 'required_if:payment_mode,payroll_credit'],
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.qty' => ['required', 'numeric', 'gt:0', 'max:99999', 'decimal:0,3'],
            'amount_tendered' => ['required_if:payment_mode,cash', 'nullable', 'numeric', 'min:0', 'max:999999999999', 'decimal:0,2'],
            'credit_exception' => ['nullable', 'array'],
            'credit_exception.approver_username' => ['required_with:credit_exception', 'string', 'max:60'],
            'credit_exception.approver_password' => ['required_with:credit_exception', 'string', 'max:200'],
            'credit_exception.note' => ['required_with:credit_exception', 'string', 'max:255'],
        ];
    }
}
