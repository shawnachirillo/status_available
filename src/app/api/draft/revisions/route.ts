import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import {
  findEditableWebsite,
  validWebsiteId
} from '../../../../lib/websites/authorization';

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
    const db = getDb();

    const website = await findEditableWebsite(
      db,
      websiteId,
      userId
    );

    if (!website) {
      return NextResponse.json(
        { error: 'Website not found' },
        { status: 404 }
      );
    }

    const result = await db.query(
      `SELECT r.id, r.created_at
       FROM public.website_revisions r
       JOIN public.websites w ON w.id = r.website_id
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
       WHERE r.website_id = $1::uuid
         AND w.owner_clerk_user_id = $2
         AND e.status = 'active'
         AND p.status = 'paid'
         AND w.publication_status IN ('draft', 'published')
         AND w.hosting_starts_at <= now()
         AND w.hosting_ends_at > now()
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 50`,
      [websiteId, userId]
    );

    return NextResponse.json({
      websiteId,
      revisions: result.rows
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to load revisions' },
      { status: 500 }
    );
  }
}
