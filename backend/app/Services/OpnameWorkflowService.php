<?php

namespace App\Services;

use App\Exceptions\OpnameWorkflowException;
use App\Models\User;
use App\Support\Decimal;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class OpnameWorkflowService
{
    public function __construct(
        private OpnameReportBuilder $reports,
        private OpnameApprovalSettingsService $settings,
        private OpnameApprovalEvaluator $approvalEvaluator,
        private InventoryService $inventory,
        private ReauthService $reauth,
        private NotificationService $notifications,
        private AuditLogger $audit,
    ) {}

    /** @return array<string, mixed>|null */
    public function report(User $user, int $storeId, int $sessionId): ?array
    {
        $report = $this->reports->build($user, $storeId, $sessionId);
        if ($report === null) {
            return $report;
        }
        if ($report['session']['status'] === 'cancelled') {
            throw $this->invalidStatus('cancelled', 'Laporan sesi yang dibatalkan tidak tersedia.');
        }
        if ($report['complete']) {
            return $report;
        }

        throw new OpnameWorkflowException(
            'Hitungan belum lengkap.',
            'counting_incomplete',
            409,
            ['progress' => $report['progress']],
        );
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function submit(User $actor, int $storeId, int $sessionId, array $data): array
    {
        return DB::transaction(function () use ($actor, $storeId, $sessionId, $data) {
            $existing = $this->idempotentResult($actor, $storeId, $sessionId, $data['client_request_id'], ['submitted', 'posted']);
            if ($existing !== null) {
                return $existing;
            }

            $session = $this->lockSession($storeId, $sessionId);
            if ($session->status !== 'in_progress') {
                throw $this->invalidStatus($session->status, 'Hanya sesi yang sedang berjalan yang dapat diajukan atau diposting.');
            }
            $items = $this->completeItems($sessionId);
            $owner = $this->settings->isOwner($actor, $storeId);
            if ($owner) {
                $this->confirmApprover($actor, $storeId, (string) ($data['owner_password'] ?? ''), 'opname.post');
            }

            $snapshot = $this->makeSnapshot($storeId, $sessionId, $items);
            $thresholds = $this->settings->thresholds($storeId);
            $reasons = $this->approvalEvaluator->evaluate($storeId, $items, $snapshot, $thresholds);
            $approvalRequired = ! $owner && $reasons !== [];
            $now = $this->now();
            $this->freezeItems($sessionId, $items, $snapshot);

            if ($approvalRequired) {
                DB::table('stock_opname_sessions')->where('id', $sessionId)->update([
                    'status' => 'pending_approval',
                    'submitted_at' => $now,
                    'submitted_by' => $actor->id,
                    'approval_required' => true,
                    'approval_reasons' => json_encode($reasons, JSON_UNESCAPED_UNICODE),
                    'rejected_at' => null,
                    'rejected_by' => null,
                    'reject_reason' => null,
                    ...$snapshot['totals'],
                    'updated_at' => $now,
                ]);
                $this->recordAction($sessionId, 'submitted', $actor->id, $data['client_request_id'], null, $now);
                $this->audit->log(
                    'stock_opname.submit',
                    'stock_opname_session',
                    $sessionId,
                    before: ['status' => 'in_progress'],
                    after: ['status' => 'pending_approval', 'reasons' => $reasons],
                    storeId: $storeId,
                    actorId: $actor->id,
                );
                $this->notifications->notifyPermission(
                    $storeId,
                    'opname.approve',
                    'stock_opname_approval_required',
                    "Stock opname {$session->number} menunggu persetujuan Admin atau Owner.",
                    'stock_opname_session',
                    $sessionId,
                    $actor->id,
                );

                return $this->sessionSummary($actor, $storeId, $sessionId);
            }

            $adjustedProducts = $this->postDifferences($actor, $storeId, $sessionId, $items, $snapshot);
            DB::table('stock_opname_sessions')->where('id', $sessionId)->update([
                'status' => 'posted',
                'submitted_at' => $now,
                'submitted_by' => $actor->id,
                'approval_required' => false,
                'approval_reasons' => json_encode($reasons, JSON_UNESCAPED_UNICODE),
                'rejected_at' => null,
                'rejected_by' => null,
                'reject_reason' => null,
                'approved_at' => $owner ? $now : null,
                'approved_by' => $owner ? $actor->id : null,
                'posted_at' => $now,
                'posted_by' => $actor->id,
                ...$snapshot['totals'],
                'updated_at' => $now,
            ]);
            if ($adjustedProducts !== []) {
                $this->inventory->synchronizeAutomaticPurchaseRequisitions($actor, $storeId, $adjustedProducts);
            }
            $this->recordAction($sessionId, 'posted', $actor->id, $data['client_request_id'], null, $now);
            $this->audit->log(
                'stock_opname.post',
                'stock_opname_session',
                $sessionId,
                before: ['status' => 'in_progress'],
                after: ['status' => 'posted', 'variance_products' => $snapshot['totals']['variance_products']],
                selfApproval: $owner,
                storeId: $storeId,
                actorId: $actor->id,
            );

            return $this->sessionSummary($actor, $storeId, $sessionId);
        }, 3);
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function approve(User $actor, int $storeId, int $sessionId, array $data): array
    {
        $this->assertOwnerApprover($actor, $storeId);

        return DB::transaction(function () use ($actor, $storeId, $sessionId, $data) {
            $existing = $this->idempotentResult($actor, $storeId, $sessionId, $data['client_request_id'], ['approved']);
            if ($existing !== null) {
                return $existing;
            }
            $session = $this->lockSession($storeId, $sessionId);
            if ($session->status !== 'pending_approval') {
                throw $this->invalidStatus($session->status, 'Hanya sesi yang menunggu persetujuan yang dapat disetujui.');
            }
            $approver = $this->confirmApprover($actor, $storeId, (string) $data['owner_password'], 'opname.approve');
            $items = $this->completeItems($sessionId);
            $snapshot = $this->frozenSnapshot($sessionId, $session, $items);
            $this->assertStockUnchanged($storeId, $this->itemsWithDifferences($items, $snapshot));
            $now = $this->now();
            $adjustedProducts = $this->postDifferences($approver, $storeId, $sessionId, $items, $snapshot);
            DB::table('stock_opname_sessions')->where('id', $sessionId)->update([
                'status' => 'posted',
                'approved_at' => $now,
                'approved_by' => $approver->id,
                'posted_at' => $now,
                'posted_by' => $approver->id,
                'updated_at' => $now,
            ]);
            if ($adjustedProducts !== []) {
                $this->inventory->synchronizeAutomaticPurchaseRequisitions($approver, $storeId, $adjustedProducts);
            }
            $this->recordAction($sessionId, 'approved', $approver->id, $data['client_request_id'], null, $now);
            $this->recordAction($sessionId, 'posted', $approver->id, $this->newRequestId(), null, $now);
            $this->notifications->resolveForEntity($storeId, 'stock_opname_approval_required', 'stock_opname_session', $sessionId);
            $this->notifications->notifyUser(
                $storeId,
                (int) $session->submitted_by,
                'opname.view',
                'stock_opname_approved',
                "Stock opname {$session->number} telah disetujui dan diposting.",
                'stock_opname_session',
                $sessionId,
            );
            $this->audit->log(
                'stock_opname.approve',
                'stock_opname_session',
                $sessionId,
                before: ['status' => 'pending_approval'],
                after: ['status' => 'posted'],
                selfApproval: $approver->id === $actor->id,
                storeId: $storeId,
                actorId: $actor->id,
            );

            return $this->sessionSummary($actor, $storeId, $sessionId);
        }, 3);
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function reject(User $actor, int $storeId, int $sessionId, array $data): array
    {
        $this->assertOwnerApprover($actor, $storeId);

        return DB::transaction(function () use ($actor, $storeId, $sessionId, $data) {
            $existing = $this->idempotentResult($actor, $storeId, $sessionId, $data['client_request_id'], ['rejected']);
            if ($existing !== null) {
                return $existing;
            }
            $session = $this->lockSession($storeId, $sessionId);
            if ($session->status !== 'pending_approval') {
                throw $this->invalidStatus($session->status, 'Hanya sesi yang menunggu persetujuan yang dapat ditolak.');
            }
            $approver = $this->confirmApprover($actor, $storeId, (string) $data['owner_password'], 'opname.approve');
            $reason = trim((string) $data['reason']);
            $now = $this->now();
            DB::table('stock_opname_items')->where('session_id', $sessionId)->update([
                'diff_qty' => null,
                'unit_cost_snapshot' => null,
                'diff_value' => null,
                'revision_count' => 0,
            ]);
            DB::table('stock_opname_sessions')->where('id', $sessionId)->update([
                'status' => 'in_progress',
                'approval_required' => null,
                'approval_reasons' => null,
                'variance_products' => null,
                'short_qty' => null,
                'over_qty' => null,
                'short_value' => null,
                'over_value' => null,
                'abs_value' => null,
                'rejected_at' => $now,
                'rejected_by' => $approver->id,
                'reject_reason' => $reason,
                'updated_at' => $now,
            ]);
            $this->recordAction($sessionId, 'rejected', $approver->id, $data['client_request_id'], $reason, $now);
            $this->notifications->resolveForEntity($storeId, 'stock_opname_approval_required', 'stock_opname_session', $sessionId);
            $this->notifications->notifyUser(
                $storeId,
                (int) $session->submitted_by,
                'opname.view',
                'stock_opname_rejected',
                "Stock opname {$session->number} ditolak dan dikembalikan ke tahap penghitungan.",
                'stock_opname_session',
                $sessionId,
            );
            $this->audit->log(
                'stock_opname.reject',
                'stock_opname_session',
                $sessionId,
                before: ['status' => 'pending_approval'],
                after: ['status' => 'in_progress'],
                reason: $reason,
                selfApproval: $approver->id === $actor->id,
                storeId: $storeId,
                actorId: $actor->id,
            );

            return $this->sessionSummary($actor, $storeId, $sessionId);
        }, 3);
    }

    private function assertOwnerApprover(User $actor, int $storeId): void
    {
        abort_unless(
            $this->settings->isApprovalAuthority($actor, $storeId) && app(PermissionResolver::class)->allows($actor, 'opname.approve', $storeId),
            403,
            'Persetujuan stock opname hanya dapat dilakukan Admin pada model sederhana atau Owner.',
        );
    }

    private function confirmApprover(User $actor, int $storeId, string $password, string $permission): User
    {
        if (! $this->settings->isApprovalAuthority($actor, $storeId)) {
            abort(403, 'Aksi ini hanya dapat dilakukan Admin pada model sederhana atau Owner.');
        }
        if ($password === '') {
            throw ValidationException::withMessages(['owner_password' => ['Password Admin atau Owner wajib dikonfirmasi.']]);
        }

        try {
            return $this->reauth->confirm($actor->username, $password, $permission, $actor);
        } catch (ValidationException $exception) {
            $message = collect($exception->errors())->flatten()->first() ?? 'Konfirmasi password Owner gagal.';
            throw ValidationException::withMessages(['owner_password' => [$message]]);
        }
    }

    private function lockSession(int $storeId, int $sessionId): object
    {
        $session = DB::table('stock_opname_sessions')->where('store_id', $storeId)
            ->where('id', $sessionId)->lockForUpdate()->first();
        abort_if($session === null, 404, 'Sesi opname tidak ditemukan.');

        return $session;
    }

    /** @return array<int, object> */
    private function completeItems(int $sessionId): array
    {
        $items = DB::table('stock_opname_items as i')
            ->leftJoin('products as p', 'p.id', '=', 'i.product_id')
            ->where('i.session_id', $sessionId)
            ->orderBy('i.product_id')
            ->lockForUpdate()
            ->get([
                'i.id', 'i.product_id', 'i.counted_qty', 'i.system_qty_at_count',
                'i.product_name_snapshot', 'i.revision_count', 'p.unit_cost',
            ])->all();
        $uncounted = array_values(array_filter($items, fn ($item) => $item->counted_qty === null));
        if ($uncounted !== []) {
            throw new OpnameWorkflowException(
                'Hitungan belum lengkap.',
                'counting_incomplete',
                409,
                ['counted_products' => count($items) - count($uncounted), 'total_products' => count($items)],
            );
        }

        return $items;
    }

    /**
     * @param  array<int, object>  $items
     * @return array{item_values: array<int, array{diff_qty: string, cost: ?string, value: ?int, revisions: int}>, totals: array<string, mixed>}
     */
    private function makeSnapshot(int $storeId, int $sessionId, array $items): array
    {
        $snapshot = ['item_values' => [], 'totals' => $this->emptyTotals()];
        $this->assertStockUnchanged($storeId, $this->itemsWithDifferences($items));
        $logs = DB::table('stock_opname_count_logs')
            ->where('session_id', $sessionId)
            ->groupBy('item_id')
            ->selectRaw('item_id, COUNT(*) as count')
            ->pluck('count', 'item_id');
        foreach ($items as $item) {
            $diffUnits = Decimal::qty((string) $item->counted_qty) - Decimal::qty((string) $item->system_qty_at_count);
            $cost = $item->unit_cost === null ? null : (string) $item->unit_cost;
            $costUnits = $cost === null ? 0 : Decimal::toUnits($cost, 4);
            $value = $costUnits === 0 || $diffUnits === 0
                ? null
                : intdiv(abs($diffUnits) * $costUnits + 50000, 100000);
            $revisions = max(0, (int) $logs->get($item->id, 0) - 1);
            $snapshot['item_values'][(int) $item->id] = [
                'diff_qty' => Decimal::qtyString($diffUnits),
                'cost' => $costUnits <= 0 ? null : $cost,
                'value' => $value,
                'revisions' => $revisions,
            ];
            if ($diffUnits === 0) {
                continue;
            }
            $snapshot['totals']['variance_products']++;
            if ($diffUnits < 0) {
                $snapshot['totals']['short_qty'] += abs($diffUnits);
                $snapshot['totals']['short_value'] += $value ?? 0;
            } else {
                $snapshot['totals']['over_qty'] += $diffUnits;
                $snapshot['totals']['over_value'] += $value ?? 0;
            }
            $snapshot['totals']['abs_value'] += $value ?? 0;
        }
        $snapshot['totals']['short_qty'] = Decimal::qtyString($snapshot['totals']['short_qty']);
        $snapshot['totals']['over_qty'] = Decimal::qtyString($snapshot['totals']['over_qty']);
        $snapshot['totals']['short_value'] = Decimal::moneyString($snapshot['totals']['short_value']);
        $snapshot['totals']['over_value'] = Decimal::moneyString($snapshot['totals']['over_value']);
        $snapshot['totals']['abs_value'] = Decimal::moneyString($snapshot['totals']['abs_value']);

        return $snapshot;
    }

    /**
     * @param  array<int, object>  $items
     * @param  array{item_values: array<int, array{diff_qty: string, cost: ?string, value: ?int, revisions: int}>, totals: array<string, mixed>}|null  $snapshot
     */
    private function assertStockUnchanged(int $storeId, array $items): void
    {
        $ids = array_map(fn ($item) => (int) $item->product_id, $items);
        if ($ids === []) {
            return;
        }
        DB::table('products')->where('store_id', $storeId)->whereIn('id', $ids)
            ->orderBy('id')->lockForUpdate()->get(['id']);
        DB::table('inventory_balances')->whereIn('product_id', $ids)
            ->orderBy('product_id')->orderBy('id')->lockForUpdate()->get(['id']);
        $current = DB::table('inventory_balances')->whereIn('product_id', $ids)
            ->groupBy('product_id')
            ->selectRaw('product_id, SUM(qty_sellable + qty_quarantine + qty_damaged) as qty')
            ->pluck('qty', 'product_id');
        $changed = [];
        foreach ($items as $item) {
            $expected = Decimal::qty((string) $item->system_qty_at_count);
            if (Decimal::qty((string) $current->get($item->product_id, '0.000')) !== $expected) {
                $changed[] = ['product_id' => (int) $item->product_id, 'product_name' => $item->product_name_snapshot];
            }
        }
        if ($changed !== []) {
            throw new OpnameWorkflowException(
                'Stok berubah setelah dihitung. Tidak ada perubahan yang diposting.',
                'stock_changed_during_opname',
                409,
                ['products' => $changed],
            );
        }
    }

    /**
     * @param  array<int, object>  $items
     * @param  array{item_values: array<int, array{diff_qty: string, cost: ?string, value: ?int, revisions: int}>, totals: array<string, mixed>}  $snapshot
     */
    private function freezeItems(int $sessionId, array $items, array $snapshot): void
    {
        foreach ($items as $item) {
            $value = $snapshot['item_values'][(int) $item->id];
            if (Decimal::qty($value['diff_qty']) === 0) {
                continue;
            }
            DB::table('stock_opname_items')->where('id', $item->id)->update([
                'diff_qty' => $value['diff_qty'],
                'unit_cost_snapshot' => $value['cost'],
                'diff_value' => $value['value'] === null ? null : Decimal::moneyString($value['value']),
                'revision_count' => $value['revisions'],
            ]);
        }
    }

    /**
     * @param  array<int, object>  $items
     * @param  array{item_values: array<int, array{diff_qty: string, cost: ?string, value: ?int, revisions: int}>, totals: array<string, mixed>}  $snapshot
     * @return list<int>
     */
    private function postDifferences(User $actor, int $storeId, int $sessionId, array $items, array $snapshot): array
    {
        $lines = [];
        foreach ($items as $item) {
            $value = $snapshot['item_values'][(int) $item->id] ?? null;
            if ($value === null || Decimal::qty($value['diff_qty']) === 0) {
                continue;
            }
            $lines[] = [
                'item_id' => (int) $item->id,
                'product_id' => (int) $item->product_id,
                'diff_qty' => $value['diff_qty'],
                'unit_cost' => $value['cost'],
            ];
        }
        if ($lines === []) {
            return [];
        }

        $movements = $this->inventory->postOpnameAdjustments(
            $actor,
            $storeId,
            $sessionId,
            array_map(fn (array $line) => [
                'product_id' => $line['product_id'],
                'diff_qty' => $line['diff_qty'],
                'unit_cost' => $line['unit_cost'],
            ], $lines),
        );
        foreach ($lines as $line) {
            DB::table('stock_opname_items')->where('id', $line['item_id'])
                ->update(['stock_movement_id' => $movements[$line['product_id']]]);
        }

        return array_column($lines, 'product_id');
    }

    /** @param array<int, object> $items
     * @return array{item_values: array<int, array{diff_qty: string, cost: ?string, value: ?int, revisions: int}>, totals: array<string, mixed>}
     */
    private function frozenSnapshot(int $sessionId, object $session, array $items): array
    {
        $values = [];
        foreach ($items as $item) {
            $row = DB::table('stock_opname_items')->where('id', $item->id)
                ->first(['diff_qty', 'unit_cost_snapshot', 'diff_value', 'revision_count']);
            if ($row->diff_qty === null) {
                continue;
            }
            $values[(int) $item->id] = [
                'diff_qty' => (string) $row->diff_qty,
                'cost' => $row->unit_cost_snapshot === null ? null : (string) $row->unit_cost_snapshot,
                'value' => $row->diff_value === null ? null : Decimal::money((string) $row->diff_value),
                'revisions' => (int) $row->revision_count,
            ];
        }

        return [
            'item_values' => $values,
            'totals' => [
                'variance_products' => (int) $session->variance_products,
                'short_qty' => (string) $session->short_qty,
                'over_qty' => (string) $session->over_qty,
                'short_value' => (string) $session->short_value,
                'over_value' => (string) $session->over_value,
                'abs_value' => (string) $session->abs_value,
            ],
        ];
    }

    /** @return array<string, mixed> */
    private function emptyTotals(): array
    {
        return [
            'variance_products' => 0,
            'short_qty' => 0,
            'over_qty' => 0,
            'short_value' => 0,
            'over_value' => 0,
            'abs_value' => 0,
        ];
    }

    private function sessionSummary(User $actor, int $storeId, int $sessionId): array
    {
        $summary = (array) DB::table('stock_opname_sessions')
            ->where('store_id', $storeId)->where('id', $sessionId)->first();
        $summary['approval_reasons'] = $summary['approval_reasons'] === null
            ? []
            : json_decode((string) $summary['approval_reasons'], true);
        if (! app(PermissionResolver::class)->allows($actor, 'opname.view_value', $storeId)) {
            unset($summary['short_value'], $summary['over_value'], $summary['abs_value']);
        }

        return $summary;
    }

    /**
     * @param  array<int, object>  $items
     * @param  array{item_values: array<int, array{diff_qty: string, cost: ?string, value: ?int, revisions: int}>, totals: array<string, mixed>}|null  $snapshot
     * @return array<int, object>
     */
    private function itemsWithDifferences(array $items, ?array $snapshot = null): array
    {
        return array_values(array_filter($items, function ($item) use ($snapshot) {
            $difference = $snapshot === null
                ? Decimal::qty((string) $item->counted_qty) - Decimal::qty((string) $item->system_qty_at_count)
                : Decimal::qty($snapshot['item_values'][(int) $item->id]['diff_qty'] ?? '0.000');

            return $difference !== 0;
        }));
    }

    private function idempotentResult(User $actor, int $storeId, int $sessionId, string $requestId, array $actions): ?array
    {
        $row = DB::table('stock_opname_approvals')->where('client_request_id', $requestId)->first();
        if ($row === null) {
            return null;
        }
        if ((int) $row->session_id !== $sessionId || ! in_array($row->action, $actions, true)) {
            throw new OpnameWorkflowException(
                'Kunci permintaan sudah digunakan untuk aksi lain.',
                'idempotency_key_conflict',
                409,
            );
        }

        return $this->sessionSummary($actor, $storeId, $sessionId);
    }

    private function recordAction(int $sessionId, string $action, int $userId, string $requestId, ?string $note, string $now): void
    {
        DB::table('stock_opname_approvals')->insert([
            'session_id' => $sessionId,
            'action' => $action,
            'by' => $userId,
            'at' => $now,
            'note' => $note,
            'client_request_id' => $requestId,
        ]);
    }

    private function invalidStatus(string $status, string $message): OpnameWorkflowException
    {
        return new OpnameWorkflowException($message." Status sesi saat ini: {$status}.", 'invalid_status', 409);
    }

    private function newRequestId(): string
    {
        return (string) Str::uuid();
    }

    private function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.v');
    }
}
