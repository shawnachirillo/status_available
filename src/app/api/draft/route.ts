import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';
import { validDraft } from '../../../lib/draft-validation';

export const runtime = 'nodejs';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await getDb().query(
      `SELECT draft_content, version
       FROM public.websites
       WHERE owner_clerk_user_id = $1
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [userId]
    );

    return NextResponse.json({
      draft: result.rows[0]?.draft_content ?? null,
      version: Number(result.rows[0]?.version ?? 0)
    });
  } catch {
    return NextResponse.json({ error: 'Unable to load draft' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let draft: unknown;
  let expectedVersion: unknown;
  try {
    const body = await request.json();
    draft = body?.draft;
    expectedVersion = body?.expectedVersion;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (
    !validDraft(draft) ||
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    return NextResponse.json({ error: 'Invalid draft' }, { status: 400 });
  }

  const client = await getDb().connect().catch(() => null);
  if (!client) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }

  try {
    await client.query('BEGIN');

    // Serialize saves for the same Clerk account.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [userId]
    );

    const existing = await client.query<{ id: string; version: string }>(
      `SELECT id, version FROM public.websites
       WHERE owner_clerk_user_id = $1
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [userId]
    );

    let websiteId: string;
    let nextVersion: number;

    if (existing.rows.length) {
      websiteId = existing.rows[0].id;

      if (Number(existing.rows[0].version) !== expectedVersion) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Version conflict' },
          { status: 409 }
        );
      }

      nextVersion = expectedVersion + 1;
      await client.query(
        `UPDATE public.websites
         SET edition_id = $2,
             name = $3,
             draft_content = $4::jsonb,
             updated_at = now(),
             version = version + 1
         WHERE id = $1 AND owner_clerk_user_id = $5`,
        [websiteId, draft.edition, draft.business, JSON.stringify(draft), userId]
      );
    } else {
      if (expectedVersion !== 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Version conflict' },
          { status: 409 }
        );
      }

      nextVersion = 1;

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO public.websites
           (owner_clerk_user_id, edition_id, name, draft_content, version)
         VALUES ($1, $2, $3, $4::jsonb, 1)
         RETURNING id`,
        [userId, draft.edition, draft.business, JSON.stringify(draft)]
      );
      websiteId = inserted.rows[0].id;
    }

    await client.query(
      `INSERT INTO public.website_revisions (website_id, content)
       VALUES ($1, $2::jsonb)`,
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
    return NextResponse.json({ error: 'Unable to save draft' }, { status: 500 });
  } finally {
    client.release();
  }
}
