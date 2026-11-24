import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

vi.mock('server-only', () => ({}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn()
}));

import { auth } from '@clerk/nextjs/server';
import { getDb } from '../src/lib/db';
import { GET, PUT } from '../src/app/api/draft/route';
import { GET as getRevisions } from '../src/app/api/draft/revisions/route';
import { GET as getWebsites } from '../src/app/api/websites/route';
import { POST as restore } from '../src/app/api/draft/restore/route';

const mockedAuth = auth as unknown as {
  mockResolvedValue: (value: { userId: string }) => void;
};

function request(path: string, method = 'GET', body?: unknown) {
  return new Request('http://localhost' + path, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  });
}

describe('Database-backed authorization edge cases', () => {
  it('isolates revisions and denies inactive website access', async () => {
    if (
      process.env.STATUS_INTEGRATION_TEST_MODE !== 'true' ||
      process.env.STATUS_TEST_DB_HOST !== '127.0.0.1' ||
      process.env.STATUS_TEST_DB_PORT !== '55432' ||
      process.env.STATUS_TEST_DB_NAME !==
        'status_payment_concurrency_test'
    ) {
      throw new Error('STOP: Isolated test database required');
    }

    const db = getDb();
    const client = await db.connect();

    const owner = 'security-edge-' + randomUUID();

    let querySpy: ReturnType<typeof vi.spyOn> | undefined;
    let connectSpy: ReturnType<typeof vi.spyOn> | undefined;

    try {
      const identity = await client.query(
        'SELECT current_database() AS db, current_user AS usr'
      );

      expect(identity.rows[0].db)
        .toBe('status_payment_concurrency_test');

      expect(identity.rows[0].usr).toBe('status_test');

      await client.query('BEGIN');

      const seed = await client.query(`
        SELECT
          w.edition_id AS slug,
          w.edition_catalog_id AS edition_id,
          w.draft_content,
          p.amount_cents,
          p.currency
        FROM public.websites w
        JOIN public.entitlements e ON e.id = w.entitlement_id
        JOIN public.purchases p ON p.id = e.purchase_id
        JOIN public.edition_catalog ec
          ON ec.id = w.edition_catalog_id
        WHERE w.owner_clerk_user_id LIKE 'provision-test-%'
          AND ec.tier = 'Open'
          AND p.status = 'paid'
          AND e.status = 'active'
        LIMIT 1
      `);

      expect(seed.rows).toHaveLength(1);

      const template = seed.rows[0];

      async function fixture(name: string) {
        const purchaseId = randomUUID();
        const entitlementId = randomUUID();
        const websiteId = randomUUID();
        const revisionId = randomUUID();

        const draft = {
          ...template.draft_content,
          edition: template.slug,
          business: name
        };

        await client.query(`
          INSERT INTO public.purchases (
            id, buyer_clerk_user_id, edition_id,
            payment_provider, provider_checkout_id,
            provider_payment_id, status,
            amount_cents, currency, paid_at
          )
          VALUES (
            $1, $2, $3, 'stripe', $4, $5,
            'paid', $6, $7, now()
          )
        `, [
          purchaseId, owner, template.edition_id,
          'cs_test_' + randomUUID(),
          'pi_test_' + randomUUID(),
          template.amount_cents, template.currency
        ]);

        await client.query(`
          INSERT INTO public.entitlements (
            id, purchase_id, edition_id,
            owner_clerk_user_id, status
          )
          VALUES ($1, $2, $3, $4, 'active')
        `, [
          entitlementId, purchaseId,
          template.edition_id, owner
        ]);

        await client.query(`
          INSERT INTO public.websites (
            id, owner_clerk_user_id, edition_id,
            edition_catalog_id, entitlement_id,
            name, draft_content, version,
            publication_status,
            hosting_starts_at, hosting_ends_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            $7::jsonb, 1, 'draft',
            now() - interval '1 day',
            now() + interval '1 year'
          )
        `, [
          websiteId, owner, template.slug,
          template.edition_id, entitlementId,
          name, JSON.stringify(draft)
        ]);

        await client.query(`
          INSERT INTO public.website_revisions (
            id, website_id, content
          )
          VALUES ($1, $2, $3::jsonb)
        `, [
          revisionId, websiteId, JSON.stringify(draft)
        ]);

        return {
          websiteId, entitlementId, revisionId, draft
        };
      }

      const a = await fixture('Security Website A');
      const b = await fixture('Security Website B');

      // Route transactions use savepoints so they cannot
      // commit or roll back the outer fixture transaction.
      const routeClient = {
        query: async (sql: string, params?: unknown[]) => {
          const command = sql.trim().toUpperCase();

          if (command === 'BEGIN') {
            return client.query('SAVEPOINT route_transaction');
          }

          if (command === 'COMMIT') {
            return client.query(
              'RELEASE SAVEPOINT route_transaction'
            );
          }

          if (command === 'ROLLBACK') {
            await client.query(
              'ROLLBACK TO SAVEPOINT route_transaction'
            );

            return client.query(
              'RELEASE SAVEPOINT route_transaction'
            );
          }

          return client.query(sql, params);
        },

        release: () => {}
      };

      querySpy = vi.spyOn(db, 'query');

      querySpy.mockImplementation(
        ((sql: string, params?: unknown[]) =>
          client.query(sql, params)) as any
      );

      connectSpy = vi.spyOn(db, 'connect');

      connectSpy.mockImplementation(
        (async () =>
          routeClient as unknown as PoolClient) as any
      );

      mockedAuth.mockResolvedValue({ userId: owner });

      const readDraft = (id: string) =>
        GET(request('/api/draft?websiteId=' + id));

      const history = (id: string) =>
        getRevisions(request(
          '/api/draft/revisions?websiteId=' + id
        ));

      const saveA = () => PUT(request(
        '/api/draft',
        'PUT',
        {
          websiteId: a.websiteId,
          draft: { ...a.draft, business: 'Rejected edit' },
          expectedVersion: 1
        }
      ));

      const restoreA = (revisionId: string) =>
        restore(request('/api/draft/restore', 'POST', {
          websiteId: a.websiteId,
          revisionId,
          expectedVersion: 1
        }));

      async function snapshot() {
        const result = await client.query(`
          SELECT
            w.id, w.version, w.draft_content, w.name,
            (
              SELECT count(*)
              FROM public.website_revisions r
              WHERE r.website_id = w.id
            ) AS revision_count
          FROM public.websites w
          WHERE w.id = ANY($1::uuid[])
          ORDER BY w.id
        `, [[a.websiteId, b.websiteId]]);

        return result.rows;
      }

      async function assertDenied() {
        expect((await readDraft(a.websiteId)).status)
          .toBe(404);

        expect((await history(a.websiteId)).status)
          .toBe(404);

        expect((await saveA()).status).toBe(404);

        expect((await restoreA(a.revisionId)).status)
          .toBe(404);

        const listing = await getWebsites();
        expect(listing.status).toBe(200);

        const body = await listing.json();

        expect(body.websites.map((w: any) => w.id))
          .not.toContain(a.websiteId);

        expect(body.websites.map((w: any) => w.id))
          .toContain(b.websiteId);

        expect((await readDraft(b.websiteId)).status)
          .toBe(200);
      }

      // Positive controls: both websites are accessible.
      expect((await readDraft(a.websiteId)).status).toBe(200);
      expect((await readDraft(b.websiteId)).status).toBe(200);

      const historyA = await history(a.websiteId);
      const historyB = await history(b.websiteId);

      expect(historyA.status).toBe(200);
      expect(historyB.status).toBe(200);

      expect((await historyA.json()).revisions
        .map((r: any) => r.id)).toContain(a.revisionId);

      expect((await historyB.json()).revisions
        .map((r: any) => r.id)).toContain(b.revisionId);

      const baseline = await snapshot();

      // Existing revision, wrong website, same owner.
      const wrongRevision = await restoreA(b.revisionId);

      expect(wrongRevision.status).toBe(404);
      expect((await wrongRevision.json()).error)
        .toBe('Revision not found');

      expect(await snapshot()).toEqual(baseline);

      console.log('PASS: Same-owner cross-website revision denied');

      // Suspended entitlement.
      await client.query(`
        UPDATE public.entitlements
        SET status = 'suspended'
        WHERE id = $1
      `, [a.entitlementId]);

      await assertDenied();

      expect(await snapshot()).toEqual(baseline);

      console.log('PASS: Suspended entitlement denied across APIs');

      // Restore entitlement before testing expiration.
      await client.query(`
        UPDATE public.entitlements
        SET status = 'active'
        WHERE id = $1
      `, [a.entitlementId]);

      expect((await readDraft(a.websiteId)).status).toBe(200);

      // Expired hosting.
      await client.query(`
        UPDATE public.websites
        SET hosting_starts_at = now() - interval '2 years',
            hosting_ends_at = now() - interval '1 year'
        WHERE id = $1
      `, [a.websiteId]);

      await assertDenied();

      expect(await snapshot()).toEqual(baseline);

      console.log('PASS: Expired hosting denied across APIs');
      console.log('PASS: Unaffected website remains accessible');
      console.log('PASS: Rejected mutations preserve stored data');

    } finally {
      querySpy?.mockRestore();
      connectSpy?.mockRestore();

      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }

    const remaining = await db.query(`
      SELECT count(*)::int AS count
      FROM public.purchases
      WHERE buyer_clerk_user_id = $1
    `, [owner]);

    expect(remaining.rows[0].count).toBe(0);

    console.log('PASS: Temporary security fixtures rolled back');
  });
});
