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
            'quantity' => ['required_without_all:good_quantity,damaged_quantity', 'nullable', 'integer', 'min:0', 'max:1000000', $this->input('mode') === 'add' ? 'min:1' : 'integer'],
            'good_quantity' => ['required_with:damaged_quantity', 'numeric', 'min:0', 'max:1000000', 'decimal:0,3'],
            'damaged_quantity' => ['required_with:good_quantity', 'numeric', 'min:0', 'max:1000000', 'decimal:0,3'],
            'client_request_id' => ['required', 'uuid'],
        ];
    }
}
