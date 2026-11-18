import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const result = await getDb().query(
      `SELECT r.id, r.created_at
       FROM public.website_revisions r
       JOIN public.websites w ON w.id = r.website_id
       WHERE w.owner_clerk_user_id = $1
         AND w.id = (
           SELECT id
           FROM public.websites
           WHERE owner_clerk_user_id = $1
           ORDER BY updated_at DESC, id DESC
           LIMIT 1
         )
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 50`,
      [userId]
    );

    return NextResponse.json({ revisions: result.rows });
  } catch {
    return NextResponse.json(
      { error: 'Unable to load revisions' },
      { status: 500 }
    );
  }
}
