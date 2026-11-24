import 'server-only';
import type Stripe from 'stripe';
import type { PoolClient } from 'pg';
import { getDb } from '../db';
import { getEdition } from '../editions';

export type FulfillmentResult =
  | 'fulfilled'
  | 'already_fulfilled'
  | 'reconciliation_required'
  | 'ignored';

type PurchaseRow = {
  id: string;
  buyer_clerk_user_id: string;
  edition_id: string;
  amount_cents: string;
  currency: string;
  status: string;
  provider_checkout_id: string | null;
  provider_payment_id: string | null;
  reservation_id: string;
  reservation_status: string;
  reservation_expires_at: Date;
};


async function ensurePurchasedWebsite(
  client: PoolClient,
  purchase: Pick<
    PurchaseRow,
    'id' | 'edition_id' | 'buyer_clerk_user_id'
  >
): Promise<void> {
  const entitlement = await client.query<{
    id: string;
    edition_id: string;
    owner_clerk_user_id: string;
  }>(
    `SELECT id, edition_id, owner_clerk_user_id
     FROM public.entitlements
     WHERE purchase_id = $1
     AND status = 'active'
     FOR UPDATE`,
    [purchase.id]
  );

  if (entitlement.rows.length !== 1) {
    throw new Error('Active purchase entitlement not found');
  }

  const edition = await client.query<{
    slug: string;
    name: string;
  }>(
    `SELECT slug, name
     FROM public.edition_catalog
     WHERE id = $1`,
    [purchase.edition_id]
  );

  if (edition.rows.length !== 1) {
    throw new Error('Purchased edition not found');
  }

  const editionSlug = edition.rows[0].slug;
  const design = getEdition(editionSlug);

  if (!design) {
    throw new Error(
    'Purchased Edition has no compatible website design'
    );
  }

  const initialDraft = {
    edition: editionSlug,
    business: 'Your studio',
    headline: 'Your presence, made your own.',
    description: '',
    email: '',
    phone: '',
    booking: '',
    palette: 0
  };

  const provisioned = await client.query<{ id: string }>(
    `INSERT INTO public.websites (
     owner_clerk_user_id,
     edition_id,
     edition_catalog_id,
     entitlement_id,
     name,
     draft_content,
     version,
     publication_status,
     hosting_starts_at,
     hosting_ends_at
     )
     VALUES (
     $1, $2, $3, $4, $5, $6::jsonb,
     0, 'draft', now(), now() + interval '12 months'
     )
     ON CONFLICT (entitlement_id) DO NOTHING
     RETURNING id`,
    [
    entitlement.rows[0].owner_clerk_user_id,
    editionSlug,
    entitlement.rows[0].edition_id,
    entitlement.rows[0].id,
    edition.rows[0].name,
    JSON.stringify(initialDraft)
    ]
  );

  if (provisioned.rows.length === 0) {
    const existingWebsite = await client.query<{ id: string }>(
    `SELECT id
     FROM public.websites
     WHERE entitlement_id = $1
       AND owner_clerk_user_id = $2
       AND edition_catalog_id = $3`,
    [
      entitlement.rows[0].id,
      entitlement.rows[0].owner_clerk_user_id,
      entitlement.rows[0].edition_id
    ]
    );

    if (existingWebsite.rows.length !== 1) {
    throw new Error('Website provisioning identity mismatch');
    }
  }


}

export async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<FulfillmentResult> {
  if (
    session.mode !== 'payment' ||
    session.payment_status !== 'paid' ||
    !session.id
  ) {
    return 'ignored';
  }

  const purchaseId = session.metadata?.purchase_id;
  const reservationId = session.metadata?.reservation_id;
  const paymentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!purchaseId || !reservationId || !paymentId) {
    return 'reconciliation_required';
  }

  const client = await getDb().connect();

  try {
    await client.query('BEGIN');

    const editionLookup = await client.query<{ edition_id: string }>(
      `SELECT edition_id
       FROM public.purchases
       WHERE id = $1`,
      [purchaseId]
    );

    if (!editionLookup.rows.length) {
      await client.query('ROLLBACK');
      return 'reconciliation_required';
    }

    await client.query(
      `SELECT id
       FROM public.edition_catalog
       WHERE id = $1
       FOR UPDATE`,
      [editionLookup.rows[0].edition_id]
    );

    const result = await client.query<PurchaseRow>(
      `SELECT
         p.id,
         p.buyer_clerk_user_id,
         p.edition_id,
         p.amount_cents,
         p.currency,
         p.status,
         p.provider_checkout_id,
         p.provider_payment_id,
         r.id AS reservation_id,
         r.status AS reservation_status,
         r.expires_at AS reservation_expires_at
       FROM public.purchases p
       JOIN public.inventory_reservations r
         ON r.purchase_id = p.id
       WHERE p.id = $1
       FOR UPDATE OF p, r`,
      [purchaseId]
    );

    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return 'reconciliation_required';
    }

    const purchase = result.rows[0];

    const checkout = await client.query<{
      provider_session_id: string | null;
      reservation_id: string;
      buyer_clerk_user_id: string;
      edition_id: string;
    }>(
      `SELECT provider_session_id,
              reservation_id,
              buyer_clerk_user_id,
              edition_id
       FROM public.checkout_sessions
       WHERE purchase_id = $1
       FOR UPDATE`,
      [purchase.id]
    );

    const checkoutRow = checkout.rows[0];

    const identityMatches =
      checkoutRow !== undefined &&
      checkoutRow.provider_session_id === session.id &&
      checkoutRow.reservation_id === reservationId &&
      checkoutRow.buyer_clerk_user_id === purchase.buyer_clerk_user_id &&
      checkoutRow.edition_id === purchase.edition_id &&
      purchase.reservation_id === reservationId &&
      purchase.provider_checkout_id === session.id &&
      session.metadata?.edition_id === purchase.edition_id &&
      session.metadata?.buyer_clerk_user_id ===
        purchase.buyer_clerk_user_id &&
      session.client_reference_id === purchase.id;

    const paymentMatches =
      session.amount_total === Number(purchase.amount_cents) &&
      session.currency?.toLowerCase() ===
        purchase.currency.toLowerCase();

    if (
      !identityMatches ||
      !paymentMatches ||
      (purchase.provider_payment_id &&
        purchase.provider_payment_id !== paymentId)
    ) {
      await client.query(
        `INSERT INTO public.payment_reconciliation
           (purchase_id, reason, status, details)
         VALUES (
           $1,
           'payment_mismatch',
           'needs_review',
           $2::jsonb
         )
         ON CONFLICT (purchase_id) DO NOTHING`,
        [
          purchase.id,
          JSON.stringify({
            stripe_session_id: session.id,
            stripe_payment_id: paymentId
          })
        ]
      );

      await client.query('COMMIT');
      return 'reconciliation_required';
    }

    if (
      purchase.status === 'paid' &&
      purchase.reservation_status === 'converted'
    ) {
      await ensurePurchasedWebsite(client, purchase);
      await client.query('COMMIT');
      return 'already_fulfilled';
    }

    if (
      purchase.status !== 'pending' ||
      purchase.reservation_status !== 'held' ||
      purchase.reservation_expires_at.getTime() <= Date.now()
    ) {
      const paymentEvidence = await client.query(
        `UPDATE public.purchases
         SET provider_payment_id = $2,
             updated_at = now()
         WHERE id = $1
           AND (
             provider_payment_id IS NULL
             OR provider_payment_id = $2
           )
         RETURNING id`,
        [purchase.id, paymentId]
      );

      if (paymentEvidence.rowCount !== 1) {
        throw new Error(
          'Unable to preserve verified Stripe payment reference'
        );
      }

      await client.query(
        `INSERT INTO public.payment_reconciliation
           (purchase_id, reason, status, details)
         VALUES (
           $1,
           'reservation_expired',
           'needs_review',
           $2::jsonb
         )
         ON CONFLICT (purchase_id) DO NOTHING`,
        [
          purchase.id,
          JSON.stringify({
            stripe_session_id: session.id,
            stripe_payment_id: paymentId
          })
        ]
      );

      await client.query('COMMIT');
      return 'reconciliation_required';
    }

    await client.query(
      `UPDATE public.purchases
       SET status = 'paid',
           provider_payment_id = $2,
           paid_at = now(),
           updated_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [purchase.id, paymentId]
    );

    const conversion = await client.query<{
      converted: boolean;
    }>(
      `SELECT public.convert_inventory_reservation(
         $1::uuid,
         $2::uuid
       ) AS converted`,
      [reservationId, purchase.id]
    );

    if (
      conversion.rowCount !== 1 ||
      conversion.rows[0]?.converted !== true
    ) {
      throw new Error(
        'Inventory conversion did not confirm success'
      );
    }

    await client.query(
      `INSERT INTO public.entitlements
         (purchase_id, edition_id, owner_clerk_user_id, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (purchase_id) DO NOTHING`,
      [
        purchase.id,
        purchase.edition_id,
        purchase.buyer_clerk_user_id
      ]
    );

    await ensurePurchasedWebsite(client, purchase);

    await client.query(
      `UPDATE public.checkout_sessions
       SET status = 'completed',
           updated_at = now()
       WHERE purchase_id = $1
         AND provider_session_id = $2`,
      [purchase.id, session.id]
    );

    await client.query('COMMIT');
    return 'fulfilled';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
