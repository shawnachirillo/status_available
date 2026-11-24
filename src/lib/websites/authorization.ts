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
     JOIN public.entitlements e
       ON e.id = w.entitlement_id
      AND e.edition_id = w.edition_catalog_id
      AND e.owner_clerk_user_id = w.owner_clerk_user_id
     JOIN public.purchases p
       ON p.id = e.purchase_id
      AND p.edition_id = e.edition_id
      AND p.buyer_clerk_user_id = e.owner_clerk_user_id
     JOIN public.edition_catalog ec
       ON ec.id = w.edition_catalog_id
      AND ec.slug = w.edition_id
     WHERE w.id = $1::uuid
       AND w.owner_clerk_user_id = $2
       AND e.status = 'active'
       AND p.status = 'paid'
       AND w.publication_status IN ('draft', 'published')
       AND w.hosting_starts_at <= clock_timestamp()
       AND w.hosting_ends_at > clock_timestamp()
     ${lock ? 'FOR UPDATE OF w' : ''}
     LIMIT 1`,
    [websiteId, userId]
  );

  return result.rows[0] ?? null;
}
