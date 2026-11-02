<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class UpdateStoreNameRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:150'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $extraKeys = array_diff(array_keys($this->all()), ['name']);
            foreach ($extraKeys as $key) {
                $validator->errors()->add($key, 'Field ini tidak dapat diubah melalui endpoint nama toko.');
            }
        });
    }
}
