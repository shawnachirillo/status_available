import 'server-only';
import { Pool } from 'pg';

const globalForDb = globalThis as unknown as {
  statusDbPool?: Pool;
};

export function getDb() {
  if (!globalForDb.statusDbPool) {
    const integrationTestMode =
      process.env.STATUS_INTEGRATION_TEST_MODE === 'true';

    if (integrationTestMode) {
      const host = process.env.STATUS_TEST_DB_HOST;
      const port = Number(process.env.STATUS_TEST_DB_PORT);
      const database = process.env.STATUS_TEST_DB_NAME;

      if (
        host !== '127.0.0.1' ||
        port !== 55432 ||
        database !== 'status_payment_concurrency_test'
      ) {
        throw new Error(
          'Integration tests must use isolated local PostgreSQL'
        );
      }

      globalForDb.statusDbPool = new Pool({
        host,
        port,
        database,
        user: 'status_test',
        ssl: false,
        max: 5,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
      });
    } else {
      const password = process.env.STATUS_DATABASE_PASSWORD;

      if (!password) {
        throw new Error('STATUS_DATABASE_PASSWORD is required');
      }

      globalForDb.statusDbPool = new Pool({
        host: 'aws-1-us-east-1.pooler.supabase.com',
        port: 5432,
        database: 'postgres',
        user: 'postgres.qzedqrcetfakjvnfhsjk',
        password,
        ssl: { rejectUnauthorized: true },
        max: 5,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
      });
    }
  }

  return globalForDb.statusDbPool;
}
