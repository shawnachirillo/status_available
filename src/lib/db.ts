import 'server-only';
import { lstatSync } from 'node:fs';
import { Pool } from 'pg';

const globalForDb = globalThis as unknown as {
  statusDbPool?: Pool;
};

export function getDb() {
  if (!globalForDb.statusDbPool) {
    const integrationTestMode =
      process.env.STATUS_INTEGRATION_TEST_MODE === 'true';

    const socket = process.env.STATUS_TEST_DB_SOCKET;
    if (!integrationTestMode && (socket !== undefined || process.env.STATUS_TEST_DB_HOST !== undefined ||
        process.env.STATUS_TEST_DB_PORT !== undefined || process.env.STATUS_TEST_DB_NAME !== undefined ||
        process.env.VITEST === 'true')) {
      throw new Error('Integration tests require explicit test mode');
    }

    if (integrationTestMode) {
      const host = process.env.STATUS_TEST_DB_HOST;
      const port = Number(process.env.STATUS_TEST_DB_PORT);
      const database = process.env.STATUS_TEST_DB_NAME;

      if (
        port !== 55432 ||
        database !== 'status_payment_concurrency_test' ||
        (socket === undefined ? host !== '127.0.0.1' : host !== undefined)
      ) {
        throw new Error('Integration tests must use isolated local PostgreSQL');
      }

      if (socket !== undefined) {
        if (!/^\/tmp\/status-test-[A-Za-z0-9]{6}\/socket$/.test(socket)) {
          throw new Error('Use the socket created by the verification runner');
        }

        const directory = lstatSync(socket);
        if (!directory.isDirectory() || directory.uid !== process.getuid?.() ||
            (directory.mode & 0o777) !== 0o700) {
          throw new Error('Verification socket directory must be private and owned by the runner');
        }
      }

      globalForDb.statusDbPool = new Pool({
        host: socket ?? host,
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
