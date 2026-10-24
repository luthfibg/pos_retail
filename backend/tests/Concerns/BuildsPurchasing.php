<?php

namespace Tests\Concerns;

use App\Models\User;
use App\Support\LineTotal;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

/** Pembantu test pembelian: data langsung lewat DB agar test fokus pada perilaku yang diuji. */
trait BuildsPurchasing
{
    /** @param array<string, mixed> $overrides */
    protected function product(array $overrides = []): int
    {
        static $n = 0;
        $n++;

        return DB::table('products')->insertGetId($overrides + [
            'store_id' => $this->storeId(),
            'sku' => "BLI-{$n}",
            'barcode' => sprintf('89960000%05d', $n),
            'name' => "Barang Beli {$n}",
            'unit_name' => 'pcs',
            'track_expiry' => 0,
            'sell_price' => '5000.00',
            'status' => 'active',
        ]);
    }

    /** @param array<string, mixed> $overrides */
    protected function supplier(array $overrides = []): int
    {
        static $n = 0;
        $n++;

        return DB::table('suppliers')->insertGetId($overrides + [
            'store_id' => $this->storeId(),
            'code' => "SUP-T{$n}",
            'name' => "Supplier Uji {$n}",
            'default_payment_terms' => 'prepaid',
            'is_active' => 1,
        ]);
    }

    protected function seededAdmin(): User
    {
        return User::where('username', 'admin')->firstOrFail();
    }

    protected function actAsAdmin(): User
    {
        $admin = $this->seededAdmin();
        Sanctum::actingAs($admin, ['*']);

        return $admin;
    }

    /** @return array{approver_username: string, approver_password: string} */
    protected function adminCreds(): array
    {
        return ['approver_username' => 'admin', 'approver_password' => 'sandi-admin-123'];
    }

    /**
     * PR langsung berstatus tertentu. $lines: [productId => [qty, estPrice|null]].
     *
     * @param  array<int, array{0: string, 1: ?string}>  $lines
     */
    protected function pr(int $requestedBy, array $lines, string $status = 'approved'): int
    {
        static $n = 0;
        $n++;

        $total = 0;
        foreach ($lines as [$qty, $price]) {
            $total += LineTotal::cents($qty, $price);
        }

        $id = DB::table('purchase_requisitions')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => sprintf('PR-T-%06d', $n),
            'requested_by' => $requestedBy,
            'est_total' => number_format($total / 100, 2, '.', ''),
            'status' => $status,
        ]);

        foreach ($lines as $productId => [$qty, $price]) {
            DB::table('purchase_requisition_items')->insert([
                'pr_id' => $id, 'product_id' => $productId, 'qty' => $qty, 'est_price' => $price,
            ]);
        }

        return $id;
    }

    /**
     * PO langsung berstatus tertentu. $lines: [productId => [qty, unitPrice]].
     *
     * @param  array<int, array{0: string, 1: string}>  $lines
     */
    protected function po(int $prId, int $supplierId, array $lines, string $status = 'sent', ?int $createdBy = null): int
    {
        static $n = 0;
        $n++;

        $total = 0;
        foreach ($lines as [$qty, $price]) {
            $total += LineTotal::cents($qty, $price);
        }

        $id = DB::table('purchase_orders')->insertGetId([
            'store_id' => $this->storeId(),
            'doc_number' => sprintf('PO-T-%06d', $n),
            'pr_id' => $prId,
            'supplier_id' => $supplierId,
            'payment_terms' => 'prepaid',
            'total' => number_format($total / 100, 2, '.', ''),
            'status' => $status,
            'order_date' => now('Asia/Jakarta')->toDateString(),
            'created_by' => $createdBy ?? $this->seededAdmin()->id,
        ]);

        foreach ($lines as $productId => [$qty, $price]) {
            DB::table('purchase_order_items')->insert([
                'po_id' => $id, 'product_id' => $productId, 'qty_ordered' => $qty, 'unit_price' => $price,
            ]);
        }

        return $id;
    }

    protected function poItemId(int $poId, int $productId): int
    {
        return (int) DB::table('purchase_order_items')->where('po_id', $poId)->where('product_id', $productId)->value('id');
    }

    protected function setSetting(string $key, mixed $value): void
    {
        DB::table('settings')->updateOrInsert(
            ['store_id' => $this->storeId(), 'setting_key' => $key],
            ['setting_value' => json_encode($value)],
        );
    }

    protected function notificationCount(string $type, int $userId): int
    {
        return DB::table('notifications')->where('type', $type)->where('user_id', $userId)->count();
    }

    protected function today(int $plusDays = 0): string
    {
        return now('Asia/Jakarta')->addDays($plusDays)->toDateString();
    }
}
