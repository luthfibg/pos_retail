<?php

namespace App\Services;

use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Pengaturan PPN (R-04, tarif dan status "harga sudah termasuk PPN" menunggu klien). Default nonaktif.
 *  - saklar: settings.vat_enabled
 *  - tarif berversi di tax_rates (baris baru per perubahan, berlaku mulai hari ini WIB); SaleService dan BillingService
 *    memakai baris terbaru yang berlaku
 */
class VatSettingService
{
    public function __construct(private AuditLogger $audit)
    {
    }

    /** @return array<string, mixed> */
    public function get(int $storeId): array
    {
        $enabled = DB::table('settings')->where('store_id', $storeId)->where('setting_key', 'vat_enabled')->value('setting_value');
        $rate = $this->currentRate($storeId);

        return [
            'enabled' => $enabled !== null && json_decode((string) $enabled, true) === true,
            'rate' => $rate?->rate,
            'price_includes_tax' => $rate === null || $rate->price_includes_tax === null ? null : (bool) $rate->price_includes_tax,
            'effective_from' => $rate?->effective_from,
        ];
    }

    /**
     * @param  array<string, mixed>  $data  enabled; rate dan price_includes_tax wajib bila enabled
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, array $data): array
    {
        $enabled = (bool) $data['enabled'];

        if ($enabled && (! isset($data['rate']) || ! array_key_exists('price_includes_tax', $data) || $data['price_includes_tax'] === null)) {
            throw ValidationException::withMessages(['rate' => ['Tarif dan status harga termasuk PPN wajib diisi saat PPN diaktifkan.']]);
        }

        DB::transaction(function () use ($actor, $storeId, $data, $enabled) {
            $before = $this->get($storeId);

            DB::table('settings')->upsert(
                [['store_id' => $storeId, 'setting_key' => 'vat_enabled', 'setting_value' => json_encode($enabled), 'updated_by' => $actor->id]],
                ['store_id', 'setting_key'], ['setting_value', 'updated_by'],
            );

            if ($enabled) {
                $cur = $this->currentRate($storeId);
                $same = $cur !== null && (float) $cur->rate === (float) $data['rate'] && $cur->price_includes_tax !== null
                    && (bool) $cur->price_includes_tax === (bool) $data['price_includes_tax'];

                if (! $same) {
                    DB::table('tax_rates')->insert([
                        'store_id' => $storeId,
                        'name' => 'PPN',
                        'rate' => $data['rate'],
                        'price_includes_tax' => $data['price_includes_tax'] ? 1 : 0,
                        'effective_from' => Carbon::now('Asia/Jakarta')->toDateString(),
                        'created_by' => $actor->id,
                    ]);
                }
            }

            $after = $this->get($storeId);
            if ($before !== $after) {
                $this->audit->log('settings.vat', 'setting', null, before: $before, after: $after, storeId: $storeId, actorId: $actor->id);
            }
        });

        return $this->get($storeId);
    }

    private function currentRate(int $storeId): ?object
    {
        return DB::table('tax_rates')->where('store_id', $storeId)
            ->where('effective_from', '<=', Carbon::now('Asia/Jakarta')->toDateString())
            ->orderByDesc('effective_from')->orderByDesc('id')->first();
    }
}
