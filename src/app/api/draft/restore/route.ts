import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { validDraft } from '../../../../lib/draft-validation';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  let revisionId: unknown;
  let expectedVersion: unknown;

  try {
    const body = await request.json();
    revisionId = body?.revisionId;
    expectedVersion = body?.expectedVersion;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 }
    );
  }

  if (
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    typeof revisionId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revisionId)
  ) {
    return NextResponse.json(
      { error: 'Invalid revision ID' },
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

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [userId]
    );

    const result = await client.query<{
      website_id: string;
      content: unknown;
      version: string;
    }>(
      `SELECT r.website_id, r.content, w.version
       FROM public.website_revisions r
       JOIN public.websites w ON w.id = r.website_id
       WHERE r.id = $1::uuid
         AND w.owner_clerk_user_id = $2
         AND w.id = (
           SELECT id
           FROM public.websites
           WHERE owner_clerk_user_id = $2
           ORDER BY updated_at DESC, id DESC
           LIMIT 1
         )
       FOR UPDATE OF w`,
      [revisionId, userId]
    );

    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Revision not found' },
        { status: 404 }
      );
    }

    const { website_id: websiteId, content, version } = result.rows[0];

    if (Number(version) !== expectedVersion) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Version conflict' },
        { status: 409 }
      );
    }

    if (!validDraft(content)) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Stored revision is invalid' },
        { status: 422 }
      );
    }

    await client.query(
      `UPDATE public.websites
       SET edition_id = $2,
           name = $3,
           draft_content = $4::jsonb,
           updated_at = now(),
           version = version + 1
       WHERE id = $1 AND owner_clerk_user_id = $5`,
      [
        websiteId,
        content.edition,
        content.business,
        JSON.stringify(content),
        userId
      ]
    );

    await client.query(
      `INSERT INTO public.website_revisions (website_id, content)
       VALUES ($1, $2::jsonb)`,
      [websiteId, JSON.stringify(content)]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      restored: true,
      draft: content,
      version: Number(version) + 1
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
