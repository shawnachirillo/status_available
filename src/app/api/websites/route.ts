import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';

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
    const result = await getDb().query<{
      id: string;
      name: string;
      edition: string;
      publication_status: string;
    }>(
      `SELECT
         w.id,
         w.name,
         w.edition_id AS edition,
         w.publication_status
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
       WHERE w.owner_clerk_user_id = $1
         AND e.status = 'active'
         AND p.status = 'paid'
         AND w.publication_status IN ('draft', 'published')
         AND w.hosting_starts_at <= now()
         AND w.hosting_ends_at > now()
       ORDER BY w.created_at DESC, w.id DESC`,
      [userId]
    );

    return NextResponse.json({
      websites: result.rows
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to load websites' },
      { status: 500 }
    );
  }
}
