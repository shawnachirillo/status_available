// @vitest-environment node

import {
  afterAll,
  beforeAll,
  expect,
  it,
  vi
} from 'vitest';

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
import { PUT as saveDraft } from '../src/app/api/draft/route';
import { POST as restoreDraft } from '../src/app/api/draft/restore/route';

const execute = promisify(execFile);

const suffix = randomUUID();
const owner = `http-publication-${suffix}`;
const slug = `http-${suffix}`;

const websiteId = randomUUID();
const purchaseId = randomUUID();
const entitlementId = randomUUID();

const original = `Original-${suffix}`;
const updated = `Updated-${suffix}`;
const privateMarker = `Private-${suffix}`;

const draft = {
  edition: 'atelier',
  business: 'HTTP Acceptance Studio',
  headline: original,
  description: 'Synthetic publication acceptance fixture.',
  email: '',
  phone: '',
  booking: '',
  palette: 0
};

let verifiedDatabase = false;

const httpPort = Number(process.env.STATUS_TEST_HTTP_PORT ?? '3001');
if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
  throw new Error('A valid publication HTTP test port is required');
}

async function request(path = '/', method = 'GET') {
  const result = await execute('curl', [
    '--noproxy', '*',
    '--connect-timeout', '5',
    '--max-time', '30',
    '-sS',
    '-X', method,
    '-H', `Host: ${slug}.localhost:${httpPort}`,
    '-w', '\n%{http_code}',
    `http://127.0.0.1:${httpPort}${path}`
  ], {
    maxBuffer: 5 * 1024 * 1024
  });

  const split = result.stdout.lastIndexOf('\n');

  return {
    status: Number(result.stdout.slice(split + 1)),
    body: result.stdout.slice(0, split)
  };
}

async function publish(version: number) {
  const response = await POST(new Request(
    'http://localhost/api/publish',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        websiteId,
        expectedVersion: version,
        slug
      })
    }
  ));

  const body = await response.json();

  expect(
    response.status,
    JSON.stringify(body)
  ).toBe(200);

  return body;
}

beforeAll(async () => {
  expect(process.env.STATUS_INTEGRATION_TEST_MODE)
    .toBe('true');

  expect(process.env.STATUS_TEST_DB_PORT)
    .toBe('55432');

  expect(process.env.STATUS_TEST_DB_NAME)
    .toBe('status_payment_concurrency_test');

  const pool = getDb();

  const database = await pool.query(`
    SELECT current_database() AS name,
           current_user AS username
  `);

  expect(database.rows[0].name)
    .toBe('status_payment_concurrency_test');

  expect(database.rows[0].username)
    .toBe('status_test');

  verifiedDatabase = true;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const catalog = await client.query(`
      SELECT id
      FROM public.edition_catalog
      WHERE slug = 'atelier'
    `);

    expect(catalog.rowCount).toBe(1);

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
        'HTTP Acceptance Studio',
        $5::jsonb, 1, 'draft',
        now() - interval '1 day',
        now() + interval '1 year'
      )
    `, [
      websiteId,
      owner,
      catalogId,
      entitlementId,
      JSON.stringify({
        ...draft,
        internalNote: privateMarker
      })
    ]);

    await client.query('COMMIT');

    identity.userId = owner;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}, 30000);

afterAll(async () => {
  if (!verifiedDatabase) return;

  const pool = getDb();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE public.websites
      SET current_publication_id = NULL,
          publication_status = 'draft'
      WHERE id = $1
        AND owner_clerk_user_id = $2
    `, [websiteId, owner]);

    await client.query(`
      DELETE FROM public.websites
      WHERE id = $1
        AND owner_clerk_user_id = $2
    `, [websiteId, owner]);

    await client.query(`
      DELETE FROM public.entitlements
      WHERE id = $1
        AND owner_clerk_user_id = $2
    `, [entitlementId, owner]);

    await client.query(`
      DELETE FROM public.purchases
      WHERE id = $1
        AND buyer_clerk_user_id = $2
    `, [purchaseId, owner]);

    await client.query('COMMIT');

    const remaining = await client.query(`
      SELECT
        (SELECT count(*) FROM public.websites
         WHERE id = $1)::int AS websites,
        (SELECT count(*) FROM public.website_publications
         WHERE website_id = $1)::int AS publications,
        (SELECT count(*) FROM public.entitlements
         WHERE id = $2)::int AS entitlements,
        (SELECT count(*) FROM public.purchases
         WHERE id = $3)::int AS purchases
    `, [websiteId, entitlementId, purchaseId]);

    expect(remaining.rows[0]).toEqual({
      websites: 0,
      publications: 0,
      entitlements: 0,
      purchases: 0
    });

    console.log('PASS: Synthetic fixtures removed');

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Cleanup fixture identifiers:', {
      websiteId,
      entitlementId,
      purchaseId,
      owner
    });
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}, 30000);

it('verifies the complete public HTTP lifecycle', async () => {
  const pool = getDb();

  let response = await request();

  expect(response.status).toBe(404);
  console.log('PASS: Unpublished website inaccessible');

  const concurrent = await Promise.all([
    publish(1),
    publish(1),
    publish(1),
    publish(1),
    publish(1)
  ]);

  expect(
    concurrent.filter(result => result.unchanged === false)
  ).toHaveLength(1);

  expect(
    concurrent.filter(result => result.unchanged === true)
  ).toHaveLength(4);

  expect(
    new Set(concurrent.map(result => result.publicationId)).size
  ).toBe(1);

  const concurrentSnapshots = await pool.query(`
    SELECT count(*)::int AS count
    FROM public.website_publications
    WHERE website_id = $1
  `, [websiteId]);

  expect(concurrentSnapshots.rows[0].count).toBe(1);

  console.log('PASS: Five concurrent requests produce one snapshot');
  console.log('PASS: Concurrent retries remain idempotent');

  response = await request();

  expect(response.status).toBe(200);
  expect(response.body).toContain(original);
  expect(response.body).not.toContain(privateMarker);
  expect(response.body).not.toContain(owner);
  expect(response.body).not.toContain(websiteId);
  expect(response.body).not.toContain(purchaseId);

  console.log('PASS: Published website delivered');
  console.log('PASS: Private identifiers absent');

  const snapshot = await pool.query(`
    SELECT content
    FROM public.website_publications
    WHERE website_id = $1
  `, [websiteId]);

  expect(snapshot.rowCount).toBe(1);
  expect(snapshot.rows[0].content).toEqual(draft);

  console.log('PASS: Snapshot excludes private fields');

  await pool.query(`
    UPDATE public.websites
    SET draft_content = $2::jsonb,
        version = 2
    WHERE id = $1
  `, [
    websiteId,
    JSON.stringify({
      ...draft,
      headline: updated,
      internalNote: privateMarker
    })
  ]);

  response = await request();

  expect(response.status).toBe(200);
  expect(response.body).toContain(original);
  expect(response.body).not.toContain(updated);
  expect(response.body).not.toContain(privateMarker);

  console.log('PASS: New draft remains private');

  await publish(2);

  response = await request();

  expect(response.status).toBe(200);
  expect(response.body).toContain(updated);
  expect(response.body).not.toContain(original);
  expect(response.body).not.toContain(privateMarker);

  console.log('PASS: Republished content delivered');

  // Force an idempotent publication request to wait
  // for a website lock until the hosting grace period ends.
  const blocker = await pool.connect();
  let pending: Promise<Response> | undefined;

  try {
    await pool.query(`
      UPDATE public.websites
      SET hosting_starts_at =
        clock_timestamp() - interval '2 years',
          hosting_ends_at =
        clock_timestamp() - interval '720 hours'
          + interval '5 seconds'
      WHERE id = $1
    `, [websiteId]);

    await blocker.query('BEGIN');

    await blocker.query(`
      SELECT id
      FROM public.websites
      WHERE id = $1
      FOR UPDATE
    `, [websiteId]);

    pending = POST(new Request(
      'http://localhost/api/publish',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          websiteId,
          expectedVersion: 2,
          slug
        })
      }
    ));

    let waiting = false;

    for (let attempt = 0; attempt < 60; attempt++) {
      await blocker.query('SELECT pg_stat_clear_snapshot()');
      const activity = await blocker.query(`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query LIKE '%FOR UPDATE OF w%'
            AND pg_backend_pid() =
                ANY(pg_blocking_pids(pid))
        ) AS waiting
      `);

      if (activity.rows[0].waiting) {
        waiting = true;
        break;
      }

      await new Promise(resolve =>
        setTimeout(resolve, 50)
      );
    }

    expect(waiting).toBe(true);

    await blocker.query('SELECT pg_sleep(6)');

    await blocker.query('COMMIT');

    const rejected = await pending;

    expect([404, 409]).toContain(rejected.status);

    const snapshots = await pool.query(`
      SELECT count(*)::int AS count
      FROM public.website_publications
      WHERE website_id = $1
    `, [websiteId]);

    expect(snapshots.rows[0].count).toBe(2);
    expect((await request()).status).toBe(404);

    console.log('PASS: Hosting suspended during verified lock wait');
    console.log('PASS: Suspended idempotent publication rejected');
    console.log('PASS: No additional snapshot created');

  } finally {
    await blocker.query('ROLLBACK').catch(() => {});

    if (pending) {
      await pending.catch(() => {});
    }

    blocker.release();

    await pool.query(`
      UPDATE public.websites
      SET hosting_ends_at =
        clock_timestamp() + interval '1 year'
      WHERE id = $1
    `, [websiteId]);
  }

  expect((await request()).status).toBe(200);

  console.log('PASS: Restored hosting serves existing snapshot');

  for (const path of [
    '/app',
    '/api/websites',
    '/api/publish',
    '/about'
  ]) {
    expect((await request(path)).status).toBe(404);
  }

  expect((await request('/', 'POST')).status).toBe(404);

  console.log('PASS: Published hostname remains isolated');

  await pool.query(`
    UPDATE public.websites
    SET publication_status = 'suspended'
    WHERE id = $1
  `, [websiteId]);

  expect((await request()).status).toBe(404);

  console.log('PASS: Suspended website inaccessible');

  await pool.query(`
    UPDATE public.websites
    SET publication_status = 'published',
        hosting_starts_at = now() - interval '2 years',
        hosting_ends_at = now() - interval '1 day'
    WHERE id = $1
  `, [websiteId]);

  const graceResponse = await request();

  expect(graceResponse.status).toBe(200);
  expect(graceResponse.body).toContain(updated);

  const graceHeadline = `Grace-${suffix}`;

  function draftRequest(path: string, method: string, body: object) {
    return new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId, ...body })
    });
  }

  const saved = await saveDraft(draftRequest('/api/draft', 'PUT', {
    draft: { ...draft, headline: graceHeadline },
    expectedVersion: 2
  }));
  expect(saved.status).toBe(200);

  const gracePublication = await publish(3);
  expect(gracePublication.unchanged).toBe(false);
  expect(gracePublication.sourceDraftVersion).toBe(3);
  expect((await request()).body).toContain(graceHeadline);

  const stateQuery = `
    SELECT w.draft_content, w.version, w.current_publication_id,
      (SELECT count(*)::int FROM public.website_revisions
       WHERE website_id = w.id) AS revisions,
      (SELECT count(*)::int FROM public.website_publications
       WHERE website_id = w.id) AS snapshots
    FROM public.websites w WHERE w.id = $1
  `;
  const graceState = (await pool.query(stateQuery, [websiteId])).rows[0];

  console.log('PASS: Grace-period edit and new snapshot delivered');

  await pool.query(`
    UPDATE public.websites
    SET hosting_ends_at =
      clock_timestamp() - interval '31 days'
    WHERE id = $1
  `, [websiteId]);

  expect((await request()).status).toBe(404);

  expect((await pool.query(stateQuery, [websiteId])).rows[0]).toEqual(graceState);

  console.log('PASS: Hosting suspension blocks public access');

  await pool.query(`
    UPDATE public.websites
    SET hosting_ends_at =
      clock_timestamp() - interval '121 days'
    WHERE id = $1
  `, [websiteId]);

  expect((await request()).status).toBe(404);

  const retained = await pool.query(`
    SELECT count(*)::int AS count
    FROM public.website_publications
    WHERE website_id = $1
  `, [websiteId]);

  expect(retained.rows[0].count).toBe(3);
  expect((await pool.query(stateQuery, [websiteId])).rows[0]).toEqual(graceState);

  console.log('PASS: Retention expiration preserves snapshots');

  await pool.query(`
    UPDATE public.websites
    SET hosting_starts_at = now() - interval '1 day',
        hosting_ends_at = now() + interval '1 year'
    WHERE id = $1
  `, [websiteId]);

  expect((await request()).status).toBe(200);

  // Hold the refund transaction open while a
  // concurrent website writes wait for the purchase.
  const refundClient = await pool.connect();
  let pendingWrites: Promise<Response>[] = [];
  const revision = await pool.query(
    'SELECT id FROM public.website_revisions WHERE website_id = $1',
    [websiteId]
  );

  try {
    await refundClient.query('BEGIN');

    await refundClient.query(`
      UPDATE public.purchases
      SET status = 'refunded'
      WHERE id = $1
    `, [purchaseId]);

    pendingWrites = [POST(new Request(
      'http://localhost/api/publish',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          websiteId,
          expectedVersion: 3,
          slug
        })
      }
    )), saveDraft(draftRequest('/api/draft', 'PUT', {
      draft,
      expectedVersion: 3
    })), restoreDraft(draftRequest('/api/draft/restore', 'POST', {
      revisionId: revision.rows[0].id,
      expectedVersion: 3
    }))];

    let waiting = false;

    for (let attempt = 0; attempt < 100; attempt++) {
      await refundClient.query('SELECT pg_stat_clear_snapshot()');
      const activity = await refundClient.query(`
        SELECT (
          SELECT count(*)::int
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query LIKE '%FOR UPDATE OF p%'
        ) AS waiting
      `);

      if (activity.rows[0].waiting === pendingWrites.length) {
        waiting = true;
        break;
      }

      await new Promise(resolve =>
        setTimeout(resolve, 50)
      );
    }

    expect(waiting).toBe(true);

    console.log('PASS: Publish, save and restore wait for the refund transaction');

    await refundClient.query('COMMIT');

    const rejected = await Promise.all(pendingWrites);

    expect(rejected.map(response => response.status)).toEqual([404, 404, 404]);
    expect((await pool.query(stateQuery, [websiteId])).rows[0]).toEqual(graceState);

    console.log('PASS: Concurrent publish, save and restore rejected after refund');

    const finalState = await pool.query(`
      SELECT
        p.status AS purchase_status,
        e.status AS entitlement_status,
        (
          SELECT count(*)::int
          FROM public.website_publications
          WHERE website_id = $1
        ) AS snapshots
      FROM public.websites w
      JOIN public.entitlements e
        ON e.id = w.entitlement_id
      JOIN public.purchases p
        ON p.id = e.purchase_id
      WHERE w.id = $1
    `, [websiteId]);

    expect(finalState.rows[0]).toEqual({
      purchase_status: 'refunded',
      entitlement_status: 'suspended',
      snapshots: 3
    });

    console.log('PASS: Refund and entitlement remain consistent');
    console.log('PASS: Refund race preserves draft, revisions and snapshots');

  } finally {
    await refundClient.query('ROLLBACK').catch(() => {});

    await Promise.allSettled(pendingWrites);

    refundClient.release();
  }

  response = await request();

  expect(response.status).toBe(404);
  expect(response.body).not.toContain(updated);

  console.log('PASS: Refunded website inaccessible');


  const competingOwner = `competing-${suffix}`;
  const racingOwner = `racing-${suffix}`;
  const racingWebsite = randomUUID();
  const racingPurchase = randomUUID();
  const racingEntitlement = randomUUID();

  const competingWebsite = randomUUID();
  const competingPurchase = randomUUID();
  const competingEntitlement = randomUUID();
  const competingSlug = `collision-${suffix}`;

  const competitor = await pool.connect();

  try {
    await competitor.query('BEGIN');

    const catalog = await competitor.query(`
      SELECT id FROM public.edition_catalog
      WHERE slug = 'atelier'
    `);

    expect(catalog.rowCount).toBe(1);

    const catalogId = catalog.rows[0].id;

    await competitor.query(`
      INSERT INTO public.purchases (
        id, buyer_clerk_user_id, edition_id,
        payment_provider, status,
        amount_cents, currency, paid_at
      )
      VALUES (
        $1, $2, $3, 'stripe',
        'paid', 10000, 'usd', now()
      )
    `, [competingPurchase, competingOwner, catalogId]);

    await competitor.query(`
      INSERT INTO public.entitlements (
        id, purchase_id, edition_id,
        owner_clerk_user_id, status
      )
      VALUES ($1, $2, $3, $4, 'active')
    `, [
      competingEntitlement,
      competingPurchase,
      catalogId,
      competingOwner
    ]);

    await competitor.query(`
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
        'Competing Test Studio',
        $5::jsonb, 1, 'draft',
        now() - interval '1 day',
        now() + interval '1 year'
      )
    `, [
      competingWebsite,
      competingOwner,
      catalogId,
      competingEntitlement,
      JSON.stringify(draft)
    ]);

    await competitor.query(`
      INSERT INTO public.purchases (
        id, buyer_clerk_user_id, edition_id,
        payment_provider, status,
        amount_cents, currency, paid_at
      )
      VALUES (
        $1, $2, $3, 'stripe',
        'paid', 10000, 'usd', now()
      )
    `, [racingPurchase, racingOwner, catalogId]);

    await competitor.query(`
      INSERT INTO public.entitlements (
        id, purchase_id, edition_id,
        owner_clerk_user_id, status
      )
      VALUES ($1, $2, $3, $4, 'active')
    `, [
      racingEntitlement,
      racingPurchase,
      catalogId,
      racingOwner
    ]);

    await competitor.query(`
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
        'Racing Test Studio',
        $5::jsonb, 1, 'draft',
        now() - interval '1 day',
        now() + interval '1 year'
      )
    `, [
      racingWebsite,
      racingOwner,
      catalogId,
      racingEntitlement,
      JSON.stringify(draft)
    ]);


    await competitor.query('COMMIT');

    identity.userId = competingOwner;

    const competingRequest = () => POST(new Request(
      'http://localhost/api/publish',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          websiteId: competingWebsite,
          expectedVersion: 1,
          slug
        })
      }
    ));

    const results = await Promise.all([
      competingRequest(),
      competingRequest()
    ]);

    expect(results.map(result => result.status))
      .toEqual([409, 409]);

    const state = await pool.query(`
      SELECT publication_status,
             current_publication_id,
             public_slug
      FROM public.websites
      WHERE id = $1
    `, [competingWebsite]);

    expect(state.rows[0]).toEqual({
      publication_status: 'draft',
      current_publication_id: null,
      public_slug: null
    });

    const snapshots = await pool.query(`
      SELECT count(*)::int AS count
      FROM public.website_publications
      WHERE website_id = $1
    `, [competingWebsite]);

    expect(snapshots.rows[0].count).toBe(0);

    console.log('PASS: Competing customer cannot claim reserved address');
    console.log('PASS: Address collision leaves no partial publication');

    async function claimAddress(
      customer: string,
      site: string,
      address: string
    ) {
      identity.userId = customer;

      return POST(new Request(
        'http://localhost/api/publish',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            websiteId: site,
            expectedVersion: 1,
            slug: address
          })
        }
      ));
    }

    const claims = await Promise.all([
      claimAddress(
        competingOwner,
        competingWebsite,
        competingSlug
      ),
      claimAddress(
        racingOwner,
        racingWebsite,
        competingSlug
      )
    ]);

    expect(claims.map(result => result.status).sort())
      .toEqual([200, 409]);

    const allocation = await pool.query(`
      SELECT
        w.id,
        w.public_slug,
        w.publication_status,
        w.current_publication_id,
        (
          SELECT count(*)::int
          FROM public.website_publications p
          WHERE p.website_id = w.id
        ) AS snapshots
      FROM public.websites w
      WHERE w.id IN ($1, $2)
    `, [competingWebsite, racingWebsite]);

    expect(allocation.rowCount).toBe(2);

    const winner = allocation.rows.find(
      row => row.public_slug === competingSlug
    );

    const loser = allocation.rows.find(
      row => row.id !== winner?.id
    );

    expect(winner).toBeDefined();
    expect(winner?.publication_status).toBe('published');
    expect(winner?.snapshots).toBe(1);
    expect(winner?.current_publication_id).toBeTruthy();

    expect(loser).toBeDefined();
    expect(loser?.publication_status).toBe('draft');
    expect(loser?.public_slug).toBeNull();
    expect(loser?.current_publication_id).toBeNull();
    expect(loser?.snapshots).toBe(0);

    console.log('PASS: Exactly one customer wins first-time address race');
    console.log('PASS: Losing customer retains clean unpublished draft');

    const retry = await claimAddress(
      loser?.id === competingWebsite
        ? competingOwner
        : racingOwner,
      loser!.id,
      `retry-${suffix}`
    );

    expect(retry.status).toBe(200);

    console.log('PASS: Losing customer can publish at another address');

    const target = loser!.id;
    const targetOwner = target === competingWebsite
      ? competingOwner : racingOwner;
    const targetPurchase = target === competingWebsite
      ? competingPurchase : racingPurchase;
    const targetSlug = `retry-${suffix}`;

    identity.userId = targetOwner;

    async function publishTarget() {
      return POST(new Request(
        'http://localhost/api/publish',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            websiteId: target,
            expectedVersion: 2,
            slug: targetSlug
          })
        }
      ));
    }

    for (const invalid of [
      { email: 'invalid-email' },
      { phone: 'not-a-phone' },
      { booking: 'javascript:alert(1)' }
    ]) {
      await pool.query(`
        UPDATE public.websites
        SET draft_content = $2::jsonb,
            version = 2
        WHERE id = $1
      `, [target, JSON.stringify({
        ...draft,
        ...invalid
      })]);

      expect((await publishTarget()).status).toBe(422);
    }

    const unchanged = await pool.query(`
      SELECT count(*)::int AS count
      FROM public.website_publications
      WHERE website_id = $1
    `, [target]);

    expect(unchanged.rows[0].count).toBe(1);

    console.log('PASS: Invalid email, phone and booking links rejected');
    console.log('PASS: Invalid contacts create no publication snapshots');

    await pool.query(`
      UPDATE public.websites
      SET draft_content = $2::jsonb,
          version = 2
      WHERE id = $1
    `, [target, JSON.stringify({
      ...draft,
      headline: updated
    })]);

    const websiteBlocker = await pool.connect();
    let publication: Promise<Response> | undefined;
    let refund: Promise<unknown> | undefined;

    try {
      await websiteBlocker.query('BEGIN');

      await websiteBlocker.query(`
        SELECT id
        FROM public.websites
        WHERE id = $1
        FOR UPDATE
      `, [target]);

      publication = publishTarget();

      let publisherPid: number | undefined;

      for (let attempt = 0; attempt < 200; attempt++) {
        await websiteBlocker.query(
          'SELECT pg_stat_clear_snapshot()'
        );
        const activity = await websiteBlocker.query(`
          SELECT pid
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%FOR UPDATE OF w%'
            AND pg_backend_pid() =
                ANY(pg_blocking_pids(pid))
        `);

        if (activity.rowCount === 1) {
          publisherPid = activity.rows[0].pid;
          break;
        }

        await new Promise(resolve =>
          setTimeout(resolve, 50)
        );
      }

      if (publisherPid === undefined) {
        await websiteBlocker.query(
          'SELECT pg_stat_clear_snapshot()'
        );
        const diagnostics = await websiteBlocker.query(`
          SELECT
            pid,
            state,
            wait_event_type,
            wait_event,
            pg_blocking_pids(pid) AS blockers,
            left(query, 500) AS query
          FROM pg_stat_activity
          WHERE datname = current_database()
          ORDER BY pid
        `);

        console.log(
          'PUBLISHER LOCK DIAGNOSTICS:',
          diagnostics.rows
        );
      }

      expect(publisherPid).toBeDefined();

      refund = pool.query(`
        UPDATE public.purchases
        SET status = 'refunded'
        WHERE id = $1
      `, [targetPurchase]);

      let refundWaiting = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        await websiteBlocker.query(
          'SELECT pg_stat_clear_snapshot()'
        );
        const activity = await websiteBlocker.query(`
          SELECT EXISTS (
            SELECT 1
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query LIKE '%UPDATE public.purchases%'
              AND $1::int = ANY(pg_blocking_pids(pid))
          ) AS waiting
        `, [publisherPid]);

        if (activity.rows[0].waiting) {
          refundWaiting = true;
          break;
        }

        await new Promise(resolve =>
          setTimeout(resolve, 50)
        );
      }

      if (!refundWaiting) {
        await websiteBlocker.query(
          'SELECT pg_stat_clear_snapshot()'
        );
        const diagnostics = await websiteBlocker.query(`
          SELECT
            pid,
            state,
            wait_event_type,
            wait_event,
            pg_blocking_pids(pid) AS blockers,
            left(query, 350) AS query
          FROM pg_stat_activity
          WHERE datname = current_database()
          ORDER BY pid
        `);

        console.log('LOCK DIAGNOSTICS:', diagnostics.rows);
        console.log('Expected publisher PID:', publisherPid);
      }

      expect(refundWaiting).toBe(true);

      console.log('PASS: Refund waits behind publication transaction');

      await websiteBlocker.query('COMMIT');

      expect((await publication).status).toBe(200);
      await refund;

      const finalState = await pool.query(`
        SELECT
          p.status AS purchase_status,
          e.status AS entitlement_status,
          (
            SELECT count(*)::int
            FROM public.website_publications
            WHERE website_id = $1
          ) AS snapshots
        FROM public.websites w
        JOIN public.entitlements e
          ON e.id = w.entitlement_id
        JOIN public.purchases p
          ON p.id = e.purchase_id
        WHERE w.id = $1
      `, [target]);

      expect(finalState.rows[0]).toEqual({
        purchase_status: 'refunded',
        entitlement_status: 'suspended',
        snapshots: 2
      });

      const publicResponse = await execute('curl', [
        '--noproxy', '*',
        '--connect-timeout', '5',
        '--max-time', '30',
        '-sS',
        '-H', `Host: ${targetSlug}.localhost:${httpPort}`,
        '-w', '\\n%{http_code}',
        `http://127.0.0.1:${httpPort}/`
      ]);

      expect(publicResponse.stdout.trim().endsWith('404'))
        .toBe(true);

      expect(publicResponse.stdout).not.toContain(updated);

      console.log('PASS: Publication-first refund ordering verified');
      console.log('PASS: Refunded publication no longer publicly accessible');

    } finally {
      await websiteBlocker.query('ROLLBACK').catch(() => {});

      if (publication) {
        await publication.catch(() => {});
      }

      if (refund) {
        await refund.catch(() => {});
      }

      websiteBlocker.release();
    }


  } finally {
    identity.userId = owner;

    try {
      await competitor.query('ROLLBACK');
      await competitor.query('BEGIN');

      await competitor.query(`
        UPDATE public.websites
        SET current_publication_id = NULL,
            publication_status = 'draft'
        WHERE id = $1 AND owner_clerk_user_id = $2
      `, [competingWebsite, competingOwner]);

      await competitor.query(`
        DELETE FROM public.websites
        WHERE id = $1 AND owner_clerk_user_id = $2
      `, [competingWebsite, competingOwner]);

      await competitor.query(`
        DELETE FROM public.entitlements
        WHERE id = $1 AND owner_clerk_user_id = $2
      `, [competingEntitlement, competingOwner]);

      await competitor.query(`
        DELETE FROM public.purchases
        WHERE id = $1 AND buyer_clerk_user_id = $2
      `, [competingPurchase, competingOwner]);

      await competitor.query(`
        UPDATE public.websites
        SET current_publication_id = NULL,
            publication_status = 'draft'
        WHERE id = $1 AND owner_clerk_user_id = $2
      `, [racingWebsite, racingOwner]);

      await competitor.query(`
        DELETE FROM public.websites
        WHERE id = $1 AND owner_clerk_user_id = $2
      `, [racingWebsite, racingOwner]);

      await competitor.query(`
        DELETE FROM public.entitlements
        WHERE id = $1 AND owner_clerk_user_id = $2
      `, [racingEntitlement, racingOwner]);

      await competitor.query(`
        DELETE FROM public.purchases
        WHERE id = $1 AND buyer_clerk_user_id = $2
      `, [racingPurchase, racingOwner]);

      await competitor.query('COMMIT');

      console.log('PASS: Competing fixture removed');

    } catch (error) {
      await competitor.query('ROLLBACK').catch(() => {});
      console.error('Competing fixture cleanup identifiers:', {
        competingWebsite,
        competingPurchase,
        competingEntitlement,
        competingOwner
      });
      throw error;
    } finally {
      competitor.release();
    }
  }

}, 120000);
