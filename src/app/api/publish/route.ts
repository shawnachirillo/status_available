import { auth } from '@clerk/nextjs/server';
import { getDb } from '../../../lib/db';
import {
  validWebsiteId,
  findEditableWebsite,
  lockWebsiteOwnership
} from '../../../lib/websites/authorization';
import { validDraft } from '../../../lib/draft-validation';
import {
  validPublicationSlug
} from '../../../lib/websites/publication-slug';

import {
  publicationContent,
  safeHref
} from '../../../lib/websites/design';

export const runtime = 'nodejs';

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return reply({ error: 'Unauthorized' }, 401);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return reply({ error: 'Invalid request' }, 400);
  }

  if (!body || typeof body !== 'object') {
    return reply({ error: 'Invalid request' }, 400);
  }

  const {
    websiteId,
    expectedVersion,
    slug
  } = body;

  if (
    !validWebsiteId(websiteId) ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    (slug !== undefined && !validPublicationSlug(slug))
  ) {
    return reply({ error: 'Invalid publication request' }, 400);
  }

  const client = await Promise.resolve().then(() => getDb().connect()).catch(() => null);

  if (!client) {
    return reply({ error: 'Publishing unavailable' }, 503);
  }

  try {
    await client.query('BEGIN');

    async function reject(message: string, status: number) {
      await client!.query('ROLLBACK');
      return reply({ error: message }, status);
    }

    if (!(await lockWebsiteOwnership(client, websiteId, userId))) {
      return await reject('Website not found', 404);
    }

    const lockedWebsite = await findEditableWebsite(
      client,
      websiteId,
      userId,
      true
    );

    if (!lockedWebsite) {
      return await reject('Website not found', 404);
    }

    // Re-evaluate eligibility in a fresh statement after
    // acquiring all transaction locks. Hosting may have
    // expired while waiting for the website lock.
    const website = await findEditableWebsite(
      client,
      websiteId,
      userId
    );

    if (!website) {
      return await reject('Website not found', 404);
    }

    if (Number(website.version) !== expectedVersion) {
      return await reject(
        'Draft has changed. Refresh before publishing.',
        409
      );
    }

    const draft = website.draft_content;

    if (!validDraft(draft)) {
      return await reject('Saved draft is invalid', 422);
    }

    if (draft.edition !== website.edition_id) {
      return await reject('Purchased Edition mismatch', 403);
    }

    if (
      !draft.business.trim() ||
      !draft.headline.trim() ||
      !draft.description.trim()
    ) {
      return await reject(
        'Business name, headline and introduction are required',
        422
      );
    }

    for (const kind of ['email', 'phone', 'booking'] as const) {
      if (draft[kind].trim() && !safeHref(kind, draft[kind])) {
        return await reject(
          `Invalid ${kind} contact information`,
          422
        );
      }
    }

    const current = await client.query(`
      SELECT
        w.public_slug,
        w.publication_status,
        w.current_publication_id,
        p.publication_version,
        p.source_draft_version,
        p.published_at
      FROM public.websites w
      LEFT JOIN public.website_publications p
        ON p.id = w.current_publication_id
        AND p.website_id = w.id
      WHERE w.id = $1::uuid
    `, [websiteId]);

    const existing = current.rows[0];

    if (
      existing.public_slug &&
      slug !== undefined &&
      slug !== existing.public_slug
    ) {
      return await reject(
        'Published website address cannot be changed here',
        409
      );
    }

    const publicSlug = existing.public_slug ?? slug;

    if (!validPublicationSlug(publicSlug)) {
      return await reject('Choose a valid website address', 400);
    }

    // Repeated requests for the same saved draft are safe.
    if (
      existing.publication_status === 'published' &&
      existing.current_publication_id &&
      Number(existing.source_draft_version) === expectedVersion
    ) {
      const eligible = await findEditableWebsite(
        client,
        websiteId,
        userId
      );

      if (!eligible) {
        return await reject('Website is no longer eligible', 409);
      }

      await client.query('COMMIT');

      return reply({
        published: true,
        websiteId,
        slug: publicSlug,
        publicationId: existing.current_publication_id,
        publicationVersion: Number(existing.publication_version),
        sourceDraftVersion: expectedVersion,
        publishedAt: existing.published_at,
        unchanged: true
      });
    }

    const sequence = await client.query(`
      SELECT COALESCE(MAX(publication_version), 0) + 1
        AS next_version
      FROM public.website_publications
      WHERE website_id = $1::uuid
    `, [websiteId]);

    const publicationVersion = Number(
      sequence.rows[0].next_version
    );

    if (!Number.isSafeInteger(publicationVersion)) {
      throw new Error('Invalid publication version');
    }

    const snapshot = await client.query(`
      INSERT INTO public.website_publications (
        website_id,
        publication_version,
        source_draft_version,
        edition_id,
        content,
        renderer_version
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, 1)
      RETURNING id, published_at
    `, [
      websiteId,
      publicationVersion,
      expectedVersion,
      website.edition_id,
      JSON.stringify(publicationContent(draft))
    ]);

    const publication = snapshot.rows[0];

    const updated = await client.query(`
      UPDATE public.websites
      SET
        public_slug = $1,
        current_publication_id = $2,
        publication_status = 'published',
        updated_at = now()
      WHERE id = $3::uuid
        AND owner_clerk_user_id = $4
        AND version = $5
        AND public.website_hosting_operational(
          hosting_starts_at,
          hosting_ends_at,
          clock_timestamp()
        )
      RETURNING id
    `, [
      publicSlug,
      publication.id,
      websiteId,
      userId,
      expectedVersion
    ]);

    if (updated.rowCount !== 1) {
      return await reject('Website is no longer eligible', 409);
    }

    await client.query('COMMIT');

    return reply({
      published: true,
      websiteId,
      slug: publicSlug,
      publicationId: publication.id,
      publicationVersion,
      sourceDraftVersion: expectedVersion,
      publishedAt: publication.published_at,
      unchanged: false
    });

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    const failure = error as {
      code?: string;
      constraint?: string;
    };

    if (
      failure.code === '23505' &&
      failure.constraint === 'website_public_slug_unique'
    ) {
      return reply({
        error: 'That website address is unavailable'
      }, 409);
    }

    return reply({ error: 'Unable to publish website' }, 500);

  } finally {
    client.release();
  }
}
