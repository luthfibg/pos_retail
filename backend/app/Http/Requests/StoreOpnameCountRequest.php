<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreOpnameCountRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'item_id' => ['required', 'integer', 'min:1'],
            'mode' => ['required', 'in:set,add'],
            'quantity' => ['required', 'integer', 'min:0', 'max:1000000', $this->input('mode') === 'add' ? 'min:1' : 'integer'],
            'client_request_id' => ['required', 'uuid'],
        ];
    }
}
