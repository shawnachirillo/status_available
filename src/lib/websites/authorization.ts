import 'server-only';
import type { PoolClient, Pool } from 'pg';

export const websiteIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validWebsiteId(value: unknown): value is string {
  return typeof value === 'string' && websiteIdPattern.test(value);
}

export type EditableWebsite = {
  id: string;
  version: string;
  edition_id: string;
  draft_content: unknown;
};

type QueryClient = Pick<PoolClient, 'query'> | Pick<Pool, 'query'>;

// This predicate expects the website row to be aliased as w.
export const editableWebsiteEligibility = `
  w.publication_status IN ('draft', 'published')
  AND public.website_hosting_operational(
    w.hosting_starts_at,
    w.hosting_ends_at,
    clock_timestamp()
  )
  AND EXISTS (
    SELECT 1
    FROM public.entitlements e
    JOIN public.purchases p
      ON p.id = e.purchase_id
     AND p.edition_id = e.edition_id
     AND p.buyer_clerk_user_id = e.owner_clerk_user_id
    JOIN public.edition_catalog ec
      ON ec.id = e.edition_id
     AND ec.slug = w.edition_id
    WHERE e.id = w.entitlement_id
      AND e.edition_id = w.edition_catalog_id
      AND e.owner_clerk_user_id = w.owner_clerk_user_id
      AND e.status = 'active'
      AND p.status = 'paid'
  )
`;

export async function lockWebsiteOwnership(
  client: QueryClient,
  websiteId: string,
  userId: string
): Promise<boolean> {
  // Lock purchase, entitlement and website in that order.
  // Payment-status transitions must not race website writes.
  const purchase = await client.query(`
    SELECT p.id
    FROM public.purchases p
    JOIN public.entitlements e
      ON e.purchase_id = p.id
    JOIN public.websites w
      ON w.entitlement_id = e.id
    WHERE w.id = $1::uuid
      AND w.owner_clerk_user_id = $2
    FOR UPDATE OF p
  `, [websiteId, userId]);

  if (purchase.rowCount !== 1) {
    return false;
  }

  const entitlement = await client.query(`
    SELECT e.id
    FROM public.entitlements e
    JOIN public.websites w
      ON w.entitlement_id = e.id
    WHERE w.id = $1::uuid
      AND w.owner_clerk_user_id = $2
    FOR UPDATE OF e
  `, [websiteId, userId]);

  if (entitlement.rowCount !== 1) {
    return false;
  }

  return true;
}

/**
 * Authorization is evaluated against the database, never against
 * an Edition or owner value supplied by the browser.
 *
 * In write transactions, lock the website row before reading its
 * version or updating its draft.
 */
export async function findEditableWebsite(
  client: QueryClient,
  websiteId: string,
  userId: string,
  lock = false
): Promise<EditableWebsite | null> {
  const result = await client.query<EditableWebsite>(
    `SELECT
       w.id,
       w.version,
       w.edition_id,
       w.draft_content
     FROM public.websites w
     WHERE w.id = $1::uuid
       AND w.owner_clerk_user_id = $2
       AND ${editableWebsiteEligibility}
     ${lock ? 'FOR UPDATE OF w' : ''}
     LIMIT 1`,
    [websiteId, userId]
  );

  return result.rows[0] ?? null;
}
