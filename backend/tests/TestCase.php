<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    /**
     * Pengaman: RefreshDatabase menjalankan migrate:fresh (menghapus semua tabel).
     * Tolak menjalankan test jika database aktif bukan database khusus test (nama berakhiran _test).
     */
    public function createApplication()
    {
        $app = parent::createApplication();

        $connection = $app['config']->get('database.default');
        $database = (string) $app['config']->get("database.connections.{$connection}.database");

        if (! str_ends_with($database, '_test')) {
            throw new RuntimeException(
                "Test ditolak: database '{$database}' bukan database test. ".
                'Atur DB_DATABASE=pos_retail_test (mis. di phpunit.xml) agar data development tidak terhapus.'
            );
        }

        return $app;
    }
}
