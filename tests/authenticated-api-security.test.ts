import { beforeAll, describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({
    userId: 'security-test-outsider'
  }))
}));

import { GET as getDraft } from '../src/app/api/draft/route';
import { GET as getRevisions } from '../src/app/api/draft/revisions/route';
import { GET as getWebsites } from '../src/app/api/websites/route';

beforeAll(() => {
  if (process.env.STATUS_INTEGRATION_TEST_MODE !== 'true') {
    throw new Error('Run authenticated API tests through the isolated verification runner');
  }
});

describe('Authenticated API authorization', () => {
  it('rejects invalid website identifiers', async () => {
    const response = await getDraft(
      new Request('http://localhost/api/draft?websiteId=invalid')
    );

    expect(response.status).toBe(400);
  });

  it('rejects invalid revision-history identifiers', async () => {
    const response = await getRevisions(
      new Request(
        'http://localhost/api/draft/revisions?websiteId=invalid'
      )
    );

    expect(response.status).toBe(400);
  });

  it('does not expose purchased websites to an unrelated customer', async () => {
    const response = await getWebsites();

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(Array.isArray(body.websites)).toBe(true);
    expect(body.websites).toHaveLength(0);
  });
});


// STEP 55Q.20AN: Cross-account route tests
describe('Cross-account website isolation', () => {
  async function fixtureWebsiteId(): Promise<string> {
    const { getDb } = await import('../src/lib/db');
    const result = await getDb().query<{ id: string }>(
      `SELECT w.id
       FROM public.websites w
       JOIN public.entitlements e ON e.id = w.entitlement_id
       JOIN public.purchases p ON p.id = e.purchase_id
       WHERE w.owner_clerk_user_id LIKE 'provision-test-%'
         AND e.status = 'active'
         AND p.status = 'paid'
         AND w.publication_status IN ('draft', 'published')
         AND public.website_hosting_operational(
           w.hosting_starts_at, w.hosting_ends_at, clock_timestamp()
         )
       ORDER BY w.created_at DESC
       LIMIT 1`
    );

    expect(result.rows).toHaveLength(1);
    return result.rows[0].id;
  }

  it('denies another customer draft access', async () => {
    const websiteId = await fixtureWebsiteId();

    const response = await getDraft(
      new Request(`http://localhost/api/draft?websiteId=${websiteId}`)
    );

    expect(response.status).toBe(404);
  });

  it('denies another customer revision history', async () => {
    const websiteId = await fixtureWebsiteId();

    const response = await getRevisions(
      new Request(
        `http://localhost/api/draft/revisions?websiteId=${websiteId}`
      )
    );

    expect(response.status).toBe(404);
  });

  it('denies another customer draft modification', async () => {
    const websiteId = await fixtureWebsiteId();

    const { PUT } = await import('../src/app/api/draft/route');
    const { getDb } = await import('../src/lib/db');

    const existing = await getDb().query<{
      draft_content: unknown;
      version: string;
    }>(
      `SELECT draft_content, version
       FROM public.websites WHERE id = $1::uuid`,
      [websiteId]
    );

    const response = await PUT(
      new Request('http://localhost/api/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          draft: existing.rows[0].draft_content,
          expectedVersion: Number(existing.rows[0].version)
        })
      })
    );

    expect(response.status).toBe(404);
  });
});


// STEP 55Q.20AO: Owner write protections
describe('Purchased Edition and version protections', () => {
  it('rejects Edition tampering and stale writes', async () => {
    const { auth } = await import('@clerk/nextjs/server');
    const { getDb } = await import('../src/lib/db');
    const { PUT } = await import('../src/app/api/draft/route');

    const db = getDb();

    const result = await db.query<{
      id: string;
      owner_clerk_user_id: string;
      version: string;
      draft_content: Record<string, unknown>;
    }>(
      `SELECT w.id, w.owner_clerk_user_id, w.version, w.draft_content
       FROM public.websites w
       JOIN public.entitlements e ON e.id = w.entitlement_id
       JOIN public.purchases p ON p.id = e.purchase_id
       WHERE w.owner_clerk_user_id LIKE 'provision-test-%'
         AND e.status = 'active'
         AND p.status = 'paid'
         AND w.publication_status = 'draft'
         AND public.website_hosting_operational(
           w.hosting_starts_at, w.hosting_ends_at, clock_timestamp()
         )
       ORDER BY w.created_at DESC LIMIT 1`
    );

    expect(result.rows).toHaveLength(1);
    const website = result.rows[0];

    // This test requires a mutable mock identity.
    const mockedAuth = auth as unknown as {
      mockResolvedValue: (value: { userId: string }) => void;
    };

    mockedAuth.mockResolvedValue({
      userId: website.owner_clerk_user_id
    });

    try {
      const { editions } = await import('../src/lib/editions');
      const alternateEdition = editions.find(
        e => e.slug !== website.draft_content.edition
      );

      expect(alternateEdition).toBeDefined();

      const tampered = {
        ...website.draft_content,
        edition: alternateEdition!.slug
      };

      const tamperResponse = await PUT(
        new Request('http://localhost/api/draft', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            websiteId: website.id,
            draft: tampered,
            expectedVersion: Number(website.version)
          })
        })
      );

      expect(tamperResponse.status).toBe(403);

      const conflictResponse = await PUT(
        new Request('http://localhost/api/draft', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            websiteId: website.id,
            draft: website.draft_content,
            expectedVersion: Number(website.version) + 1
          })
        })
      );

      expect(conflictResponse.status).toBe(409);

      console.log('PASS: Purchased Edition change rejected');
      console.log('PASS: Stale version rejected with HTTP 409');
    } finally {
      mockedAuth.mockResolvedValue({
        userId: 'security-test-outsider'
      });
    }
  });
});


// STEP 55Q.20AQ: Revision restoration isolation
describe('Revision restoration isolation', () => {
  it('rejects nonexistent revisions and cross-account restoration', async () => {
    const { randomUUID } = await import('node:crypto');
    const { auth } = await import('@clerk/nextjs/server');
    const { getDb } = await import('../src/lib/db');
    const { POST } = await import('../src/app/api/draft/restore/route');

    const db = getDb();

    const result = await db.query<{
      id: string;
      owner_clerk_user_id: string;
      version: string;
    }>(
      `SELECT w.id, w.owner_clerk_user_id, w.version
       FROM public.websites w
       JOIN public.entitlements e ON e.id = w.entitlement_id
       JOIN public.purchases p ON p.id = e.purchase_id
       WHERE w.owner_clerk_user_id LIKE 'provision-test-%'
         AND e.status = 'active'
         AND p.status = 'paid'
         AND w.publication_status IN ('draft', 'published')
         AND public.website_hosting_operational(
           w.hosting_starts_at, w.hosting_ends_at, clock_timestamp()
         )
       LIMIT 1`
    );

    expect(result.rows).toHaveLength(1);

    const website = result.rows[0];

    const mockedAuth = auth as unknown as {
      mockResolvedValue: (value: { userId: string }) => void;
    };

    const restore = (revisionId: string) =>
      POST(new Request('http://localhost/api/draft/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId: website.id,
          revisionId,
          expectedVersion: Number(website.version)
        })
      }));

    try {
      mockedAuth.mockResolvedValue({
        userId: website.owner_clerk_user_id
      });

      const missingResponse = await restore(randomUUID());
      expect(missingResponse.status).toBe(404);

      console.log('PASS: Nonexistent revision rejected');

      mockedAuth.mockResolvedValue({
        userId: 'security-test-outsider'
      });

      const outsiderResponse = await restore(randomUUID());
      expect(outsiderResponse.status).toBe(404);

      console.log('PASS: Cross-account restoration rejected');

      const unchanged = await db.query<{ version: string }>(
        'SELECT version FROM public.websites WHERE id = $1::uuid',
        [website.id]
      );

      expect(unchanged.rows[0].version).toBe(website.version);

      console.log('PASS: Rejected restores leave version unchanged');
    } finally {
      mockedAuth.mockResolvedValue({
        userId: 'security-test-outsider'
      });
    }
  });
});

// STEP 55Q.20AV: Route-level access denial
describe('Route-level entitlement denial', () => {
  it('rejects draft reads when authorization denies access', async () => {
    const { auth } = await import('@clerk/nextjs/server');
    const { getDb } = await import('../src/lib/db');
    const { GET } = await import('../src/app/api/draft/route');

    const result = await getDb().query<{
      id: string;
      owner_clerk_user_id: string;
    }>(
      `SELECT id, owner_clerk_user_id
       FROM public.websites
       WHERE owner_clerk_user_id LIKE 'provision-test-%'
       LIMIT 1`
    );

    expect(result.rows).toHaveLength(1);

    const website = result.rows[0];
    const mockedAuth = auth as unknown as {
      mockResolvedValue: (value: { userId: string }) => void;
    };

    mockedAuth.mockResolvedValue({
      userId: website.owner_clerk_user_id
    });

    try {
      const response = await GET(new Request(
        'http://localhost/api/draft?websiteId=00000000-0000-4000-8000-000000000001'
      ));

      expect(response.status).toBe(404);
      console.log('PASS: Unauthorized draft read rejected');
    } finally {
      mockedAuth.mockResolvedValue({
        userId: 'security-test-outsider'
      });
    }
  });
});
