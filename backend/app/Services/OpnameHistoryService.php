<?php

namespace App\Services;

use App\Models\User;
use App\Support\Decimal;
use Carbon\Carbon;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

class OpnameHistoryService
{
    public function __construct(
        private PermissionResolver $permissions,
        private AuditLogger $audit,
        private OpnameReportBuilder $reports,
    ) {}

    /** @param array<string, mixed> $filters
     * @return array{periods: list<array<string, mixed>>, next_cursor?: string}
     */
    public function periods(User $user, int $storeId, array $filters): array
    {
        $group = $filters['group'] ?? 'month';
        $timezone = $this->timezone($storeId);
        $sessions = DB::table('stock_opname_sessions')
            ->where('store_id', $storeId)
            ->select(['id', 'status', 'started_at', 'posted_at', 'variance_products', 'short_qty', 'over_qty', 'abs_value']);
        if (! empty($filters['status'])) {
            $sessions->where('status', $filters['status']);
        }
        if (! empty($filters['scope_type'])) {
            $sessions->where('scope_type', $filters['scope_type']);
        }
        if (($filters['result'] ?? null) === 'clean') {
            $sessions->where('status', 'posted')->where('variance_products', 0);
        } elseif (($filters['result'] ?? null) === 'variance') {
            $sessions->where('status', 'posted')->where('variance_products', '>', 0);
        }
        $this->applyDateRange($sessions, $filters['date_from'] ?? null, $filters['date_to'] ?? null, $timezone);
        $buckets = [];

        foreach ($sessions->orderByDesc('started_at')->get() as $session) {
            $date = $session->status === 'posted' && $session->posted_at
                ? $session->posted_at
                : $session->started_at;
            $localDate = Carbon::parse($date, 'UTC')->setTimezone($timezone);
            $key = $this->periodKey($localDate, $group);
            $buckets[$key] ??= [
                'period_key' => $key,
                'label' => $this->periodLabel($localDate, $group),
                'sessions_total' => 0,
                'sessions_posted' => 0,
                'sessions_clean' => 0,
                'variance_products' => 0,
                'short_qty_units' => 0,
                'over_qty_units' => 0,
                'abs_value_units' => 0,
                'last_posted_at' => null,
            ];
            $buckets[$key]['sessions_total']++;
            if ($session->status !== 'posted') {
                continue;
            }

            $buckets[$key]['sessions_posted']++;
            $varianceProducts = (int) ($session->variance_products ?? 0);
            $buckets[$key]['sessions_clean'] += $varianceProducts === 0 ? 1 : 0;
            $buckets[$key]['variance_products'] += $varianceProducts;
            $buckets[$key]['short_qty_units'] += Decimal::qty((string) ($session->short_qty ?? '0'));
            $buckets[$key]['over_qty_units'] += Decimal::qty((string) ($session->over_qty ?? '0'));
            $buckets[$key]['abs_value_units'] += Decimal::money((string) ($session->abs_value ?? '0'));
            if ($buckets[$key]['last_posted_at'] === null
                || strcmp((string) $session->posted_at, $buckets[$key]['last_posted_at']) > 0) {
                $buckets[$key]['last_posted_at'] = $session->posted_at;
            }
        }

        $keys = array_keys($buckets);
        rsort($keys, SORT_STRING);
        if (! empty($filters['cursor'])) {
            $keys = array_values(array_filter($keys, fn (string $key) => strcmp($key, $filters['cursor']) < 0));
        }
        $limit = (int) ($filters['limit'] ?? 12);
        $hasMore = count($keys) > $limit;
        $keys = array_slice($keys, 0, $limit);
        $canViewValue = $this->permissions->allows($user, 'opname.view_value', $storeId);
        $result = ['periods' => []];

        foreach ($keys as $key) {
            $bucket = $buckets[$key];
            $period = [
                'period_key' => $bucket['period_key'],
                'label' => $bucket['label'],
                'sessions_total' => $bucket['sessions_total'],
                'sessions_posted' => $bucket['sessions_posted'],
                'sessions_clean' => $bucket['sessions_clean'],
                'variance_products' => $bucket['variance_products'],
                'short_qty' => Decimal::qtyString($bucket['short_qty_units']),
                'over_qty' => Decimal::qtyString($bucket['over_qty_units']),
                'last_posted_at' => $bucket['last_posted_at'],
            ];
            if ($canViewValue) {
                $period['abs_value'] = Decimal::moneyString($bucket['abs_value_units']);
            }
            $result['periods'][] = $period;
        }

        if ($hasMore && $keys !== []) {
            $result['next_cursor'] = end($keys);
        }

        return $result;
    }

    /** @param array<string, mixed> $filters
     * @return array{items: list<array<string, mixed>>}
     */
    public function frequentVariance(User $user, int $storeId, array $filters): array
    {
        $timezone = $this->timezone($storeId);
        $dateFrom = $filters['date_from'] ?? Carbon::now($timezone)->startOfMonth()->subMonths(5)->toDateString();
        $dateTo = $filters['date_to'] ?? Carbon::now($timezone)->toDateString();
        [$fromUtc, $toUtc] = $this->utcBounds($dateFrom, $dateTo, $timezone);
        $items = DB::table('stock_opname_items as i')
            ->join('stock_opname_sessions as s', 's.id', '=', 'i.session_id')
            ->where('s.store_id', $storeId)
            ->where('s.status', 'posted')
            ->where('s.posted_at', '>=', $fromUtc)
            ->where('s.posted_at', '<', $toUtc)
            ->whereNotNull('i.diff_qty')
            ->where('i.diff_qty', '<>', 0)
            ->when(! empty($filters['scope_type']), fn (Builder $query) => $query->where('s.scope_type', $filters['scope_type']))
            ->when(($filters['status'] ?? null) !== null, fn (Builder $query) => $query->where('s.status', $filters['status']))
            ->when(($filters['result'] ?? null) === 'clean', fn (Builder $query) => $query->whereRaw('1 = 0'))
            ->groupBy('i.product_id')
            ->selectRaw('i.product_id, COUNT(DISTINCT i.session_id) as sessions_with_variance')
            ->selectRaw('SUM(CASE WHEN i.diff_qty < 0 THEN ABS(i.diff_qty) ELSE 0 END) as short_qty')
            ->selectRaw('SUM(CASE WHEN i.diff_qty > 0 THEN i.diff_qty ELSE 0 END) as over_qty')
            ->selectRaw('SUM(COALESCE(i.diff_value, 0)) as value')
            ->selectSub(
                DB::table('stock_opname_items as latest_i')
                    ->join('stock_opname_sessions as latest_s', 'latest_s.id', '=', 'latest_i.session_id')
                    ->whereColumn('latest_i.product_id', 'i.product_id')
                    ->where('latest_s.store_id', $storeId)
                    ->where('latest_s.status', 'posted')
                    ->where('latest_s.posted_at', '>=', $fromUtc)
                    ->where('latest_s.posted_at', '<', $toUtc)
                    ->when(! empty($filters['scope_type']), fn (Builder $query) => $query->where('latest_s.scope_type', $filters['scope_type']))
                    ->orderByDesc('latest_s.posted_at')
                    ->orderByDesc('latest_i.id')
                    ->limit(1)
                    ->select('latest_i.product_name_snapshot'),
                'name',
            )
            ->selectSub(
                DB::table('stock_opname_items as latest_i')
                    ->join('stock_opname_sessions as latest_s', 'latest_s.id', '=', 'latest_i.session_id')
                    ->whereColumn('latest_i.product_id', 'i.product_id')
                    ->where('latest_s.store_id', $storeId)
                    ->where('latest_s.status', 'posted')
                    ->where('latest_s.posted_at', '>=', $fromUtc)
                    ->where('latest_s.posted_at', '<', $toUtc)
                    ->when(! empty($filters['scope_type']), fn (Builder $query) => $query->where('latest_s.scope_type', $filters['scope_type']))
                    ->orderByDesc('latest_s.posted_at')
                    ->orderByDesc('latest_i.id')
                    ->limit(1)
                    ->select('latest_i.barcode_snapshot'),
                'barcode',
            )
            ->orderByDesc('sessions_with_variance')
            ->orderBy('i.product_id')
            ->limit((int) ($filters['limit'] ?? 10))
            ->get();

        $canViewValue = $this->permissions->allows($user, 'opname.view_value', $storeId);

        return ['items' => $items->map(function ($item) use ($canViewValue) {
            $row = [
                'product_id' => (int) $item->product_id,
                'name' => (string) $item->name,
                'barcode' => (string) $item->barcode,
                'sessions_with_variance' => (int) $item->sessions_with_variance,
                'short_qty' => (string) $item->short_qty,
                'over_qty' => (string) $item->over_qty,
            ];
            if ($canViewValue) {
                $row['value'] = (string) $item->value;
            }

            return $row;
        })->all()];
    }

    /** @return array<string, mixed> */
    public function lastStatus(User $user, int $storeId): array
    {
        $settings = DB::table('settings')->where('store_id', $storeId)
            ->whereIn('setting_key', [
                'opname.reminder.enabled',
                'opname.reminder.interval_days',
                'opname.reminder.basis',
            ])->pluck('setting_value', 'setting_key');
        $enabled = $settings->has('opname.reminder.enabled')
            && json_decode((string) $settings->get('opname.reminder.enabled'), true) === true;
        $interval = (int) json_decode((string) $settings->get('opname.reminder.interval_days', '30'), true);
        $basis = (string) json_decode((string) $settings->get('opname.reminder.basis', '"all"'), true);
        $last = DB::table('stock_opname_sessions')->where('store_id', $storeId)->where('status', 'posted')
            ->orderByDesc('posted_at')->first([
                'id', 'number', 'posted_at', 'scope_type', 'variance_products',
            ]);
        $timezone = $this->timezone($storeId);
        $daysSince = $last === null
            ? null
            : Carbon::parse($last->posted_at, 'UTC')->setTimezone($timezone)->startOfDay()
                ->diffInDays(Carbon::now($timezone)->startOfDay());
        $reminderLastQuery = DB::table('stock_opname_sessions')->where('store_id', $storeId)->where('status', 'posted');
        if ($basis === 'all') {
            $reminderLastQuery->where('scope_type', 'all');
        }
        $reminderLast = $reminderLastQuery->orderByDesc('posted_at')->value('posted_at');
        $reminderDaysSince = $reminderLast === null
            ? null
            : Carbon::parse($reminderLast, 'UTC')->setTimezone($timezone)->startOfDay()
                ->diffInDays(Carbon::now($timezone)->startOfDay());

        return [
            'last_posted' => $last === null ? null : [
                'id' => (int) $last->id,
                'number' => $last->number,
                'posted_at' => $last->posted_at,
                'scope_type' => $last->scope_type,
                'clean' => (int) $last->variance_products === 0,
                'variance_products' => (int) $last->variance_products,
            ],
            'days_since' => $daysSince,
            'reminder' => [
                'enabled' => $enabled,
                'interval_days' => $interval,
                'basis' => $basis,
                'due' => $enabled && $reminderDaysSince !== null && $reminderDaysSince >= $interval,
            ],
        ];
    }

    public function exportSession(User $user, int $storeId, int $sessionId, string $part, string $delimiter): Response
    {
        $session = DB::table('stock_opname_sessions')->where('store_id', $storeId)->where('id', $sessionId)->first([
            'id', 'number', 'status',
        ]);
        abort_if($session === null, 404, 'Sesi opname tidak ditemukan.');
        if (! in_array($session->status, ['posted', 'pending_approval'], true)) {
            return response()->json([
                'message' => 'Ekspor tersedia untuk sesi yang sudah diajukan atau diposting.',
                'code' => 'opname_export_unavailable',
            ], 409);
        }

        $separator = $delimiter === 'semicolon' ? ';' : ',';
        $canViewValue = $this->permissions->allows($user, 'opname.view_value', $storeId);
        $this->audit->log(
            'stock_opname.export',
            'stock_opname_session',
            $sessionId,
            after: ['part' => $part, 'delimiter' => $delimiter],
            storeId: $storeId,
            actorId: $user->id,
        );

        return response()->streamDownload(function () use ($user, $storeId, $sessionId, $part, $separator, $canViewValue) {
            $stream = fopen('php://output', 'wb');
            fwrite($stream, "\xEF\xBB\xBF");
            $headers = $part === 'summary'
                ? ['Kategori', 'Sub-kategori', 'Produk dihitung', 'Produk berselisih']
                : ['Kategori', 'Sub-kategori', 'Produk', 'Barcode', 'Stok sistem', 'Hitungan', 'Selisih', 'Arah', 'Dihitung ulang'];
            if ($part === 'detail' && $canViewValue) {
                $headers[] = 'Nilai';
            }
            fputcsv($stream, $headers, $separator, '"', '');
            foreach ($this->sessionExportRows($user, $storeId, $sessionId, $part, $canViewValue) as $row) {
                fputcsv($stream, $row, $separator, '"', '');
            }
            fclose($stream);
        }, "opname-{$session->number}-{$part}.csv", [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    /** @param array<string, mixed> $filters */
    public function exportPeriods(User $user, int $storeId, array $filters): StreamedResponse
    {
        $group = $filters['group'] ?? 'month';
        $summary = $this->periods($user, $storeId, [...$filters, 'limit' => 60]);
        $canViewValue = $this->permissions->allows($user, 'opname.view_value', $storeId);
        $this->audit->log(
            'stock_opname.export_periods',
            'stock_opname_history',
            null,
            after: ['group' => $group, 'date_from' => $filters['date_from'] ?? null, 'date_to' => $filters['date_to'] ?? null],
            storeId: $storeId,
            actorId: $user->id,
        );

        return response()->streamDownload(function () use ($summary, $canViewValue, $filters) {
            $stream = fopen('php://output', 'wb');
            fwrite($stream, "\xEF\xBB\xBF");
            $headers = ['Periode', 'Jumlah sesi', 'Sesi diposting', 'Sesi bersih', 'Produk berselisih', 'Kurang', 'Lebih', 'Posting terakhir'];
            if ($canViewValue) {
                $headers[] = 'Nilai mutlak selisih';
            }
            fputcsv($stream, $headers, ($filters['delimiter'] ?? 'comma') === 'semicolon' ? ';' : ',', '"', '');
            $separator = ($filters['delimiter'] ?? 'comma') === 'semicolon' ? ';' : ',';
            foreach ($summary['periods'] as $period) {
                $row = [
                    $this->safeText($period['label']),
                    $period['sessions_total'],
                    $period['sessions_posted'],
                    $period['sessions_clean'],
                    $period['variance_products'],
                    $period['short_qty'],
                    $period['over_qty'],
                    $period['last_posted_at'] ?? '',
                ];
                if ($canViewValue) {
                    $row[] = $period['abs_value'];
                }
                fputcsv($stream, $row, $separator, '"', '');
            }
            fclose($stream);
        }, 'opname-rekap-'.$group.'-'.Carbon::now($this->timezone($storeId))->format('Y').'.csv', [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    public function timezone(int $storeId): string
    {
        $timezone = DB::table('stores')->where('id', $storeId)->value('timezone');

        return is_string($timezone) && $timezone !== '' ? $timezone : 'Asia/Jakarta';
    }

    private function applyDateRange(Builder $query, ?string $dateFrom, ?string $dateTo, string $timezone): void
    {
        if ($dateFrom === null && $dateTo === null) {
            return;
        }
        [$fromUtc, $toUtc] = $this->utcBounds($dateFrom, $dateTo, $timezone);
        $query->where(function (Builder $base) use ($fromUtc, $toUtc) {
            $base->where(function (Builder $posted) use ($fromUtc, $toUtc) {
                $posted->where('status', 'posted');
                if ($fromUtc !== null) {
                    $posted->where('posted_at', '>=', $fromUtc);
                }
                if ($toUtc !== null) {
                    $posted->where('posted_at', '<', $toUtc);
                }
            })->orWhere(function (Builder $notPosted) use ($fromUtc, $toUtc) {
                $notPosted->where('status', '<>', 'posted');
                if ($fromUtc !== null) {
                    $notPosted->where('started_at', '>=', $fromUtc);
                }
                if ($toUtc !== null) {
                    $notPosted->where('started_at', '<', $toUtc);
                }
            });
        });
    }

    /** @return array{?string, ?string} */
    private function utcBounds(?string $dateFrom, ?string $dateTo, string $timezone): array
    {
        $from = $dateFrom === null ? null : Carbon::createFromFormat('!Y-m-d', $dateFrom, $timezone)->utc()->format('Y-m-d H:i:s');
        $to = $dateTo === null ? null : Carbon::createFromFormat('!Y-m-d', $dateTo, $timezone)->addDay()->utc()->format('Y-m-d H:i:s');

        return [$from, $to];
    }

    private function periodKey(Carbon $date, string $group): string
    {
        return match ($group) {
            'quarter' => $date->format('Y').'-Q'.(int) ceil($date->month / 3),
            'year' => $date->format('Y'),
            default => $date->format('Y-m'),
        };
    }

    private function periodLabel(Carbon $date, string $group): string
    {
        return match ($group) {
            'quarter' => 'Kuartal '.(int) ceil($date->month / 3).' '.$date->format('Y'),
            'year' => $date->format('Y'),
            default => $date->locale('id')->translatedFormat('F Y'),
        };
    }

    private function safeText(string $value): string
    {
        return preg_match('/^[=+\-@\t\r]/', $value) === 1 ? "'".$value : $value;
    }

    /** @return \Generator<int, array<int, string|int|null>> */
    private function sessionExportRows(User $user, int $storeId, int $sessionId, string $part, bool $canViewValue): \Generator
    {
        if ($part === 'summary') {
            $report = $this->reports->build($user, $storeId, $sessionId);
            if ($report === null || ! ($report['complete'] ?? false)) {
                return;
            }
            $walk = function (array $nodes, string $category = '') use (&$walk): \Generator {
                foreach ($nodes as $node) {
                    $name = $category === '' ? $node['name'] : $category;
                    $subcategory = $category === '' ? '' : $node['name'];
                    yield [
                        $this->safeText($name),
                        $this->safeText($subcategory),
                        (int) $node['products_counted'],
                        (int) $node['variance_count'],
                    ];
                    yield from $walk($node['children'] ?? [], $name);
                }
            };
            yield from $walk($report['categories'] ?? []);

            return;
        }

        $items = DB::table('stock_opname_items')
            ->where('session_id', $sessionId)
            ->whereNotNull('diff_qty')
            ->where('diff_qty', '<>', 0)
            ->orderBy('category_parent_name_snapshot')
            ->orderBy('category_name_snapshot')
            ->orderBy('product_name_snapshot')
            ->cursor();
        foreach ($items as $item) {
            $row = [
                $this->safeText((string) ($item->category_parent_name_snapshot ?? $item->category_name_snapshot ?? '')),
                $this->safeText((string) ($item->category_parent_name_snapshot !== null ? $item->category_name_snapshot : '')),
                $this->safeText((string) $item->product_name_snapshot),
                $this->safeText((string) $item->barcode_snapshot),
                (string) $item->system_qty_at_count,
                (string) $item->counted_qty,
                (string) $item->diff_qty,
                Decimal::qty((string) $item->diff_qty) < 0 ? 'Kurang' : 'Lebih',
                (int) $item->revision_count > 0 ? 'Ya' : 'Tidak',
            ];
            if ($canViewValue) {
                $row[] = (string) ($item->diff_value ?? '');
            }
            yield $row;
        }
    }
}
