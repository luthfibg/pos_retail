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
 * Purchase Requisition (PR). Alur (dokumen kebutuhan 6.1):
 *   draft -> submitted -> finance_checked -> approved | rejected   (returned = dikembalikan Finance, boleh diedit lalu diajukan lagi)
 *   draft/returned/submitted -> cancelled
 *   approved -> converted (otomatis oleh PurchaseOrderService bila seluruh item sudah masuk PO)
 *
 * Aturan:
 *  - Kasir boleh membuat dan mengajukan PR; hanya melihat PR miliknya. Pemegang finance_check/approve/purchase_order.create melihat semua.
 *  - Pemeriksaan Finance Paket 1 tanpa Saldo Pembelian: Finance menilai kelayakan secara manual (cek saldo = Paket 2).
 *  - Persetujuan Owner wajib autentikasi ulang (setting approval_reauth_required). Pembuat PR menyetujui sendiri hanya bila
 *    setting SoD mengizinkan (mode minimalis) dan ditandai is_self_approval di pr_approvals + audit.
 *  - [ASUMSI] "Owner" = pemegang permission settings.manage; setting sod_owner_self_approve berlaku untuknya, sod_pr_creator_approver untuk yang lain.
 */
class PurchaseRequisitionService
{
    use PurchasingSupport;

    private const EDITABLE = ['draft', 'returned'];

    public function __construct(
        private AuditLogger $audit,
        private NumberSequence $sequences,
        private PermissionResolver $permissions,
        private ReauthService $reauth,
        private NotificationService $notifications,
    ) {
    }

    // ------------------------------------------------------------------ baca

    /** @param array<string, mixed> $filters status?, q?, mine? */
    public function search(User $user, int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $this->assertCanView($user, $storeId);

        $query = DB::table('purchase_requisitions as pr')
            ->join('users as u', 'u.id', '=', 'pr.requested_by')
            ->where('pr.store_id', $storeId)
            ->selectRaw(
                'pr.*, u.name as requester_name, '.
                '(select count(*) from purchase_requisition_items i where i.pr_id = pr.id) as items_count'
            );

        if (! $this->seesAll($user, $storeId) || ! empty($filters['mine'])) {
            $query->where('pr.requested_by', $user->id);
        }

        if (! empty($filters['status'])) {
            $query->where('pr.status', $filters['status']);
        }

        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where('pr.doc_number', 'like', "{$term}%");
        }

        return $query->orderByDesc('pr.id')->paginate($perPage)->through(fn ($row) => [
            'id' => (int) $row->id,
            'doc_number' => $row->doc_number,
            'status' => $row->status,
            'reason' => $row->reason,
            'est_total' => $row->est_total,
            'items_count' => (int) $row->items_count,
            'requested_by' => (int) $row->requested_by,
            'requester_name' => $row->requester_name,
            'submitted_at' => $row->submitted_at,
            'created_at' => $row->created_at,
        ]);
    }

    /** @return array<string, mixed>|null null bila tidak ada atau bukan milik pengguna yang tidak berhak melihat semua */
    public function find(User $user, int $storeId, int $id): ?array
    {
        $this->assertCanView($user, $storeId);

        $detail = $this->load($storeId, $id);

        if ($detail === null) {
            return null;
        }

        if (! $this->seesAll($user, $storeId) && $detail['requested_by'] !== $user->id) {
            return null;
        }

        return $detail;
    }

    /**
     * Qty yang sudah dipesan per produk lewat PO (selain yang dibatalkan), dalam satuan 0,001.
     *
     * @return array<int, int> product_id => qty
     */
    public function orderedByProduct(int $prId, ?int $exceptPoId = null): array
    {
        $query = DB::table('purchase_order_items as poi')
            ->join('purchase_orders as po', 'po.id', '=', 'poi.po_id')
            ->where('po.pr_id', $prId)
            ->where('po.status', '<>', 'cancelled');

        if ($exceptPoId !== null) {
            $query->where('po.id', '<>', $exceptPoId);
        }

        $sums = $query->groupBy('poi.product_id')->selectRaw('poi.product_id, SUM(poi.qty_ordered) as ordered')->get();

        $result = [];
        foreach ($sums as $row) {
            $result[(int) $row->product_id] = Decimal::qty((string) $row->ordered);
        }

        return $result;
    }

    // ------------------------------------------------------------------ tulis

    /**
     * @param  array<string, mixed>  $data  reason?, items[] (product_id, qty, est_price?, note?)
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $data) {
            $items = $this->normalizeItems($storeId, $data['items']);
            $total = $this->sumTotal($items);

            $id = DB::table('purchase_requisitions')->insertGetId([
                'store_id' => $storeId,
                'doc_number' => $this->nextDocNumber($storeId, 'PR'),
                'requested_by' => $actor->id,
                'reason' => $data['reason'] ?? null,
                'est_total' => Decimal::moneyString($total),
                'status' => 'draft',
            ]);

            $this->insertItems($id, $items);

            $this->audit->log(
                'purchase_requisition.create',
                'purchase_requisition',
                $id,
                after: ['items' => count($items), 'est_total' => Decimal::moneyString($total)],
                reason: $data['reason'] ?? null,
                actorId: $actor->id,
                storeId: $storeId,
            );

            return $id;
        });

        return $this->load($storeId, $id) ?? [];
    }

    /**
     * Mengubah PR berstatus draft/returned. `items` (bila dikirim) menggantikan seluruh item.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function update(User $actor, int $storeId, int $id, array $data): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $pr = $this->lock($storeId, $id);
            $this->assertCanManage($actor, $storeId, $pr);
            $this->assertStatus($pr, self::EDITABLE, 'PR hanya dapat diubah saat berstatus draft atau dikembalikan.');

            $after = [];

            if (array_key_exists('reason', $data)) {
                DB::table('purchase_requisitions')->where('id', $id)->update(['reason' => $data['reason']]);
                $after['reason'] = $data['reason'];
            }

            if (isset($data['items'])) {
                $items = $this->normalizeItems($storeId, $data['items']);
                $total = $this->sumTotal($items);

                DB::table('purchase_requisition_items')->where('pr_id', $id)->delete();
                $this->insertItems($id, $items);
                DB::table('purchase_requisitions')->where('id', $id)->update(['est_total' => Decimal::moneyString($total)]);

                $after['items'] = count($items);
                $after['est_total'] = Decimal::moneyString($total);
            }

            if ($after !== []) {
                $this->audit->log(
                    'purchase_requisition.update',
                    'purchase_requisition',
                    $id,
                    before: ['est_total' => $pr->est_total],
                    after: $after,
                    actorId: $actor->id,
                    storeId: $storeId,
                );
            }
        });

        return $this->load($storeId, $id) ?? [];
    }

    /** @return array<string, mixed> */
    public function submit(User $actor, int $storeId, int $id): array
    {
        $pr = DB::transaction(function () use ($actor, $storeId, $id) {
            $pr = $this->lock($storeId, $id);
            $this->assertCanManage($actor, $storeId, $pr);
            $this->assertStatus($pr, self::EDITABLE, 'Hanya PR berstatus draft atau dikembalikan yang dapat diajukan.');

            if (! DB::table('purchase_requisition_items')->where('pr_id', $id)->exists()) {
                throw ValidationException::withMessages(['items' => ['PR minimal berisi satu item.']]);
            }

            DB::table('purchase_requisitions')->where('id', $id)->update([
                'status' => 'submitted',
                'submitted_at' => $this->nowUtc(),
            ]);

            $this->audit->log(
                'purchase_requisition.submit',
                'purchase_requisition',
                $id,
                before: ['status' => $pr->status],
                after: ['status' => 'submitted'],
                actorId: $actor->id,
                storeId: $storeId,
            );

            return $pr;
        });

        $this->notifications->notifyPermission(
            $storeId,
            'purchase_requisition.finance_check',
            'pr.submitted',
            "PR {$pr->doc_number} diajukan dan menunggu pemeriksaan Finance.",
            'purchase_requisition',
            $id,
            $actor->id,
        );

        return $this->load($storeId, $id) ?? [];
    }

    /**
     * Pemeriksaan Finance: 'pass' (diteruskan ke Owner) atau 'return' (dikembalikan, catatan wajib).
     *
     * @return array<string, mixed>
     */
    public function financeCheck(User $actor, int $storeId, int $id, string $decision, ?string $note): array
    {
        $note = $note === null ? null : trim($note);

        if ($decision === 'return' && ($note === null || $note === '')) {
            throw ValidationException::withMessages(['note' => ['Alasan pengembalian wajib diisi.']]);
        }

        $pr = DB::transaction(function () use ($actor, $storeId, $id, $decision, $note) {
            $pr = $this->lock($storeId, $id);
            $this->assertStatus($pr, ['submitted'], 'Hanya PR berstatus diajukan yang dapat diperiksa Finance.');

            $passed = $decision === 'pass';
            $newStatus = $passed ? 'finance_checked' : 'returned';

            DB::table('pr_approvals')->insert([
                'pr_id' => $id,
                'step' => 'finance_check',
                'decision' => $passed ? 'approved' : 'returned',
                'decided_by' => $actor->id,
                'note' => $note,
                'is_self_approval' => (int) $pr->requested_by === $actor->id ? 1 : 0,
            ]);

            DB::table('purchase_requisitions')->where('id', $id)->update(['status' => $newStatus]);

            $this->audit->log(
                $passed ? 'purchase_requisition.finance_check' : 'purchase_requisition.return',
                'purchase_requisition',
                $id,
                before: ['status' => 'submitted'],
                after: ['status' => $newStatus],
                reason: $note,
                selfApproval: (int) $pr->requested_by === $actor->id,
                actorId: $actor->id,
                storeId: $storeId,
            );

            return $pr;
        });

        if ($decision === 'pass') {
            $this->notifications->notifyPermission(
                $storeId,
                'purchase_requisition.approve',
                'pr.finance_checked',
                "PR {$pr->doc_number} lolos pemeriksaan Finance dan menunggu persetujuan Owner.",
                'purchase_requisition',
                $id,
                $actor->id,
            );
        } elseif ((int) $pr->requested_by !== $actor->id) {
            $this->notifyUser($storeId, (int) $pr->requested_by, 'pr.returned', "PR {$pr->doc_number} dikembalikan Finance: {$note}", 'purchase_requisition', $id);
        }

        return $this->load($storeId, $id) ?? [];
    }

    /**
     * Persetujuan/penolakan Owner. Autentikasi ulang (approver_username + approver_password) wajib selama
     * setting approval_reauth_required aktif; tanpa itu, pengguna yang login sendiri menjadi pemberi persetujuan.
     *
     * @param  array<string, mixed>  $data  decision (approve|reject), note?, approver_username?, approver_password?
     * @return array<string, mixed>
     */
    public function approve(User $actor, int $storeId, int $id, array $data): array
    {
        $approve = $data['decision'] === 'approve';
        $note = isset($data['note']) ? trim((string) $data['note']) : null;

        if (! $approve && ($note === null || $note === '')) {
            throw ValidationException::withMessages(['note' => ['Alasan penolakan wajib diisi.']]);
        }

        // re-auth di luar transaksi agar catatan percobaan gagalnya tidak ikut ter-rollback
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
            abort_unless($this->permissions->allows($actor, 'purchase_requisition.approve', $storeId), 403, 'Anda tidak berwenang menyetujui PR.');
            $approver = $actor;
        }

        $pr = DB::transaction(function () use ($actor, $approver, $storeId, $id, $approve, $note, $reauth) {
            $pr = $this->lock($storeId, $id);
            $this->assertStatus($pr, ['finance_checked'], 'PR harus lolos pemeriksaan Finance sebelum disetujui atau ditolak.');

            $self = (int) $pr->requested_by === $approver->id;

            if ($self) {
                $this->assertSelfApprovalAllowed($storeId, $approver);
            }

            $newStatus = $approve ? 'approved' : 'rejected';

            DB::table('pr_approvals')->insert([
                'pr_id' => $id,
                'step' => 'owner_auth',
                'decision' => $approve ? 'approved' : 'rejected',
                'decided_by' => $approver->id,
                'note' => $note,
                'reauth_at' => $reauth ? $this->nowUtc() : null,
                'is_self_approval' => $self ? 1 : 0,
            ]);

            DB::table('purchase_requisitions')->where('id', $id)->update(['status' => $newStatus]);

            $this->audit->log(
                $approve ? 'purchase_requisition.approve' : 'purchase_requisition.reject',
                'purchase_requisition',
                $id,
                before: ['status' => 'finance_checked'],
                after: ['status' => $newStatus, 'session_user_id' => $actor->id],
                reason: $note,
                selfApproval: $self,
                actorId: $approver->id,
                storeId: $storeId,
            );

            return $pr;
        });

        if ((int) $pr->requested_by !== $approver->id) {
            $this->notifyUser(
                $storeId,
                (int) $pr->requested_by,
                $approve ? 'pr.approved' : 'pr.rejected',
                $approve ? "PR {$pr->doc_number} disetujui." : "PR {$pr->doc_number} ditolak: {$note}",
                'purchase_requisition',
                $id,
            );
        }

        if ($approve) {
            $this->notifications->notifyPermission(
                $storeId,
                'purchase_order.create',
                'pr.ready_for_po',
                "PR {$pr->doc_number} disetujui dan siap dibuatkan PO.",
                'purchase_requisition',
                $id,
                $approver->id,
            );
        }

        return $this->load($storeId, $id) ?? [];
    }

    /** @return array<string, mixed> */
    public function cancel(User $actor, int $storeId, int $id, ?string $reason): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            $pr = $this->lock($storeId, $id);
            $this->assertCanManage($actor, $storeId, $pr);
            $this->assertStatus($pr, ['draft', 'returned', 'submitted'], 'PR hanya dapat dibatalkan saat draft, dikembalikan, atau diajukan.');

            DB::table('purchase_requisitions')->where('id', $id)->update(['status' => 'cancelled']);

            $this->audit->log(
                'purchase_requisition.cancel',
                'purchase_requisition',
                $id,
                before: ['status' => $pr->status],
                after: ['status' => 'cancelled'],
                reason: $reason,
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id) ?? [];
    }

    // ------------------------------------------------------------------ internal

    private function seesAll(User $user, int $storeId): bool
    {
        foreach ([
            'purchase_requisition.finance_check',
            'purchase_requisition.approve',
            'purchase_order.create',
            'purchase_order.send',
        ] as $code) {
            if ($this->permissions->allows($user, $code, $storeId)) {
                return true;
            }
        }

        return false;
    }

    private function assertCanView(User $user, int $storeId): void
    {
        foreach ([
            'purchase_requisition.create',
            'purchase_requisition.finance_check',
            'purchase_requisition.approve',
            'purchase_order.create',
            'purchase_order.send',
        ] as $code) {
            if ($this->permissions->allows($user, $code, $storeId)) {
                return;
            }
        }

        abort(403, 'Anda tidak memiliki izin untuk melihat permintaan pembelian.');
    }

    private function assertCanManage(User $actor, int $storeId, object $pr): void
    {
        abort_unless(
            (int) $pr->requested_by === $actor->id || $this->permissions->allows($actor, 'purchase_requisition.finance_check', $storeId),
            403,
            'Anda tidak berwenang mengelola PR ini.',
        );
    }

    /** @param list<string> $allowed */
    private function assertStatus(object $pr, array $allowed, string $message): void
    {
        if (! in_array($pr->status, $allowed, true)) {
            throw ValidationException::withMessages(['status' => [$message]]);
        }
    }

    private function assertSelfApprovalAllowed(int $storeId, User $approver): void
    {
        $isOwner = $this->permissions->allows($approver, 'settings.manage', $storeId);
        $rule = $isOwner
            ? $this->setting($storeId, 'sod_owner_self_approve', 'allow_with_flag')
            : $this->setting($storeId, 'sod_pr_creator_approver', 'block');

        if (! in_array($rule, ['allow_with_flag', 'allow'], true)) {
            throw ValidationException::withMessages([
                'approver_username' => ['Pembuat PR tidak boleh menyetujui PR sendiri.'],
            ]);
        }
    }

    private function lock(int $storeId, int $id): object
    {
        $pr = DB::table('purchase_requisitions')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();

        abort_if($pr === null, 404, 'PR tidak ditemukan.');

        return $pr;
    }

    /**
     * Validasi item PR: produk ada di toko, tidak nonaktif, tidak ganda. Mengembalikan baris siap simpan.
     *
     * @param  list<array<string, mixed>>  $items
     * @return list<array<string, mixed>>
     */
    private function normalizeItems(int $storeId, array $items): array
    {
        $products = DB::table('products')
            ->where('store_id', $storeId)
            ->whereIn('id', array_map(fn ($item) => (int) $item['product_id'], $items))
            ->get(['id', 'name', 'status'])
            ->keyBy('id');

        $errors = [];
        $seen = [];
        $rows = [];

        foreach (array_values($items) as $i => $item) {
            $productId = (int) $item['product_id'];
            $product = $products->get($productId);

            if ($product === null) {
                $errors["items.{$i}.product_id"] = ['Produk tidak ditemukan.'];
                continue;
            }

            if ($product->status === 'inactive') {
                $errors["items.{$i}.product_id"] = ["Produk {$product->name} nonaktif."];
                continue;
            }

            if (isset($seen[$productId])) {
                $errors["items.{$i}.product_id"] = ["Produk {$product->name} sudah ada di daftar; gabungkan jumlahnya."];
                continue;
            }
            $seen[$productId] = true;

            $rows[] = [
                'product_id' => $productId,
                'qty' => Decimal::qtyString(Decimal::qty($item['qty'])),
                'est_price' => isset($item['est_price']) && $item['est_price'] !== ''
                    ? Decimal::moneyString(Decimal::money($item['est_price']))
                    : null,
                'note' => $item['note'] ?? null,
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
            $total += LineTotal::cents($item['qty'], $item['est_price']);
        }

        return $total;
    }

    /** @param list<array<string, mixed>> $items */
    private function insertItems(int $prId, array $items): void
    {
        foreach ($items as $item) {
            DB::table('purchase_requisition_items')->insert([
                'pr_id' => $prId,
                'product_id' => $item['product_id'],
                'qty' => $item['qty'],
                'est_price' => $item['est_price'],
                'note' => $item['note'],
            ]);
        }
    }

    /** @return array<string, mixed>|null */
    private function load(int $storeId, int $id): ?array
    {
        $pr = DB::table('purchase_requisitions as pr')
            ->join('users as u', 'u.id', '=', 'pr.requested_by')
            ->where('pr.store_id', $storeId)->where('pr.id', $id)
            ->first(['pr.*', 'u.name as requester_name']);

        if ($pr === null) {
            return null;
        }

        $ordered = $this->orderedByProduct($id);

        $items = DB::table('purchase_requisition_items as i')
            ->join('products as p', 'p.id', '=', 'i.product_id')
            ->where('i.pr_id', $id)->orderBy('i.id')
            ->get(['i.id', 'i.product_id', 'i.qty', 'i.est_price', 'i.note', 'p.sku', 'p.name', 'p.unit_name'])
            ->map(function ($row) use ($ordered) {
                $done = $ordered[(int) $row->product_id] ?? 0;

                return [
                    'id' => (int) $row->id,
                    'product_id' => (int) $row->product_id,
                    'sku' => $row->sku,
                    'name' => $row->name,
                    'unit_name' => $row->unit_name,
                    'qty' => $row->qty,
                    'est_price' => $row->est_price,
                    'note' => $row->note,
                    'qty_ordered' => Decimal::qtyString($done),
                    'qty_remaining' => Decimal::qtyString(max(0, Decimal::qty($row->qty) - $done)),
                ];
            })->all();

        $approvals = DB::table('pr_approvals as a')
            ->join('users as u', 'u.id', '=', 'a.decided_by')
            ->where('a.pr_id', $id)->orderBy('a.id')
            ->get(['a.step', 'a.decision', 'a.decided_by', 'u.name as decided_by_name', 'a.note', 'a.is_self_approval', 'a.decided_at'])
            ->map(fn ($row) => [
                'step' => $row->step,
                'decision' => $row->decision,
                'decided_by' => (int) $row->decided_by,
                'decided_by_name' => $row->decided_by_name,
                'note' => $row->note,
                'is_self_approval' => (bool) $row->is_self_approval,
                'decided_at' => $row->decided_at,
            ])->all();

        $orders = DB::table('purchase_orders')->where('pr_id', $id)->orderBy('id')
            ->get(['id', 'doc_number', 'status', 'total'])
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'doc_number' => $row->doc_number,
                'status' => $row->status,
                'total' => $row->total,
            ])->all();

        return [
            'id' => (int) $pr->id,
            'doc_number' => $pr->doc_number,
            'status' => $pr->status,
            'reason' => $pr->reason,
            'est_total' => $pr->est_total,
            'requested_by' => (int) $pr->requested_by,
            'requester_name' => $pr->requester_name,
            'submitted_at' => $pr->submitted_at,
            'created_at' => $pr->created_at,
            'items' => $items,
            'approvals' => $approvals,
            'purchase_orders' => $orders,
        ];
    }
}
