<?php

namespace App\Services;

use App\Models\User;
use App\Services\Concerns\PurchasingSupport;
use App\Support\Decimal;
use App\Support\LineTotal;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Purchase Order (PO). Alur (dokumen kebutuhan 6.2), Paket 1 tanpa reservasi Saldo Pembelian:
 *   draft -> pending_confirmation -> approved -> sent -> partially_received -> received
 *   draft..sent -> cancelled (belum ada penerimaan); sent/partially_received -> received lewat close (alasan wajib)
 *
 * Aturan:
 *  - PO WAJIB dari PR berstatus approved; satu PR boleh dipecah ke beberapa PO (per supplier)
 *  - [ASUMSI Q-13] qty per produk, kumulatif di semua PO aktif dari PR yang sama, tidak boleh melebihi qty PR
 *  - [ASUMSI Q-13] submit: otomatis approved bila total PO aktif kumulatif <= total estimasi PR (dan estimasi > 0);
 *    selain itu menunggu konfirmasi Owner (re-auth)
 *  - status penerimaan (receipt_status) dan pembayaran (payment_status) terpisah dari status dokumen;
 *    payment_status = unpaid sampai Paket 2
 *  - Kasir (hanya goods_receipt.create) melihat PO yang bisa diterima tanpa harga
 */
class PurchaseOrderService
{
    use PurchasingSupport;

    public const RECEIVABLE = ['approved', 'sent', 'partially_received'];

    public function __construct(
        private AuditLogger $audit,
        private NumberSequence $sequences,
        private PermissionResolver $permissions,
        private ReauthService $reauth,
        private NotificationService $notifications,
        private PurchaseRequisitionService $requisitions,
    ) {
    }

    // ------------------------------------------------------------------ baca

    /** @param array<string, mixed> $filters status?, receipt_status?, supplier_id?, pr_id?, receivable?, q? */
    public function search(User $user, int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $this->assertCanView($user, $storeId);

        $query = DB::table('purchase_orders as po')
            ->join('suppliers as s', 's.id', '=', 'po.supplier_id')
            ->join('purchase_requisitions as pr', 'pr.id', '=', 'po.pr_id')
            ->where('po.store_id', $storeId)
            ->select('po.*', 's.name as supplier_name', 'pr.doc_number as pr_doc_number');

        $manager = $this->permissions->allows($user, 'purchase_order.create', $storeId);

        if (! $manager || ! empty($filters['receivable'])) {
            $query->whereIn('po.status', self::RECEIVABLE);
        }

        foreach (['status', 'receipt_status'] as $column) {
            if (! empty($filters[$column])) {
                $query->where("po.{$column}", $filters[$column]);
            }
        }

        foreach (['supplier_id', 'pr_id'] as $column) {
            if (! empty($filters[$column])) {
                $query->where("po.{$column}", (int) $filters[$column]);
            }
        }

        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where('po.doc_number', 'like', "{$term}%");
        }

        $prices = $this->seesPrices($user, $storeId);

        return $query->orderByDesc('po.id')->paginate($perPage)->through(fn ($row) => [
            'id' => (int) $row->id,
            'doc_number' => $row->doc_number,
            'status' => $row->status,
            'receipt_status' => $row->receipt_status,
            'payment_status' => $row->payment_status,
            'payment_terms' => $row->payment_terms,
            'pr_id' => (int) $row->pr_id,
            'pr_doc_number' => $row->pr_doc_number,
            'supplier_id' => (int) $row->supplier_id,
            'supplier_name' => $row->supplier_name,
            'order_date' => $row->order_date,
            'expected_date' => $row->expected_date,
            'total' => $prices ? $row->total : null,
            'created_at' => $row->created_at,
        ]);
    }

    /** @return array<string, mixed>|null */
    public function find(User $user, int $storeId, int $id): ?array
    {
        $this->assertCanView($user, $storeId);

        $detail = $this->load($storeId, $id, $this->seesPrices($user, $storeId));

        if ($detail === null) {
            return null;
        }

        // Kasir hanya melihat PO yang dapat menerima barang
        if (! $this->permissions->allows($user, 'purchase_order.create', $storeId)
            && ! in_array($detail['status'], self::RECEIVABLE, true)) {
            return null;
        }

        return $detail;
    }

    // ------------------------------------------------------------------ tulis

    /**
     * @param  array<string, mixed>  $data  pr_id, supplier_id, payment_terms?, order_date?, expected_date?, items[] (product_id, qty_ordered, unit_price)
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $data) {
            $pr = DB::table('purchase_requisitions')
                ->where('store_id', $storeId)->where('id', (int) $data['pr_id'])->lockForUpdate()->first();

            if ($pr === null || $pr->status !== 'approved') {
                throw ValidationException::withMessages([
                    'pr_id' => ['PO hanya dapat dibuat dari PR berstatus Disetujui yang masih memiliki sisa item.'],
                ]);
            }

            $supplier = DB::table('suppliers')->where('store_id', $storeId)->where('id', (int) $data['supplier_id'])->first();

            if ($supplier === null || ! $supplier->is_active) {
                throw ValidationException::withMessages(['supplier_id' => ['Supplier tidak ditemukan atau nonaktif.']]);
            }

            $items = $this->normalizeItems($pr, $data['items'], null);
            [$orderDate, $expectedDate] = $this->dates($data);
            $total = $this->sumTotal($items);

            $id = DB::table('purchase_orders')->insertGetId([
                'store_id' => $storeId,
                'doc_number' => $this->nextDocNumber($storeId, 'PO'),
                'pr_id' => $pr->id,
                'supplier_id' => $supplier->id,
                'payment_terms' => $data['payment_terms'] ?? $supplier->default_payment_terms,
                'total' => Decimal::moneyString($total),
                'status' => 'draft',
                'order_date' => $orderDate,
                'expected_date' => $expectedDate,
                'created_by' => $actor->id,
            ]);

            $this->insertItems($id, $items);
            $this->syncConversion((int) $pr->id, $actor, $storeId);

            $this->audit->log(
                'purchase_order.create',
                'purchase_order',
                $id,
                after: ['pr_id' => (int) $pr->id, 'supplier_id' => (int) $supplier->id, 'items' => count($items), 'total' => Decimal::moneyString($total)],
                actorId: $actor->id,
                storeId: $storeId,
            );

            return $id;
        });

        return $this->load($storeId, $id, true) ?? [];
    }

    /**
     * Mengubah PO draft. `items` (bila dikirim) menggantikan seluruh item.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $id, array $data): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $po = $this->lock($storeId, $id);
            $this->assertStatus($po, ['draft'], 'PO hanya dapat diubah saat masih draft.');

            $pr = DB::table('purchase_requisitions')->where('id', $po->pr_id)->lockForUpdate()->first();
            $changes = [];

            if (isset($data['supplier_id'])) {
                $supplier = DB::table('suppliers')->where('store_id', $storeId)->where('id', (int) $data['supplier_id'])->first();

                if ($supplier === null || ! $supplier->is_active) {
                    throw ValidationException::withMessages(['supplier_id' => ['Supplier tidak ditemukan atau nonaktif.']]);
                }
                $changes['supplier_id'] = (int) $supplier->id;
            }

            if (isset($data['payment_terms'])) {
                $changes['payment_terms'] = $data['payment_terms'];
            }

            if (array_key_exists('order_date', $data) || array_key_exists('expected_date', $data)) {
                [$orderDate, $expectedDate] = $this->dates([
                    'order_date' => $data['order_date'] ?? $po->order_date,
                    'expected_date' => array_key_exists('expected_date', $data) ? $data['expected_date'] : $po->expected_date,
                ]);
                $changes['order_date'] = $orderDate;
                $changes['expected_date'] = $expectedDate;
            }

            if (isset($data['items'])) {
                $items = $this->normalizeItems($pr, $data['items'], $id);

                DB::table('purchase_order_items')->where('po_id', $id)->delete();
                $this->insertItems($id, $items);
                $changes['total'] = Decimal::moneyString($this->sumTotal($items));
            }

            if ($changes !== []) {
                DB::table('purchase_orders')->where('id', $id)->update($changes);

                $this->audit->log(
                    'purchase_order.update',
                    'purchase_order',
                    $id,
                    before: ['total' => $po->total],
                    after: $changes,
                    actorId: $actor->id,
                    storeId: $storeId,
                );
            }

            $this->syncConversion((int) $po->pr_id, $actor, $storeId);
        });

        return $this->load($storeId, $id, true) ?? [];
    }

    /**
     * Draft -> menunggu konfirmasi; otomatis disetujui bila total tidak melebihi total PR (lihat kelas).
     *
     * @return array<string, mixed>
     */
    public function submit(User $actor, int $storeId, int $id): array
    {
        $result = DB::transaction(function () use ($actor, $storeId, $id) {
            $po = $this->lock($storeId, $id);
            $this->assertStatus($po, ['draft'], 'Hanya PO draft yang dapat diajukan.');

            if (! DB::table('purchase_order_items')->where('po_id', $id)->exists()) {
                throw ValidationException::withMessages(['items' => ['PO minimal berisi satu item.']]);
            }

            $pr = DB::table('purchase_requisitions')->where('id', $po->pr_id)->lockForUpdate()->first();

            $cumulative = Decimal::money((string) DB::table('purchase_orders')
                ->where('pr_id', $po->pr_id)->where('status', '<>', 'cancelled')
                ->selectRaw('COALESCE(SUM(total), 0) as t')->value('t'));
            $ceiling = Decimal::money($pr->est_total);

            $auto = $ceiling > 0 && $cumulative <= $ceiling;
            $newStatus = $auto ? 'approved' : 'pending_confirmation';

            DB::table('purchase_orders')->where('id', $id)->update(['status' => $newStatus]);

            $this->audit->log(
                'purchase_order.submit',
                'purchase_order',
                $id,
                before: ['status' => 'draft'],
                after: ['status' => $newStatus],
                actorId: $actor->id,
                storeId: $storeId,
            );

            if ($auto) {
                $this->audit->log(
                    'purchase_order.approve',
                    'purchase_order',
                    $id,
                    before: ['status' => 'pending_confirmation'],
                    after: ['status' => 'approved'],
                    reason: 'Otomatis: total PO tidak melebihi total PR yang disetujui.',
                    actorId: $actor->id,
                    storeId: $storeId,
                );
            }

            return [$po, $auto];
        });

        [$po, $auto] = $result;

        if (! $auto) {
            $this->notifications->notifyPermission(
                $storeId,
                'purchase_requisition.approve',
                'po.needs_confirmation',
                "PO {$po->doc_number} melebihi total PR atau PR tanpa estimasi; menunggu konfirmasi Owner.",
                'purchase_order',
                $id,
                $actor->id,
            );
        }

        return $this->load($storeId, $id, true) ?? [];
    }

    /**
     * Konfirmasi Owner untuk PO yang melebihi total PR. Re-auth wajib selama approval_reauth_required aktif.
     *
     * @param  array<string, mixed>  $data  approver_username?, approver_password?, note?
     * @return array<string, mixed>
     */
    public function confirm(User $actor, int $storeId, int $id, array $data): array
    {
        $reauth = (bool) $this->setting($storeId, 'approval_reauth_required', true);

        if ($reauth) {
            if (empty($data['approver_username']) || empty($data['approver_password'])) {
                throw ValidationException::withMessages([
                    'approver_password' => ['Autentikasi ulang pemberi persetujuan diperlukan.'],
                ]);
            }

            $approver = $this->reauth->confirm(
                (string) $data['approver_username'],
                (string) $data['approver_password'],
                'purchase_requisition.approve',
                $actor,
            );
        } else {
            abort_unless($this->permissions->allows($actor, 'purchase_requisition.approve', $storeId), 403, 'Anda tidak berwenang mengonfirmasi PO.');
            $approver = $actor;
        }

        $po = DB::transaction(function () use ($actor, $approver, $storeId, $id, $data) {
            $po = $this->lock($storeId, $id);
            $this->assertStatus($po, ['pending_confirmation'], 'PO tidak sedang menunggu konfirmasi.');

            DB::table('purchase_orders')->where('id', $id)->update(['status' => 'approved']);

            $this->audit->log(
                'purchase_order.confirm',
                'purchase_order',
                $id,
                before: ['status' => 'pending_confirmation'],
                after: ['status' => 'approved', 'session_user_id' => $actor->id],
                reason: $data['note'] ?? null,
                selfApproval: (int) $po->created_by === $approver->id,
                actorId: $approver->id,
                storeId: $storeId,
            );

            return $po;
        });

        if ((int) $po->created_by !== $approver->id) {
            $this->notifyUser($storeId, (int) $po->created_by, 'po.confirmed', "PO {$po->doc_number} dikonfirmasi Owner.", 'purchase_order', $id);
        }

        return $this->load($storeId, $id, true) ?? [];
    }

    /** @return array<string, mixed> */
    public function send(User $actor, int $storeId, int $id): array
    {
        DB::transaction(function () use ($actor, $storeId, $id) {
            $po = $this->lock($storeId, $id);
            $this->assertStatus($po, ['approved'], 'Hanya PO yang sudah disetujui yang dapat dikirim ke supplier.');

            DB::table('purchase_orders')->where('id', $id)->update(['status' => 'sent']);

            $this->audit->log(
                'purchase_order.send',
                'purchase_order',
                $id,
                before: ['status' => 'approved'],
                after: ['status' => 'sent'],
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id, true) ?? [];
    }

    /** @return array<string, mixed> */
    public function cancel(User $actor, int $storeId, int $id, string $reason): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            $po = $this->lock($storeId, $id);
            $this->assertStatus($po, ['draft', 'pending_confirmation', 'approved', 'sent'], 'PO ini tidak dapat dibatalkan. Gunakan "tutup" bila sudah ada penerimaan.');
            $this->assertNoOpenReceipts($id);

            if (DB::table('goods_receipts')->where('po_id', $id)->where('status', 'posted')->exists()) {
                throw ValidationException::withMessages(['status' => ['PO sudah memiliki penerimaan terposting; gunakan "tutup".']]);
            }

            DB::table('purchase_orders')->where('id', $id)->update(['status' => 'cancelled']);
            $this->syncConversion((int) $po->pr_id, $actor, $storeId);

            $this->audit->log(
                'purchase_order.cancel',
                'purchase_order',
                $id,
                before: ['status' => $po->status],
                after: ['status' => 'cancelled'],
                reason: $reason,
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id, true) ?? [];
    }

    /**
     * Menutup PO manual (Selesai Diterima) walau qty belum penuh; alasan wajib. Hanya setelah ada penerimaan.
     *
     * @return array<string, mixed>
     */
    public function close(User $actor, int $storeId, int $id, string $reason): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            $po = $this->lock($storeId, $id);
            $this->assertStatus($po, ['sent', 'partially_received'], 'Hanya PO yang sudah dikirim/sebagian diterima yang dapat ditutup.');
            $this->assertNoOpenReceipts($id);

            $items = DB::table('purchase_order_items')->where('po_id', $id)->get();
            $any = false;
            $complete = true;

            foreach ($items as $item) {
                $received = Decimal::qty($item->qty_received);
                $any = $any || $received > 0;
                $complete = $complete && $received >= Decimal::qty($item->qty_ordered);
            }

            if (! $any) {
                throw ValidationException::withMessages(['status' => ['Belum ada penerimaan; gunakan pembatalan PO.']]);
            }

            DB::table('purchase_orders')->where('id', $id)->update([
                'status' => 'received',
                'receipt_status' => $complete ? 'complete' : 'partial',
            ]);

            $this->audit->log(
                'purchase_order.close',
                'purchase_order',
                $id,
                before: ['status' => $po->status],
                after: ['status' => 'received', 'receipt_status' => $complete ? 'complete' : 'partial'],
                reason: $reason,
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id, true) ?? [];
    }

    // ------------------------------------------------------------------ internal

    private function assertCanView(User $user, int $storeId): void
    {
        abort_unless(
            $this->permissions->allows($user, 'purchase_order.create', $storeId)
                || $this->permissions->allows($user, 'goods_receipt.create', $storeId),
            403,
            'Anda tidak berwenang melihat PO.',
        );
    }

    private function seesPrices(User $user, int $storeId): bool
    {
        return $this->permissions->allows($user, 'purchase_order.create', $storeId)
            || $this->permissions->allows($user, 'goods_receipt.verify_documents', $storeId);
    }

    private function lock(int $storeId, int $id): object
    {
        $po = DB::table('purchase_orders')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();

        abort_if($po === null, 404, 'PO tidak ditemukan.');

        return $po;
    }

    /** @param list<string> $allowed */
    private function assertStatus(object $po, array $allowed, string $message): void
    {
        if (! in_array($po->status, $allowed, true)) {
            throw ValidationException::withMessages(['status' => [$message]]);
        }
    }

    private function assertNoOpenReceipts(int $poId): void
    {
        if (DB::table('goods_receipts')->where('po_id', $poId)->whereIn('status', ['draft', 'checked'])->exists()) {
            throw ValidationException::withMessages(['status' => ['Masih ada penerimaan draft untuk PO ini; batalkan atau posting dulu.']]);
        }
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{0: string, 1: ?string}
     */
    private function dates(array $data): array
    {
        $orderDate = $data['order_date'] ?? $this->todayWib();
        $expected = $data['expected_date'] ?? null;

        if ($expected !== null && $expected < $orderDate) {
            throw ValidationException::withMessages(['expected_date' => ['Tanggal perkiraan tiba tidak boleh sebelum tanggal pesan.']]);
        }

        return [$orderDate, $expected];
    }

    /**
     * Validasi item PO terhadap PR: produk harus ada di PR, tidak ganda, qty kumulatif tidak melebihi qty PR.
     *
     * @param  list<array<string, mixed>>  $items
     * @return list<array<string, mixed>>
     */
    private function normalizeItems(object $pr, array $items, ?int $exceptPoId): array
    {
        $prItems = DB::table('purchase_requisition_items')->where('pr_id', $pr->id)->get()->keyBy('product_id');
        $ordered = $this->requisitions->orderedByProduct((int) $pr->id, $exceptPoId);

        $errors = [];
        $seen = [];
        $rows = [];

        foreach (array_values($items) as $i => $item) {
            $productId = (int) $item['product_id'];

            if (! $prItems->has($productId)) {
                $errors["items.{$i}.product_id"] = ['Produk ini tidak ada di PR.'];
                continue;
            }

            if (isset($seen[$productId])) {
                $errors["items.{$i}.product_id"] = ['Produk sudah ada di daftar PO ini; gabungkan jumlahnya.'];
                continue;
            }
            $seen[$productId] = true;

            $qty = Decimal::qty($item['qty_ordered']);
            $remaining = Decimal::qty($prItems->get($productId)->qty) - ($ordered[$productId] ?? 0);

            if ($qty > $remaining) {
                $errors["items.{$i}.qty_ordered"] = ['Melebihi sisa qty PR (sisa '.Decimal::qtyString(max(0, $remaining)).').'];
                continue;
            }

            $rows[] = [
                'product_id' => $productId,
                'qty_ordered' => Decimal::qtyString($qty),
                'unit_price' => Decimal::moneyString(Decimal::money($item['unit_price'])),
            ];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $rows;
    }

    /** @param list<array<string, mixed>> $items */
    private function sumTotal(array $items): int
    {
        $total = 0;
        foreach ($items as $item) {
            $total += LineTotal::cents($item['qty_ordered'], $item['unit_price']);
        }

        return $total;
    }

    /** @param list<array<string, mixed>> $items */
    private function insertItems(int $poId, array $items): void
    {
        foreach ($items as $item) {
            DB::table('purchase_order_items')->insert([
                'po_id' => $poId,
                'product_id' => $item['product_id'],
                'qty_ordered' => $item['qty_ordered'],
                'unit_price' => $item['unit_price'],
            ]);
        }
    }

    /**
     * PR menjadi `converted` bila seluruh itemnya sudah tercakup PO aktif; kembali `approved` bila PO dibatalkan/diubah.
     * Baris PR dikunci di sini (aman dipanggil ulang dalam transaksi yang sama).
     */
    private function syncConversion(int $prId, User $actor, int $storeId): void
    {
        $pr = DB::table('purchase_requisitions')->where('id', $prId)->lockForUpdate()->first();

        if ($pr === null || ! in_array($pr->status, ['approved', 'converted'], true)) {
            return;
        }

        $ordered = $this->requisitions->orderedByProduct($prId);
        $covered = true;

        foreach (DB::table('purchase_requisition_items')->where('pr_id', $prId)->get() as $item) {
            if (($ordered[(int) $item->product_id] ?? 0) < Decimal::qty($item->qty)) {
                $covered = false;
            }
        }

        $new = $covered ? 'converted' : 'approved';

        if ($new === $pr->status) {
            return;
        }

        DB::table('purchase_requisitions')->where('id', $prId)->update(['status' => $new]);

        $this->audit->log(
            $covered ? 'purchase_requisition.convert' : 'purchase_requisition.reopen',
            'purchase_requisition',
            $prId,
            before: ['status' => $pr->status],
            after: ['status' => $new],
            actorId: $actor->id,
            storeId: $storeId,
        );
    }

    /** @return array<string, mixed>|null */
    private function load(int $storeId, int $id, bool $prices): ?array
    {
        $po = DB::table('purchase_orders as po')
            ->join('suppliers as s', 's.id', '=', 'po.supplier_id')
            ->join('purchase_requisitions as pr', 'pr.id', '=', 'po.pr_id')
            ->join('users as u', 'u.id', '=', 'po.created_by')
            ->where('po.store_id', $storeId)->where('po.id', $id)
            ->first(['po.*', 's.name as supplier_name', 'pr.doc_number as pr_doc_number', 'u.name as created_by_name']);

        if ($po === null) {
            return null;
        }

        $items = DB::table('purchase_order_items as i')
            ->join('products as p', 'p.id', '=', 'i.product_id')
            ->where('i.po_id', $id)->orderBy('i.id')
            ->get(['i.id', 'i.product_id', 'i.qty_ordered', 'i.qty_received', 'i.unit_price', 'p.sku', 'p.name', 'p.unit_name'])
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'product_id' => (int) $row->product_id,
                'sku' => $row->sku,
                'name' => $row->name,
                'unit_name' => $row->unit_name,
                'qty_ordered' => $row->qty_ordered,
                'qty_received' => $row->qty_received,
                'qty_remaining' => Decimal::qtyString(max(0, Decimal::qty($row->qty_ordered) - Decimal::qty($row->qty_received))),
                'unit_price' => $prices ? $row->unit_price : null,
                'line_total' => $prices ? LineTotal::money($row->qty_ordered, $row->unit_price) : null,
            ])->all();

        $receipts = DB::table('goods_receipts')->where('po_id', $id)->orderBy('id')
            ->get(['id', 'doc_number', 'status', 'document_status', 'posted_at'])
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'doc_number' => $row->doc_number,
                'status' => $row->status,
                'document_status' => $row->document_status,
                'posted_at' => $row->posted_at,
            ])->all();

        return [
            'id' => (int) $po->id,
            'doc_number' => $po->doc_number,
            'status' => $po->status,
            'receipt_status' => $po->receipt_status,
            'payment_status' => $po->payment_status,
            'payment_terms' => $po->payment_terms,
            'pr_id' => (int) $po->pr_id,
            'pr_doc_number' => $po->pr_doc_number,
            'supplier_id' => (int) $po->supplier_id,
            'supplier_name' => $po->supplier_name,
            'order_date' => $po->order_date,
            'expected_date' => $po->expected_date,
            'total' => $prices ? $po->total : null,
            'created_by' => (int) $po->created_by,
            'created_by_name' => $po->created_by_name,
            'created_at' => $po->created_at,
            'items' => $items,
            'receipts' => $receipts,
        ];
    }
}
