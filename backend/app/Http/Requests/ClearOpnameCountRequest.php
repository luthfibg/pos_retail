<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ClearOpnameCountRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return ['client_request_id' => ['required', 'uuid']];
    }
}
