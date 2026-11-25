import 'server-only';
import { publicationContent } from './design';

import { getDb } from '../db';
import { validDraft } from '../draft-validation';
import { validPublicationSlug } from './publication-slug';

export async function getPublicWebsite(slug: string) {
  if (!validPublicationSlug(slug)) {
    return null;
  }

  const result = await getDb().query(`
    SELECT
      w.public_slug,
      s.content,
      s.renderer_version,
      s.published_at
    FROM public.websites w

    JOIN public.website_publications s
      ON s.id = w.current_publication_id
      AND s.website_id = w.id
      AND s.edition_id = w.edition_id

    JOIN public.entitlements e
      ON e.id = w.entitlement_id
      AND e.owner_clerk_user_id = w.owner_clerk_user_id
      AND e.edition_id = w.edition_catalog_id

    JOIN public.purchases p
      ON p.id = e.purchase_id
      AND p.buyer_clerk_user_id = e.owner_clerk_user_id
      AND p.edition_id = e.edition_id

    JOIN public.edition_catalog ec
      ON ec.id = w.edition_catalog_id
      AND ec.slug = w.edition_id

    WHERE w.public_slug = $1
      AND w.publication_status = 'published'
      AND e.status = 'active'
      AND p.status = 'paid'
      AND public.website_hosting_operational(
        w.hosting_starts_at,
        w.hosting_ends_at,
        clock_timestamp()
      )

    LIMIT 1
  `, [slug]);

  const publication = result.rows[0];

  if (!publication) {
    return null;
  }

  if (
    publication.renderer_version !== 1 ||
    !validDraft(publication.content)
  ) {
    return null;
  }

  return {
    slug: publication.public_slug as string,
    content: publicationContent(publication.content),
    rendererVersion: 1 as const,
    publishedAt: publication.published_at
  };
}
