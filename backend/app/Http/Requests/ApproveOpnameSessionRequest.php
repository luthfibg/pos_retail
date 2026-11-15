<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ApproveOpnameSessionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'client_request_id' => ['required', 'uuid'],
            'owner_password' => ['required', 'string', 'max:200'],
            'reconciliations' => ['required', 'array'],
            'reconciliations.*.item_id' => ['required', 'integer', 'min:1', 'distinct'],
            'reconciliations.*.action' => ['required', 'in:write_off,correction'],
        ];
    }
}
