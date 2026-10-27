<?php

namespace App\Services;

use App\Models\User;
use App\Services\Concerns\PurchasingSupport;
use App\Support\Decimal;
use Illuminate\Http\UploadedFile;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * Penerimaan barang (Goods Receipt, GR) dari PO. Alur (dokumen kebutuhan 6.4):
 *   draft -> posted (stok bertambah, PO diperbarui) ; draft -> cancelled ; posted -> dokumen diverifikasi
 *   (nilai `checked` pada enum belum dipakai: pemeriksaan = mengisi qty aktual saat draft)
 *
 * Aturan:
 *  - penerimaan WAJIB dari PO berstatus approved/sent/partially_received (receiving_requires_po tidak dapat dimatikan).
 *    [ASUMSI] PO `approved` (belum diklik "kirim") tetap boleh menerima agar operasional tidak tertahan langkah administratif
 *  - tidak boleh menerima melebihi sisa pesanan (diterima + rusak <= sisa); satu baris PO boleh dipecah ke beberapa baris GR (batch/kadaluarsa berbeda)
 *  - produk track_expiry wajib bertanggal kadaluarsa; produk lain tidak boleh. [ASUMSI] barang yang sudah lewat tanggal kadaluarsa
 *    ditolak sebagai "diterima layak jual" (catat sebagai rusak)
 *  - harga beli = harga di PO; hanya pemegang goods_receipt.verify_documents yang boleh mengubahnya (selisih tampil sebagai price_variance)
 *  - stok masuk lewat InventoryService::receive (batch + saldo + pergerakan `receipt` + HPP rata-rata bergerak), semua dalam satu transaksi
 *  - penerimaan gudang hanya diizinkan bila warehouse_enabled aktif; posisi rak tujuan opsional dan dapat diisi saat putaway
 *  - [ASUMSI] qty_damaged hanya dicatat di dokumen (untuk klaim/retur supplier, Paket 3); tidak menambah stok dan tidak mengurangi sisa pesanan
 *  - GR terposting tidak diedit; koreksi lewat dokumen koreksi (belum ada)
 */
class GoodsReceiptService
{
    use PurchasingSupport;

    public function __construct(
        private AuditLogger $audit,
        private NumberSequence $sequences,
        private PermissionResolver $permissions,
        private InventoryService $inventory,
        private NotificationService $notifications,
    ) {}

    // ------------------------------------------------------------------ baca

    /** @param array<string, mixed> $filters status?, document_status?, po_id?, q? */
    public function search(User $user, int $storeId, array $filters, int $perPage): LengthAwarePaginator
    {
        $query = DB::table('goods_receipts as gr')
            ->join('purchase_orders as po', 'po.id', '=', 'gr.po_id')
            ->join('suppliers as s', 's.id', '=', 'gr.supplier_id')
            ->join('users as u', 'u.id', '=', 'gr.received_by')
            ->join('locations as l', 'l.id', '=', 'gr.receiving_location_id')
            ->where('gr.store_id', $storeId)
            ->select('gr.*', 'po.doc_number as po_doc_number', 's.name as supplier_name', 'u.name as received_by_name', 'l.name as receiving_location_name');

        if (! $this->canVerify($user, $storeId)) {
            $query->where('gr.received_by', $user->id);
        }

        foreach (['status', 'document_status'] as $column) {
            if (! empty($filters[$column])) {
                $query->where("gr.{$column}", $filters[$column]);
            }
        }

        if (! empty($filters['po_id'])) {
            $query->where('gr.po_id', (int) $filters['po_id']);
        }

        if (! empty($filters['q'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $filters['q']);
            $query->where('gr.doc_number', 'like', "{$term}%");
        }

        return $query->orderByDesc('gr.id')->paginate($perPage)->through(fn ($row) => [
            'id' => (int) $row->id,
            'doc_number' => $row->doc_number,
            'po_id' => (int) $row->po_id,
            'po_doc_number' => $row->po_doc_number,
            'supplier_name' => $row->supplier_name,
            'receiving_location_id' => (int) $row->receiving_location_id,
            'receiving_location_name' => $row->receiving_location_name,
            'status' => $row->status,
            'document_status' => $row->document_status,
            'received_by_name' => $row->received_by_name,
            'posted_at' => $row->posted_at,
            'created_at' => $row->created_at,
        ]);
    }

    /** @return list<array{id: int, type: string, name: string}> */
    public function receivingLocations(int $storeId): array
    {
        $query = DB::table('locations')
            ->where('store_id', $storeId)
            ->where('is_active', 1);

        if (! (bool) $this->setting($storeId, 'warehouse_enabled', false)) {
            $query->where('type', 'store_floor');
        }

        return $query->orderBy('type')->orderBy('id')->get(['id', 'type', 'name'])
            ->map(fn ($location) => [
                'id' => (int) $location->id,
                'type' => $location->type,
                'name' => $location->name,
            ])->all();
    }

    /** @return array<string, mixed>|null */
    public function find(User $user, int $storeId, int $id): ?array
    {
        $detail = $this->load($storeId, $id, $this->canVerify($user, $storeId));

        if ($detail === null) {
            return null;
        }

        if (! $this->canVerify($user, $storeId) && $detail['received_by'] !== $user->id) {
            return null;
        }

        return $detail;
    }

    // ------------------------------------------------------------------ tulis

    /**
     * Membuat penerimaan (draft). `post: true` langsung memposting.
     *
     * @param  array<string, mixed>  $data  po_id, receiving_location_id?, delivery_note_no?, invoice_no?, note?, post?, items[] (po_item_id, qty_received, qty_damaged?, unit_cost?, expiry_date?, batch_code?, shelf_position_id?, note?)
     * @return array<string, mixed>
     */
    public function create(User $actor, int $storeId, array $data): array
    {
        $id = DB::transaction(function () use ($actor, $storeId, $data) {
            $po = DB::table('purchase_orders')
                ->where('store_id', $storeId)->where('id', (int) $data['po_id'])->lockForUpdate()->first();

            if ($po === null || ! in_array($po->status, PurchaseOrderService::RECEIVABLE, true)) {
                throw ValidationException::withMessages([
                    'po_id' => ['PO tidak ditemukan atau belum dapat menerima barang (harus Disetujui, Dikirim, atau Sebagian Diterima).'],
                ]);
            }

            $locationId = $this->receivingLocationId(
                $storeId,
                isset($data['receiving_location_id']) ? (int) $data['receiving_location_id'] : null,
            );
            $poItems = DB::table('purchase_order_items')->where('po_id', $po->id)->get()->keyBy('id');
            $rows = $this->normalizeItems($actor, $storeId, $locationId, $poItems, $data['items']);

            $id = DB::table('goods_receipts')->insertGetId([
                'store_id' => $storeId,
                'doc_number' => $this->nextDocNumber($storeId, 'GR'),
                'po_id' => $po->id,
                'supplier_id' => $po->supplier_id,
                'delivery_note_no' => $data['delivery_note_no'] ?? null,
                'invoice_no' => $data['invoice_no'] ?? null,
                'receiving_location_id' => $locationId,
                'status' => 'draft',
                'document_status' => 'pending',
                'received_by' => $actor->id,
                'note' => $data['note'] ?? null,
            ]);

            foreach ($rows as $row) {
                DB::table('goods_receipt_items')->insert(['gr_id' => $id] + $row);
            }

            $this->audit->log(
                'goods_receipt.create',
                'goods_receipt',
                $id,
                after: ['po_id' => (int) $po->id, 'receiving_location_id' => $locationId, 'items' => count($rows)],
                actorId: $actor->id,
                storeId: $storeId,
            );

            return $id;
        });

        if (! empty($data['post'])) {
            return $this->post($actor, $storeId, $id);
        }

        return $this->load($storeId, $id, $this->canVerify($actor, $storeId)) ?? [];
    }

    /**
     * Adds private supporting evidence to a receipt while its documents are pending verification.
     *
     * @return array<string, mixed>
     */
    public function attach(User $actor, int $storeId, int $grId, UploadedFile $file): array
    {
        $gr = DB::table('goods_receipts')
            ->where('store_id', $storeId)
            ->where('id', $grId)
            ->first();

        abort_if($gr === null, 404, 'Penerimaan tidak ditemukan.');
        $this->assertAccess($actor, $storeId, $gr);
        $this->assertAttachmentsOpen($gr);

        $path = $file->store("{$storeId}/goods-receipts/{$grId}", 'local');

        if (! is_string($path) || $path === '') {
            throw new RuntimeException('Gagal menyimpan file lampiran penerimaan.');
        }

        $originalName = basename(str_replace('\\', '/', $file->getClientOriginalName()));
        $originalName = preg_replace('/[\x00-\x1F\x7F]/u', '', $originalName) ?: 'lampiran';
        $originalName = Str::limit($originalName, 255, '');

        try {
            $attachmentId = DB::transaction(function () use ($actor, $storeId, $grId, $file, $path, $originalName) {
                $lockedReceipt = $this->lock($storeId, $grId);
                $this->assertAccess($actor, $storeId, $lockedReceipt);
                $this->assertAttachmentsOpen($lockedReceipt);

                $attachmentId = DB::table('attachments')->insertGetId([
                    'store_id' => $storeId,
                    'entity_type' => 'goods_receipt',
                    'entity_id' => $grId,
                    'file_path' => $path,
                    'original_name' => $originalName,
                    'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
                    'size_bytes' => (int) $file->getSize(),
                    'uploaded_by' => $actor->id,
                ]);

                $this->audit->log(
                    'goods_receipt.attach',
                    'goods_receipt',
                    $grId,
                    after: [
                        'attachment_id' => $attachmentId,
                        'original_name' => $originalName,
                        'mime_type' => $file->getMimeType(),
                        'size_bytes' => (int) $file->getSize(),
                    ],
                    actorId: $actor->id,
                    storeId: $storeId,
                );

                return $attachmentId;
            });
        } catch (Throwable $exception) {
            if (! Storage::disk('local')->delete($path)) {
                Log::error('Failed to remove an unrecorded goods receipt attachment.', [
                    'goods_receipt_id' => $grId,
                    'path' => $path,
                ]);
            }

            throw $exception;
        }

        return $this->attachmentDetails($storeId, $grId, $attachmentId)
            ?? throw new RuntimeException('Lampiran tersimpan tetapi tidak dapat dibaca kembali.');
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findAttachment(User $user, int $storeId, int $grId, int $attachmentId): ?array
    {
        $gr = DB::table('goods_receipts')
            ->where('store_id', $storeId)
            ->where('id', $grId)
            ->first();

        if ($gr === null || (! $this->canVerify($user, $storeId) && (int) $gr->received_by !== $user->id)) {
            return null;
        }

        $attachment = DB::table('attachments')
            ->where('store_id', $storeId)
            ->where('entity_type', 'goods_receipt')
            ->where('entity_id', $grId)
            ->where('id', $attachmentId)
            ->first(['file_path', 'original_name', 'mime_type']);

        if ($attachment === null) {
            return null;
        }

        return [
            'file_path' => $attachment->file_path,
            'original_name' => $attachment->original_name,
            'mime_type' => $attachment->mime_type,
        ];
    }

    /**
     * Memposting GR: stok bertambah (batch + saldo + pergerakan + HPP), qty PO terpenuhi, status PO diperbarui. Atomik.
     *
     * @return array<string, mixed>
     */
    public function post(User $actor, int $storeId, int $id): array
    {
        $outcome = DB::transaction(function () use ($actor, $storeId, $id) {
            $gr = $this->lock($storeId, $id);
            $this->assertAccess($actor, $storeId, $gr);

            if (! in_array($gr->status, ['draft', 'checked'], true)) {
                throw ValidationException::withMessages(['status' => ['Penerimaan ini sudah diposting atau dibatalkan.']]);
            }

            $po = DB::table('purchase_orders')->where('id', $gr->po_id)->lockForUpdate()->first();

            if (! in_array($po->status, PurchaseOrderService::RECEIVABLE, true)) {
                throw ValidationException::withMessages(['po_id' => ['PO sudah tidak dapat menerima barang.']]);
            }

            $this->receivingLocationId($storeId, (int) $gr->receiving_location_id);
            $poItems = DB::table('purchase_order_items')->where('po_id', $po->id)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $items = DB::table('goods_receipt_items')->where('gr_id', $id)->orderBy('id')->get();
            $products = DB::table('products')->whereIn('id', $items->pluck('product_id')->unique()->all())->get(['id', 'name', 'status'])->keyBy('id');
            $today = $this->todayWib();

            // 1. validasi ulang terhadap keadaan terkini (GR lain mungkin sudah diposting)
            $errors = [];
            $take = [];

            foreach ($items->values() as $i => $item) {
                $take[$item->po_item_id] = ($take[$item->po_item_id] ?? 0) + Decimal::qty($item->qty_received) + Decimal::qty($item->qty_damaged);

                if ($products->get($item->product_id)->status === 'inactive') {
                    $errors["items.{$i}.po_item_id"] = ['Produk nonaktif tidak dapat diterima.'];
                }

                if ($item->shelf_position_id !== null && ! $this->positionBelongsToLocation((int) $item->shelf_position_id, (int) $gr->receiving_location_id)) {
                    $errors["items.{$i}.shelf_position_id"] = ['Posisi rak tidak aktif atau tidak valid untuk lokasi penerimaan.'];
                }

                if (Decimal::qty($item->qty_received) > 0 && $item->expiry_date !== null && $item->expiry_date < $today) {
                    $errors["items.{$i}.expiry_date"] = ['Barang sudah kedaluwarsa; catat sebagai rusak, bukan diterima layak jual.'];
                }
            }

            $remainingBefore = [];
            foreach ($take as $poItemId => $units) {
                $poItem = $poItems->get($poItemId);
                $remainingBefore[$poItemId] = Decimal::qty($poItem->qty_ordered) - Decimal::qty($poItem->qty_received);

                if ($units > $remainingBefore[$poItemId]) {
                    $errors['items'] = ['Jumlah penerimaan melebihi sisa pesanan PO (sisa '.Decimal::qtyString(max(0, $remainingBefore[$poItemId])).' untuk salah satu baris).'];
                }
            }

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            // 2. stok masuk; produk diurutkan menurut id agar urutan kunci konsisten (anti-deadlock)
            $ordered = $items->all();
            usort($ordered, fn ($a, $b) => [$a->product_id, $a->id] <=> [$b->product_id, $b->id]);

            $lines = [];
            $receivedByPoItem = [];
            $damagedUnits = 0;

            foreach ($ordered as $item) {
                $received = Decimal::qty($item->qty_received);
                $damagedUnits += Decimal::qty($item->qty_damaged);

                if ($received <= 0) {
                    continue;
                }

                $in = $this->inventory->receive(
                    $storeId,
                    (int) $item->product_id,
                    (string) $item->qty_received,
                    (string) $item->unit_cost,
                    $item->expiry_date,
                    $item->batch_code,
                    (int) $item->id,
                    'goods_receipt',
                    $id,
                    $actor->id,
                    (int) $gr->receiving_location_id,
                    $item->shelf_position_id === null ? null : (int) $item->shelf_position_id,
                );

                $receivedByPoItem[$item->po_item_id] = ($receivedByPoItem[$item->po_item_id] ?? 0) + $received;
                $lines[] = [
                    'product_id' => (int) $item->product_id,
                    'batch_id' => $in['batch_id'],
                    'qty' => Decimal::qtyString($received),
                    'unit_cost' => $item->unit_cost,
                ];
            }

            // 3. qty PO dan status PO; qty_short = sisa pesanan setelah penerimaan ini (dicatat di baris GR pertama per baris PO)
            $allDone = true;
            $anyReceived = false;

            foreach ($poItems as $poItemId => $poItem) {
                $newReceived = Decimal::qty($poItem->qty_received) + ($receivedByPoItem[$poItemId] ?? 0);

                if (isset($receivedByPoItem[$poItemId])) {
                    DB::table('purchase_order_items')->where('id', $poItemId)->update(['qty_received' => Decimal::qtyString($newReceived)]);
                }

                $allDone = $allDone && $newReceived >= Decimal::qty($poItem->qty_ordered);
                $anyReceived = $anyReceived || $newReceived > 0;
            }

            $firstRowOfPoItem = [];
            foreach ($items as $item) {
                $firstRowOfPoItem[$item->po_item_id] ??= $item->id;
            }
            foreach ($take as $poItemId => $units) {
                DB::table('goods_receipt_items')->where('id', $firstRowOfPoItem[$poItemId])->update([
                    'qty_short' => Decimal::qtyString(max(0, $remainingBefore[$poItemId] - $units)),
                ]);
            }

            $poStatus = $po->status;
            $receiptStatus = $po->receipt_status;

            if ($allDone) {
                $poStatus = 'received';
                $receiptStatus = 'complete';
            } elseif ($anyReceived) {
                $poStatus = 'partially_received';
                $receiptStatus = 'partial';
            }

            if ($poStatus !== $po->status || $receiptStatus !== $po->receipt_status) {
                DB::table('purchase_orders')->where('id', $po->id)->update(['status' => $poStatus, 'receipt_status' => $receiptStatus]);
            }

            DB::table('goods_receipts')->where('id', $id)->update(['status' => 'posted', 'posted_at' => $this->nowUtc()]);

            $this->audit->log(
                'goods_receipt.post',
                'goods_receipt',
                $id,
                before: ['status' => $gr->status],
                after: ['status' => 'posted', 'po_status' => $poStatus, 'lines' => $lines],
                actorId: $actor->id,
                storeId: $storeId,
            );

            return ['doc_number' => $gr->doc_number, 'damaged' => $damagedUnits > 0];
        });

        if ($outcome['damaged']) {
            $this->notifications->notifyPermission(
                $storeId,
                'purchase_order.create',
                'goods_receipt.damaged',
                "Penerimaan {$outcome['doc_number']} mencatat barang rusak; tindak lanjuti ke supplier.",
                'goods_receipt',
                $id,
                $actor->id,
            );
        }

        return $this->load($storeId, $id, $this->canVerify($actor, $storeId)) ?? [];
    }

    /**
     * Verifikasi surat jalan dan faktur (goods_receipt.verify_documents). Keduanya wajib terisi.
     *
     * @param  array<string, mixed>  $data  delivery_note_no?, invoice_no?
     * @return array<string, mixed>
     */
    public function verifyDocuments(User $actor, int $storeId, int $id, array $data): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $data) {
            $gr = $this->lock($storeId, $id);

            if ($gr->status !== 'posted') {
                throw ValidationException::withMessages(['status' => ['Dokumen hanya dapat diverifikasi setelah penerimaan diposting.']]);
            }

            if ($gr->document_status === 'verified') {
                throw ValidationException::withMessages(['document_status' => ['Dokumen sudah diverifikasi.']]);
            }

            $deliveryNote = trim((string) ($data['delivery_note_no'] ?? $gr->delivery_note_no ?? ''));
            $invoice = trim((string) ($data['invoice_no'] ?? $gr->invoice_no ?? ''));

            $errors = [];
            if ($deliveryNote === '') {
                $errors['delivery_note_no'] = ['Nomor surat jalan wajib diisi.'];
            }
            if ($invoice === '') {
                $errors['invoice_no'] = ['Nomor faktur wajib diisi.'];
            }
            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            DB::table('goods_receipts')->where('id', $id)->update([
                'delivery_note_no' => $deliveryNote,
                'invoice_no' => $invoice,
                'document_status' => 'verified',
                'verified_by' => $actor->id,
                'verified_at' => $this->nowUtc(),
            ]);

            $this->audit->log(
                'goods_receipt.verify_documents',
                'goods_receipt',
                $id,
                before: ['document_status' => 'pending'],
                after: ['document_status' => 'verified', 'delivery_note_no' => $deliveryNote, 'invoice_no' => $invoice],
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id, true) ?? [];
    }

    /** @return array<string, mixed> */
    public function cancel(User $actor, int $storeId, int $id, ?string $reason): array
    {
        DB::transaction(function () use ($actor, $storeId, $id, $reason) {
            $gr = $this->lock($storeId, $id);
            $this->assertAccess($actor, $storeId, $gr);

            if (! in_array($gr->status, ['draft', 'checked'], true)) {
                throw ValidationException::withMessages(['status' => ['Hanya penerimaan draft yang dapat dibatalkan. Koreksi penerimaan terposting lewat dokumen koreksi.']]);
            }

            DB::table('goods_receipts')->where('id', $id)->update(['status' => 'cancelled']);

            $this->audit->log(
                'goods_receipt.cancel',
                'goods_receipt',
                $id,
                before: ['status' => $gr->status],
                after: ['status' => 'cancelled'],
                reason: $reason,
                actorId: $actor->id,
                storeId: $storeId,
            );
        });

        return $this->load($storeId, $id, $this->canVerify($actor, $storeId)) ?? [];
    }

    // ------------------------------------------------------------------ internal

    private function canVerify(User $user, int $storeId): bool
    {
        return $this->permissions->allows($user, 'goods_receipt.verify_documents', $storeId);
    }

    private function assertAccess(User $actor, int $storeId, object $gr): void
    {
        abort_unless(
            (int) $gr->received_by === $actor->id || $this->canVerify($actor, $storeId),
            403,
            'Anda tidak berwenang mengelola penerimaan ini.',
        );
    }

    private function assertAttachmentsOpen(object $gr): void
    {
        if ($gr->status === 'cancelled' || $gr->document_status === 'verified') {
            throw ValidationException::withMessages([
                'status' => ['Lampiran tidak dapat ditambahkan setelah penerimaan dibatalkan atau dokumennya diverifikasi.'],
            ]);
        }
    }

    /** @return array<string, mixed>|null */
    private function attachmentDetails(int $storeId, int $grId, int $attachmentId): ?array
    {
        $attachment = DB::table('attachments as a')
            ->join('users as u', 'u.id', '=', 'a.uploaded_by')
            ->where('a.store_id', $storeId)
            ->where('a.entity_type', 'goods_receipt')
            ->where('a.entity_id', $grId)
            ->where('a.id', $attachmentId)
            ->first(['a.id', 'a.original_name', 'a.mime_type', 'a.size_bytes', 'a.created_at', 'u.name as uploaded_by_name']);

        if ($attachment === null) {
            return null;
        }

        return [
            'id' => (int) $attachment->id,
            'original_name' => $attachment->original_name,
            'mime_type' => $attachment->mime_type,
            'size_bytes' => (int) $attachment->size_bytes,
            'uploaded_by_name' => $attachment->uploaded_by_name,
            'created_at' => $attachment->created_at,
        ];
    }

    /** @return list<array<string, mixed>> */
    private function attachments(int $storeId, int $grId): array
    {
        return DB::table('attachments as a')
            ->join('users as u', 'u.id', '=', 'a.uploaded_by')
            ->where('a.store_id', $storeId)
            ->where('a.entity_type', 'goods_receipt')
            ->where('a.entity_id', $grId)
            ->orderBy('a.id')
            ->get(['a.id', 'a.original_name', 'a.mime_type', 'a.size_bytes', 'a.created_at', 'u.name as uploaded_by_name'])
            ->map(fn ($attachment) => [
                'id' => (int) $attachment->id,
                'original_name' => $attachment->original_name,
                'mime_type' => $attachment->mime_type,
                'size_bytes' => (int) $attachment->size_bytes,
                'uploaded_by_name' => $attachment->uploaded_by_name,
                'created_at' => $attachment->created_at,
            ])->all();
    }

    private function lock(int $storeId, int $id): object
    {
        $gr = DB::table('goods_receipts')->where('store_id', $storeId)->where('id', $id)->lockForUpdate()->first();

        abort_if($gr === null, 404, 'Penerimaan tidak ditemukan.');

        return $gr;
    }

    private function receivingLocationId(int $storeId, ?int $requestedLocationId = null): int
    {
        if ($requestedLocationId === null) {
            return $this->inventory->sellingLocationId($storeId);
        }

        $location = DB::table('locations')
            ->where('store_id', $storeId)->where('id', $requestedLocationId)->first();

        if ($location === null || ! (bool) $location->is_active) {
            throw ValidationException::withMessages([
                'receiving_location_id' => ['Lokasi penerimaan tidak ditemukan atau nonaktif pada toko ini.'],
            ]);
        }

        if ($location->type === 'warehouse' && ! (bool) $this->setting($storeId, 'warehouse_enabled', false)) {
            throw ValidationException::withMessages([
                'receiving_location_id' => ['Penerimaan ke gudang memerlukan warehouse_enabled aktif.'],
            ]);
        }

        return (int) $location->id;
    }

    /**
     * Validasi baris penerimaan terhadap PO dan produk. Mengembalikan baris siap simpan ke goods_receipt_items (tanpa gr_id).
     *
     * @param  Collection<int, object>  $poItems  baris PO, kunci = id
     * @param  list<array<string, mixed>>  $items
     * @return list<array<string, mixed>>
     */
    private function normalizeItems(User $actor, int $storeId, int $locationId, $poItems, array $items): array
    {
        $productIds = [];
        foreach ($items as $item) {
            $poItem = $poItems->get((int) $item['po_item_id']);
            if ($poItem !== null) {
                $productIds[] = (int) $poItem->product_id;
            }
        }

        $products = DB::table('products')->where('store_id', $storeId)->whereIn('id', array_unique($productIds))
            ->get(['id', 'name', 'status', 'track_expiry'])->keyBy('id');

        $canVerify = $this->canVerify($actor, $storeId);
        $today = $this->todayWib();
        $errors = [];
        $take = [];
        $rows = [];

        foreach (array_values($items) as $i => $item) {
            $poItem = $poItems->get((int) $item['po_item_id']);

            if ($poItem === null) {
                $errors["items.{$i}.po_item_id"] = ['Baris PO tidak ditemukan pada PO ini.'];

                continue;
            }

            $product = $products->get((int) $poItem->product_id);

            if ($product === null || $product->status === 'inactive') {
                $errors["items.{$i}.po_item_id"] = ['Produk tidak ditemukan atau nonaktif.'];

                continue;
            }

            $received = Decimal::qty($item['qty_received']);
            $damaged = Decimal::qty($item['qty_damaged'] ?? 0);

            if ($received <= 0 && $damaged <= 0) {
                $errors["items.{$i}.qty_received"] = ['Isi jumlah diterima atau jumlah rusak.'];

                continue;
            }

            $take[$poItem->id] = ($take[$poItem->id] ?? 0) + $received + $damaged;
            $remaining = Decimal::qty($poItem->qty_ordered) - Decimal::qty($poItem->qty_received);

            if ($take[$poItem->id] > $remaining) {
                $errors["items.{$i}.qty_received"] = ["Melebihi sisa pesanan PO untuk {$product->name} (sisa ".Decimal::qtyString(max(0, $remaining)).').'];

                continue;
            }

            $expiry = $item['expiry_date'] ?? null;

            if ($expiry !== null && ! $product->track_expiry) {
                $errors["items.{$i}.expiry_date"] = ["Produk {$product->name} tidak melacak tanggal kadaluarsa."];

                continue;
            }

            if ($received > 0 && $product->track_expiry && $expiry === null) {
                $errors["items.{$i}.expiry_date"] = ["Tanggal kadaluarsa wajib diisi untuk {$product->name}."];

                continue;
            }

            if ($received > 0 && $expiry !== null && $expiry < $today) {
                $errors["items.{$i}.expiry_date"] = ['Barang sudah kedaluwarsa; catat sebagai rusak, bukan diterima layak jual.'];

                continue;
            }

            $poPrice = Decimal::money($poItem->unit_price);
            $cost = $poPrice;

            if (isset($item['unit_cost']) && $item['unit_cost'] !== '') {
                $cost = Decimal::money($item['unit_cost']);

                if ($cost !== $poPrice) {
                    abort_unless($canVerify, 403, 'Harga beli hanya dapat diubah oleh pemegang goods_receipt.verify_documents.');
                }
            }

            $positionId = ! empty($item['shelf_position_id']) ? (int) $item['shelf_position_id'] : null;

            if ($positionId !== null && ! $this->positionBelongsToLocation($positionId, $locationId)) {
                $errors["items.{$i}.shelf_position_id"] = ['Posisi rak tidak valid untuk lokasi penerimaan.'];

                continue;
            }

            $rows[] = [
                'po_item_id' => (int) $poItem->id,
                'product_id' => (int) $poItem->product_id,
                'qty_ordered' => $poItem->qty_ordered,
                'qty_received' => Decimal::qtyString($received),
                'qty_damaged' => Decimal::qtyString($damaged),
                'qty_short' => '0.000',
                'unit_cost' => Decimal::moneyString($cost),
                'expiry_date' => $expiry,
                'batch_code' => $item['batch_code'] ?? null,
                'shelf_position_id' => $positionId,
                'note' => $item['note'] ?? null,
            ];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $rows;
    }

    private function positionBelongsToLocation(int $positionId, int $locationId): bool
    {
        return DB::table('shelf_positions as sp')
            ->join('shelves as s', 's.id', '=', 'sp.shelf_id')
            ->where('sp.id', $positionId)->where('s.location_id', $locationId)->where('s.is_active', 1)
            ->exists();
    }

    /** @return array<string, mixed>|null */
    private function load(int $storeId, int $id, bool $prices): ?array
    {
        $gr = DB::table('goods_receipts as gr')
            ->join('purchase_orders as po', 'po.id', '=', 'gr.po_id')
            ->join('suppliers as s', 's.id', '=', 'gr.supplier_id')
            ->join('users as u', 'u.id', '=', 'gr.received_by')
            ->join('locations as l', 'l.id', '=', 'gr.receiving_location_id')
            ->leftJoin('users as v', 'v.id', '=', 'gr.verified_by')
            ->where('gr.store_id', $storeId)->where('gr.id', $id)
            ->first(['gr.*', 'po.doc_number as po_doc_number', 's.name as supplier_name', 'l.name as receiving_location_name', 'u.name as received_by_name', 'v.name as verified_by_name']);

        if ($gr === null) {
            return null;
        }

        $items = DB::table('goods_receipt_items as i')
            ->join('products as p', 'p.id', '=', 'i.product_id')
            ->join('purchase_order_items as poi', 'poi.id', '=', 'i.po_item_id')
            ->where('i.gr_id', $id)->orderBy('i.id')
            ->get(['i.*', 'p.sku', 'p.name', 'p.unit_name', 'poi.unit_price as po_unit_price'])
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'po_item_id' => (int) $row->po_item_id,
                'product_id' => (int) $row->product_id,
                'sku' => $row->sku,
                'name' => $row->name,
                'unit_name' => $row->unit_name,
                'qty_ordered' => $row->qty_ordered,
                'qty_received' => $row->qty_received,
                'qty_damaged' => $row->qty_damaged,
                'qty_short' => $row->qty_short,
                'unit_cost' => $prices ? $row->unit_cost : null,
                'po_unit_price' => $prices ? $row->po_unit_price : null,
                'price_variance' => $prices ? Decimal::moneyString(Decimal::money($row->unit_cost) - Decimal::money($row->po_unit_price)) : null,
                'expiry_date' => $row->expiry_date,
                'batch_code' => $row->batch_code,
                'shelf_position_id' => $row->shelf_position_id === null ? null : (int) $row->shelf_position_id,
                'note' => $row->note,
            ])->all();

        return [
            'id' => (int) $gr->id,
            'doc_number' => $gr->doc_number,
            'po_id' => (int) $gr->po_id,
            'po_doc_number' => $gr->po_doc_number,
            'supplier_id' => (int) $gr->supplier_id,
            'supplier_name' => $gr->supplier_name,
            'delivery_note_no' => $gr->delivery_note_no,
            'invoice_no' => $gr->invoice_no,
            'receiving_location_id' => (int) $gr->receiving_location_id,
            'receiving_location_name' => $gr->receiving_location_name,
            'status' => $gr->status,
            'document_status' => $gr->document_status,
            'received_by' => (int) $gr->received_by,
            'received_by_name' => $gr->received_by_name,
            'posted_at' => $gr->posted_at,
            'verified_by' => $gr->verified_by === null ? null : (int) $gr->verified_by,
            'verified_by_name' => $gr->verified_by_name,
            'verified_at' => $gr->verified_at,
            'note' => $gr->note,
            'created_at' => $gr->created_at,
            'items' => $items,
            'attachments' => $this->attachments($storeId, $id),
        ];
    }
}
