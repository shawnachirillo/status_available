import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { validDraft } from '../../../../lib/draft-validation';
import {
  findEditableWebsite,
  validWebsiteId
} from '../../../../lib/websites/authorization';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 }
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }

  const {
    websiteId,
    revisionId,
    expectedVersion
  } = body as Record<string, unknown>;

  if (
    !validWebsiteId(websiteId) ||
    !validWebsiteId(revisionId) ||
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    return NextResponse.json(
      { error: 'Invalid restore request' },
      { status: 400 }
    );
  }

  const client = await getDb().connect().catch(() => null);

  if (!client) {
    return NextResponse.json(
      { error: 'Database unavailable' },
      { status: 503 }
    );
  }

  try {
    await client.query('BEGIN');

    const website = await findEditableWebsite(
      client,
      websiteId,
      userId,
      true
    );

    if (!website) {
      await client.query('ROLLBACK');

      return NextResponse.json(
        { error: 'Website not found' },
        { status: 404 }
      );
    }

    if (Number(website.version) !== expectedVersion) {
      await client.query('ROLLBACK');

      return NextResponse.json(
        { error: 'Version conflict' },
        { status: 409 }
      );
    }

    const revision = await client.query<{ content: unknown }>(
      `SELECT content
       FROM public.website_revisions
       WHERE id = $1::uuid
         AND website_id = $2::uuid`,
      [revisionId, websiteId]
    );

    if (revision.rows.length !== 1) {
      await client.query('ROLLBACK');

      return NextResponse.json(
        { error: 'Revision not found' },
        { status: 404 }
      );
    }

    const content = revision.rows[0].content;

    if (!validDraft(content)) {
      await client.query('ROLLBACK');

      return NextResponse.json(
        { error: 'Stored revision is invalid' },
        { status: 422 }
      );
    }

    if (content.edition !== website.edition_id) {
      await client.query('ROLLBACK');

      return NextResponse.json(
        { error: 'Revision Edition does not match purchase' },
        { status: 403 }
      );
    }

    const updated = await client.query(
      `UPDATE public.websites
       SET name = $2,
           draft_content = $3::jsonb,
           version = version + 1,
           updated_at = now()
       WHERE id = $1::uuid
         AND owner_clerk_user_id = $4
         AND version = $5
       RETURNING id`,
      [
        websiteId,
        content.business,
        JSON.stringify(content),
        userId,
        expectedVersion
      ]
    );

    if (updated.rowCount !== 1) {
      throw new Error('Website restore was not confirmed');
    }

    await client.query(
      `INSERT INTO public.website_revisions
         (website_id, content)
       VALUES ($1::uuid, $2::jsonb)`,
      [websiteId, JSON.stringify(content)]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      restored: true,
      websiteId,
      draft: content,
      version: expectedVersion + 1
    });
  } catch {
    await client.query('ROLLBACK').catch(() => {});

    return NextResponse.json(
      { error: 'Unable to restore revision' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
