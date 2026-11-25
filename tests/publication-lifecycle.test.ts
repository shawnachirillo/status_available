// @vitest-environment node

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

const identity = vi.hoisted(() => ({
  userId: null as string | null
}));

vi.mock('server-only', () => ({}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({
    userId: identity.userId
  })
}));

import { getDb } from '../src/lib/db';
import { POST } from '../src/app/api/publish/route';
import {
  getPublicWebsite
} from '../src/lib/websites/publication';


const suffix = randomUUID();
const owner = `publication-owner-${suffix}`;
const outsider = `publication-outsider-${suffix}`;

const slug = `test-${suffix}`;
const secondSlug = `second-${suffix}`;

const firstWebsite = randomUUID();
const secondWebsite = randomUUID();

const draft = {
  edition: 'atelier',
  business: 'Publication Test Studio',
  headline: 'Original published headline',
  description: 'A synthetic publishing test website.',
  email: '',
  phone: '',
  booking: '',
  palette: 0
};

let client: PoolClient;

async function publish(
  websiteId: string,
  expectedVersion: number,
  address?: string
) {
  return POST(new Request(
    'http://localhost/api/publish',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        websiteId,
        expectedVersion,
        slug: address
      })
    }
  ));
}

async function currentPublication(websiteId: string) {
  const result = await client.query(`
    SELECT
      w.publication_status,
      w.public_slug,
      w.current_publication_id,
      p.content,
      p.publication_version,
      p.source_draft_version
    FROM public.websites w
    LEFT JOIN public.website_publications p
      ON p.id = w.current_publication_id
    WHERE w.id = $1
  `, [websiteId]);

  return result.rows[0];
}

async function snapshotCount(websiteId: string) {
  const result = await client.query(`
    SELECT count(*)::int AS count
    FROM public.website_publications
    WHERE website_id = $1
  `, [websiteId]);

  return result.rows[0].count;
}

describe('Publishing lifecycle', () => {
  beforeAll(async () => {
    expect(
      process.env.STATUS_INTEGRATION_TEST_MODE
    ).toBe('true');

    expect(
      process.env.STATUS_TEST_DB_HOST
    ).toBe('127.0.0.1');

    expect(
      process.env.STATUS_TEST_DB_PORT
    ).toBe('55432');

    expect(
      process.env.STATUS_TEST_DB_NAME
    ).toBe('status_payment_concurrency_test');

    const pool = getDb();
    client = await pool.connect();

    const database = await client.query(`
      SELECT current_database() AS name
    `);

    expect(database.rows[0].name)
      .toBe('status_payment_concurrency_test');

    await client.query('BEGIN');

    // Keep all fixtures and API mutations inside
    // a disposable outer transaction.
    const originalQuery = client.query.bind(client);

    const wrappedQuery = async (
      ...args: unknown[]
    ) => {
      const sql = args[0];

      if (typeof sql === 'string') {
        const command = sql.trim().toUpperCase();

        if (command === 'BEGIN') {
          return originalQuery(
            'SAVEPOINT publication_api'
          );
        }

        if (command === 'COMMIT') {
          return originalQuery(
            'RELEASE SAVEPOINT publication_api'
          );
        }

        if (command === 'ROLLBACK') {
          await originalQuery(
            'ROLLBACK TO SAVEPOINT publication_api'
          );

          return originalQuery(
            'RELEASE SAVEPOINT publication_api'
          );
        }
      }

      return (originalQuery as any)(...args);
    };

    const transactionalClient = {
      query: wrappedQuery,
      release: () => {}
    };

    vi.spyOn(pool, 'connect')
      .mockImplementation(
        (async () => transactionalClient) as any
      );

    vi.spyOn(pool, 'query')
      .mockImplementation(
        client.query.bind(client) as any
      );

    // Use the existing Atelier catalog entry.
    // The test never changes commercial inventory.
    const edition = await client.query(`
      SELECT id
      FROM public.edition_catalog
      WHERE slug = 'atelier'
    `);

    if (edition.rowCount !== 1) {
      throw new Error(
        'STOP: Isolated Atelier catalog fixture missing'
      );
    }

    // Resolve the actual catalog identity for fixtures.
    await client.query(`
      CREATE TEMP TABLE publication_test_catalog (
        id uuid NOT NULL
      ) ON COMMIT DROP
    `);

    await client.query(`
      INSERT INTO publication_test_catalog (id)
      VALUES ($1)
    `, [edition.rows[0].id]);

    identity.userId = owner;
  });

  afterAll(async () => {
    vi.restoreAllMocks();

    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }

    await getDb().end();
  });

  it('enforces the exact hosting boundaries and invalid terms', async () => {
    const result = await client.query(`
      WITH term AS (
        SELECT '2026-01-01T00:00:00Z'::timestamptz AS starts_at,
               '2027-01-01T00:00:00Z'::timestamptz AS ends_at
      ), cases AS (
        SELECT * FROM term CROSS JOIN LATERAL (VALUES
          (1, starts_at - interval '1 microsecond'),
          (2, starts_at),
          (3, ends_at - interval '1 microsecond'),
          (4, ends_at),
          (5, ends_at + interval '720 hours' - interval '1 microsecond'),
          (6, ends_at + interval '720 hours'),
          (7, ends_at + interval '2880 hours' - interval '1 microsecond'),
          (8, ends_at + interval '2880 hours'),
          (9, NULL::timestamptz)
        ) AS boundary(id, evaluated_at)
        UNION ALL SELECT NULL, ends_at, 10, starts_at FROM term
        UNION ALL SELECT starts_at, NULL, 11, starts_at FROM term
        UNION ALL SELECT starts_at, starts_at, 12, starts_at FROM term
      )
      SELECT public.website_hosting_state(starts_at, ends_at, evaluated_at) AS state,
             public.website_hosting_operational(starts_at, ends_at, evaluated_at) AS operational
      FROM cases ORDER BY id
    `);

    expect(result.rows).toEqual([
      { state: 'scheduled', operational: false },
      { state: 'active', operational: true },
      { state: 'active', operational: true },
      { state: 'grace', operational: true },
      { state: 'grace', operational: true },
      { state: 'suspended', operational: false },
      { state: 'suspended', operational: false },
      { state: 'retention_expired', operational: false },
      { state: 'unallocated', operational: false },
      { state: 'unallocated', operational: false },
      { state: 'unallocated', operational: false },
      { state: 'unallocated', operational: false }
    ]);
  });

  it('rejects anonymous publication', async () => {
    identity.userId = null;

    expect(
      (await publish(firstWebsite, 1, slug)).status
    ).toBe(401);

    identity.userId = owner;
  });

  it('creates isolated customer website fixtures', async () => {
    const catalog = await client.query(`
      SELECT id FROM publication_test_catalog
    `);

    // Create fixtures using the existing Edition ID.
    for (const websiteId of [
      firstWebsite,
      secondWebsite
    ]) {
      const purchaseId = randomUUID();
      const entitlementId = randomUUID();
      const catalogId = catalog.rows[0].id;

      await client.query(`
        INSERT INTO public.purchases (
          id, buyer_clerk_user_id, edition_id,
          payment_provider, status,
          amount_cents, currency, paid_at
        )
        VALUES (
          $1, $2, $3, 'stripe',
          'paid', 10000, 'usd', now()
        )
      `, [purchaseId, owner, catalogId]);

      await client.query(`
        INSERT INTO public.entitlements (
          id, purchase_id, edition_id,
          owner_clerk_user_id, status
        )
        VALUES ($1, $2, $3, $4, 'active')
      `, [
        entitlementId,
        purchaseId,
        catalogId,
        owner
      ]);

      await client.query(`
        INSERT INTO public.websites (
          id, owner_clerk_user_id,
          edition_id, edition_catalog_id,
          entitlement_id, name,
          draft_content, version,
          publication_status,
          hosting_starts_at, hosting_ends_at
        )
        VALUES (
          $1, $2, 'atelier', $3, $4,
          'Publication Test Studio',
          $5::jsonb, 1, 'draft',
          now() - interval '1 day',
          now() + interval '1 year'
        )
      `, [
        websiteId,
        owner,
        catalogId,
        entitlementId,
        JSON.stringify(draft)
      ]);
    }

    expect(await snapshotCount(firstWebsite)).toBe(0);
    expect(await snapshotCount(secondWebsite)).toBe(0);
  });

  it('denies publication by another customer', async () => {
    identity.userId = outsider;

    expect(
      (await publish(firstWebsite, 1, slug)).status
    ).toBe(404);

    identity.userId = owner;
  });

  it('rejects reserved and invalid addresses', async () => {
    for (const address of [
      'app', 'studio', 'www',
      'Invalid', 'a', '-invalid'
    ]) {
      expect(
        (await publish(
          firstWebsite, 1, address
        )).status
      ).toBe(400);
    }
  });

  it('never exposes unpublished websites', async () => {
    expect(await getPublicWebsite(slug)).toBeNull();
    expect(await getPublicWebsite(secondSlug)).toBeNull();
    expect(await getPublicWebsite('app')).toBeNull();
    expect(await getPublicWebsite('../private')).toBeNull();
  });

  it('creates the first published snapshot', async () => {
    const response = await publish(
      firstWebsite, 1, slug
    );

    expect(response.status).toBe(200);

    const result = await response.json();

    expect(result.publicationVersion).toBe(1);
    expect(result.unchanged).toBe(false);

    const current = await currentPublication(
      firstWebsite
    );

    expect(current.publication_status)
      .toBe('published');

    expect(current.content).toEqual(draft);
    expect(current.public_slug).toBe(slug);
    expect(await snapshotCount(firstWebsite)).toBe(1);
  });

  it('returns only public snapshot fields', async () => {
    const website = await getPublicWebsite(slug);

    expect(website).not.toBeNull();
    expect(website?.content).toEqual(draft);

    expect(Object.keys(website!).sort()).toEqual([
      'content',
      'publishedAt',
      'rendererVersion',
      'slug'
    ]);
  });

  it('handles repeated publication idempotently', async () => {
    const response = await publish(
      firstWebsite, 1, slug
    );

    expect(response.status).toBe(200);

    const result = await response.json();

    expect(result.unchanged).toBe(true);
    expect(await snapshotCount(firstWebsite)).toBe(1);
  });

  it('rejects duplicate addresses without partial publication', async () => {
    const response = await publish(
      secondWebsite, 1, slug
    );

    expect(response.status).toBe(409);
    expect(await snapshotCount(secondWebsite)).toBe(0);

    const current = await currentPublication(
      secondWebsite
    );

    expect(current.publication_status).toBe('draft');
    expect(current.current_publication_id).toBeNull();
  });

  it('keeps saved draft edits separate from live content', async () => {
    await client.query(`
      UPDATE public.websites
      SET draft_content = $2::jsonb,
          version = 2
      WHERE id = $1
    `, [
      firstWebsite,
      JSON.stringify({
        ...draft,
        headline: 'Updated draft headline'
      })
    ]);

    const current = await currentPublication(
      firstWebsite
    );

    expect(current.content.headline)
      .toBe(draft.headline);

    expect(await snapshotCount(firstWebsite)).toBe(1);
  });

  it('does not expose newer private draft content', async () => {
    const website = await getPublicWebsite(slug);

    expect(website?.content.headline)
      .toBe(draft.headline);
  });

  it('rejects publication of a stale draft version', async () => {
    expect(
      (await publish(firstWebsite, 1)).status
    ).toBe(409);

    expect(await snapshotCount(firstWebsite)).toBe(1);
  });

  it('republishes the latest saved draft', async () => {
    const response = await publish(
      firstWebsite, 2
    );

    expect(response.status).toBe(200);

    const result = await response.json();

    expect(result.publicationVersion).toBe(2);

    const current = await currentPublication(
      firstWebsite
    );

    expect(current.content.headline)
      .toBe('Updated draft headline');

    expect(current.public_slug).toBe(slug);
    expect(await snapshotCount(firstWebsite)).toBe(2);
  });

  it('serves the replacement published snapshot', async () => {
    const website = await getPublicWebsite(slug);

    expect(website?.content.headline)
      .toBe('Updated draft headline');
  });

  it('permits grace access and blocks suspended hosting', async () => {
    await client.query('SAVEPOINT public_expiry');

    try {
      await client.query(`
        UPDATE public.websites
        SET hosting_starts_at =
              now() - interval '2 years',
            hosting_ends_at =
              now() - interval '1 day'
        WHERE id = $1
      `, [firstWebsite]);

      expect(await getPublicWebsite(slug)).not.toBeNull();

      expect(
        (await publish(firstWebsite, 2)).status
      ).toBe(200);

      expect(await snapshotCount(firstWebsite)).toBe(2);

      await client.query(`
        UPDATE public.websites
        SET hosting_ends_at =
          clock_timestamp() - interval '31 days'
        WHERE id = $1
      `, [firstWebsite]);

      expect(await getPublicWebsite(slug)).toBeNull();

      expect(
        (await publish(firstWebsite, 2)).status
      ).toBe(404);

      expect(await snapshotCount(firstWebsite)).toBe(2);

    } finally {
      await client.query(
        'ROLLBACK TO SAVEPOINT public_expiry'
      );
      await client.query(
        'RELEASE SAVEPOINT public_expiry'
      );
    }

    expect(await getPublicWebsite(slug))
      .not.toBeNull();
  });

  it('blocks public access after payment refund', async () => {
    await client.query('SAVEPOINT public_refund');

    try {
      await client.query(`
        UPDATE public.websites
        SET hosting_starts_at =
              now() - interval '2 years',
            hosting_ends_at =
              now() - interval '1 day'
        WHERE id = $1
      `, [firstWebsite]);

      expect(await getPublicWebsite(slug)).not.toBeNull();
      await client.query(`
        UPDATE public.purchases
        SET status = 'refunded'
        WHERE id = (
          SELECT e.purchase_id
          FROM public.entitlements e
          JOIN public.websites w
            ON w.entitlement_id = e.id
          WHERE w.id = $1
        )
      `, [firstWebsite]);

      expect(await getPublicWebsite(slug)).toBeNull();

    } finally {
      await client.query(
        'ROLLBACK TO SAVEPOINT public_refund'
      );
      await client.query(
        'RELEASE SAVEPOINT public_refund'
      );
    }

    expect(await getPublicWebsite(slug))
      .not.toBeNull();
  });

  it('blocks archived and suspended websites', async () => {
    await client.query('SAVEPOINT public_status');

    try {
      for (const status of ['archived', 'suspended']) {
        await client.query(`
          UPDATE public.websites
          SET publication_status = $2
          WHERE id = $1
        `, [firstWebsite, status]);

        expect(await getPublicWebsite(slug))
          .toBeNull();
      }
    } finally {
      await client.query(
        'ROLLBACK TO SAVEPOINT public_status'
      );
      await client.query(
        'RELEASE SAVEPOINT public_status'
      );
    }

    expect(await getPublicWebsite(slug))
      .not.toBeNull();
  });

  it('preserves the live address and snapshot on rejection', async () => {
    const before = await currentPublication(
      firstWebsite
    );

    expect(
      (await publish(
        firstWebsite, 2, secondSlug
      )).status
    ).toBe(409);

    expect(
      await currentPublication(firstWebsite)
    ).toEqual(before);
  });

  it('rejects modification of published snapshots', async () => {
    await client.query('SAVEPOINT immutable_test');

    try {
      await expect(client.query(`
        UPDATE public.website_publications
        SET content = content
        WHERE website_id = $1
      `, [firstWebsite])).rejects.toThrow(
        'Published snapshots cannot be modified'
      );
    } finally {
      await client.query(
        'ROLLBACK TO SAVEPOINT immutable_test'
      );

      await client.query(
        'RELEASE SAVEPOINT immutable_test'
      );
    }
  });

  it('denies publication after entitlement suspension', async () => {
    await client.query(`
      UPDATE public.entitlements
      SET status = 'suspended'
      WHERE id = (
        SELECT entitlement_id
        FROM public.websites
        WHERE id = $1
      )
    `, [firstWebsite]);

    expect(
      (await publish(firstWebsite, 2)).status
    ).toBe(404);

    expect(await snapshotCount(firstWebsite)).toBe(2);
  });

  it('blocks public access after entitlement suspension', async () => {
    expect(await getPublicWebsite(slug)).toBeNull();
  });

  it('denies publication after hosting grace ends', async () => {
    await client.query(`
      UPDATE public.websites
      SET hosting_starts_at =
            now() - interval '2 years',
          hosting_ends_at =
            now() - interval '31 days'
      WHERE id = $1
    `, [secondWebsite]);

    expect(
      (await publish(
        secondWebsite, 1, secondSlug
      )).status
    ).toBe(404);

    expect(await snapshotCount(secondWebsite)).toBe(0);
  });
});
