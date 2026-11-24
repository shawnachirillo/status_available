import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';
import { validDraft } from '../../../lib/draft-validation';
import {
  findEditableWebsite,
  validWebsiteId
} from '../../../lib/websites/authorization';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const websiteId = new URL(request.url).searchParams.get('websiteId');

  if (!validWebsiteId(websiteId)) {
    return NextResponse.json(
      { error: 'Valid website ID required' },
      { status: 400 }
    );
  }

  try {
    const website = await findEditableWebsite(
      getDb(),
      websiteId,
      userId
    );

    if (!website) {
      return NextResponse.json(
        { error: 'Website not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      websiteId: website.id,
      draft: website.draft_content,
      version: Number(website.version)
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to load draft' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
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

  const payload = body as Record<string, unknown>;
  const { websiteId, draft, expectedVersion } = payload;

  if (
    !validWebsiteId(websiteId) ||
    !validDraft(draft) ||
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    return NextResponse.json(
      { error: 'Invalid draft request' },
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

    // A customer's purchased Edition is immutable.
    if (draft.edition !== website.edition_id) {
      await client.query('ROLLBACK');

      return NextResponse.json(
        { error: 'Purchased Edition cannot be changed' },
        { status: 403 }
      );
    }

    if (Number(website.version) !== expectedVersion) {
      await client.query('ROLLBACK');

      return NextResponse.json(
        { error: 'Version conflict' },
        { status: 409 }
      );
    }

    const nextVersion = expectedVersion + 1;

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
        draft.business,
        JSON.stringify(draft),
        userId,
        expectedVersion
      ]
    );

    if (updated.rowCount !== 1) {
      throw new Error('Website update was not confirmed');
    }

    await client.query(
      `INSERT INTO public.website_revisions
         (website_id, content)
       VALUES ($1::uuid, $2::jsonb)`,
      [websiteId, JSON.stringify(draft)]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      saved: true,
      websiteId,
      version: nextVersion
    });
  } catch {
    await client.query('ROLLBACK').catch(() => {});

    return NextResponse.json(
      { error: 'Unable to save draft' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
