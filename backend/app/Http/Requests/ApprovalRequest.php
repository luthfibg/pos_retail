<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Persetujuan Owner (PR) atau konfirmasi Owner (PO). Kredensial diketik pemberi persetujuan sendiri;
 * wajib-tidaknya mengikuti setting approval_reauth_required (dicek di service).
 */
class ApprovalRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'decision' => ['sometimes', Rule::in(['approve', 'reject'])],
            'note' => ['nullable', 'string', 'max:500'],
            'approver_username' => ['nullable', 'string', 'max:60'],
            'approver_password' => ['nullable', 'string', 'max:200'],
        ];
    }
}
