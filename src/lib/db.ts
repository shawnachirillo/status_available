import 'server-only';
import { Pool } from 'pg';

const globalForDb = globalThis as unknown as {
  statusDbPool?: Pool;
};

export function getDb() {
  if (!globalForDb.statusDbPool) {
    const password = process.env.STATUS_DATABASE_PASSWORD;

    if (!password) {
      throw new Error('STATUS_DATABASE_PASSWORD is not configured');
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

  return globalForDb.statusDbPool;
}
