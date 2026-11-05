<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class BankAccountService
{
    private const MAX_ACCOUNTS = 5;

    public function __construct(private AuditLogger $audit) {}

    /** @return list<array<string, mixed>> */
    public function listForPurchase(int $storeId): array
    {
        return DB::table('bank_accounts as a')
            ->where('a.store_id', $storeId)
            ->where('a.is_active', true)
            ->orderBy('a.bank_name')->orderBy('a.account_name')
            ->get(['a.id', 'a.bank_name', 'a.account_name', 'a.account_number'])
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'bank_name' => $row->bank_name,
                'account_name' => $row->account_name,
                'account_number_masked' => $this->mask((string) $row->account_number),
                'is_active' => true,
            ])->all();
    }

    /** @return list<array<string, mixed>> */
    public function listForSettings(int $storeId): array
    {
        return DB::table('bank_accounts')
            ->where('store_id', $storeId)
            ->orderBy('bank_name')->orderBy('account_name')
            ->get(['id', 'bank_name', 'account_name', 'account_number', 'is_active'])
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'bank_name' => $row->bank_name,
                'account_name' => $row->account_name,
                'account_number' => $row->account_number,
                'is_active' => (bool) $row->is_active,
            ])->all();
    }

    /** @param array{bank_name: string, account_name: string, account_number: string} $data
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $data) {
            DB::table('stores')->where('id', $storeId)->lockForUpdate()->first(['id']);
            if (DB::table('bank_accounts')->where('store_id', $storeId)->count() >= self::MAX_ACCOUNTS) {
                throw ValidationException::withMessages(['bank_accounts' => ['Toko hanya dapat menyimpan maksimal 5 rekening bank.']]);
            }
            $this->assertUniqueAccountNumber($storeId, $data['account_number']);

            $id = DB::table('bank_accounts')->insertGetId([
                'store_id' => $storeId,
                'bank_name' => trim($data['bank_name']),
                'account_name' => trim($data['account_name']),
                'account_number' => trim($data['account_number']),
                'created_by' => $actor->id,
            ]);
            $this->audit->log(
                'bank_account.create',
                'bank_account',
                $id,
                after: $this->auditShape($data),
                storeId: $storeId,
                actorId: $actor->id,
            );

            return $id;
        });

        return collect($this->listForSettings($storeId))->firstWhere('id', $id);
    }

    /** @param array{bank_name?: string, account_name?: string, account_number?: string, is_active?: bool} $data
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $accountId, array $data): array
    {
        DB::transaction(function () use ($actor, $storeId, $accountId, $data) {
            $account = DB::table('bank_accounts')->where('store_id', $storeId)->where('id', $accountId)
                ->lockForUpdate()->first();
            abort_if($account === null, 404, 'Rekening bank tidak ditemukan.');
            if (isset($data['account_number'])) {
                $this->assertUniqueAccountNumber($storeId, $data['account_number'], $accountId);
            }

            $changes = array_intersect_key($data, array_flip(['bank_name', 'account_name', 'account_number', 'is_active']));
            foreach (['bank_name', 'account_name', 'account_number'] as $field) {
                if (isset($changes[$field])) {
                    $changes[$field] = trim((string) $changes[$field]);
                }
            }
            if ($changes === []) {
                return;
            }

            DB::table('bank_accounts')->where('id', $accountId)->update($changes);
            $after = (array) $account;
            foreach ($changes as $field => $value) {
                $after[$field] = $value;
            }

            $this->audit->log(
                'bank_account.update',
                'bank_account',
                $accountId,
                before: $this->auditShape($account),
                after: $this->auditShape($after),
                storeId: $storeId,
                actorId: $actor->id,
            );
        });

        return collect($this->listForSettings($storeId))->firstWhere('id', $accountId);
    }

    private function assertUniqueAccountNumber(int $storeId, string $number, ?int $exceptId = null): void
    {
        $query = DB::table('bank_accounts')->where('store_id', $storeId)->where('account_number', trim($number));
        if ($exceptId !== null) {
            $query->where('id', '<>', $exceptId);
        }
        if ($query->exists()) {
            throw ValidationException::withMessages(['account_number' => ['Nomor rekening sudah terdaftar di toko ini.']]);
        }
    }

    /** @param array<string, mixed>|object $account
     * @return array{bank_name: mixed, account_name: mixed, account_number_masked: string, is_active: bool}
     */
    private function auditShape(array|object $account): array
    {
        $data = (array) $account;

        return [
            'bank_name' => $data['bank_name'] ?? null,
            'account_name' => $data['account_name'] ?? null,
            'account_number_masked' => $this->mask((string) ($data['account_number'] ?? '')),
            'is_active' => (bool) ($data['is_active'] ?? true),
        ];
    }

    private function mask(string $accountNumber): string
    {
        return strlen($accountNumber) <= 4 ? str_repeat('•', strlen($accountNumber)) : '••••'.substr($accountNumber, -4);
    }
}
