import { requireStripeTestMode } from '@/lib/payments/stripe-mode';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../../lib/db';

export const runtime = 'nodejs';

type Edition = {
  id: string;
  name: string;
  price_cents: string;
  currency: string;
};

type CheckoutRecord = {
  purchase_id: string;
  reservation_id: string;
  reservation_expires_at: Date;
};

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return response('Unauthorized', 401);
  }

  if (process.env.STATUS_CHECKOUT_ENABLED !== 'true') {
    return response('Checkout is not enabled', 503);
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const origin = process.env.STATUS_PUBLIC_ORIGIN;

  if (!stripeKey || !origin) {
    return response('Checkout configuration unavailable', 503);
  }

  let editionId: string;

  try {
    const body = await request.json();

    if (
      typeof body?.editionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.editionId
      )
    ) {
      return response('Invalid Edition ID', 400);
    }

    editionId = body.editionId;
  } catch {
    return response('Invalid JSON', 400);
  }

  let safeOrigin: string;

  try {
    const url = new URL(origin);

    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && url.hostname === 'localhost'))
    ) {
      return response('Invalid checkout origin configuration', 503);
    }

    safeOrigin = url.origin;
  } catch {
    return response('Invalid checkout origin configuration', 503);
  }

  requireStripeTestMode(stripeKey);
  const stripe = new Stripe(stripeKey);

  let client;

  try {
    client = await getDb().connect();
  } catch {
    return response('Database unavailable', 503);
  }

  let edition: Edition;
  let record: CheckoutRecord;

  try {
    await client.query('BEGIN');

    const editionResult = await client.query<Edition>(
      `SELECT id, name, price_cents, currency
       FROM public.edition_catalog
       WHERE id = $1 AND status = 'active'
       FOR UPDATE`,
      [editionId]
    );

    if (!editionResult.rows.length) {
      await client.query('ROLLBACK');
      return response('Edition unavailable', 404);
    }

    edition = editionResult.rows[0];

    const amount = Number(edition.price_cents);

    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > 99999999 ||
      !/^[a-z]{3}$/.test(edition.currency)
    ) {
      await client.query('ROLLBACK');
      return response('Edition pricing unavailable', 503);
    }

    const purchase = await client.query<{ id: string }>(
      `INSERT INTO public.purchases
         (buyer_clerk_user_id, edition_id, payment_provider,
          status, amount_cents, currency)
       VALUES ($1, $2, 'stripe', 'pending', $3, $4)
       RETURNING id`,
      [userId, edition.id, edition.price_cents, edition.currency]
    );

    const purchaseId = purchase.rows[0].id;

    const reservation = await client.query<{
      id: string;
      expires_at: Date;
    }>(
      `SELECT r.id, r.expires_at
       FROM public.inventory_reservations r
       WHERE r.id = public.reserve_edition_inventory($1::uuid)`,
      [purchaseId]
    );

    const reservationId = reservation.rows[0]?.id;
    const reservationExpiresAt = reservation.rows[0]?.expires_at;

    if (!reservationId || !reservationExpiresAt) {
      throw new Error('Inventory reservation unavailable');
    }

    await client.query(
      `INSERT INTO public.checkout_sessions
         (purchase_id, reservation_id,
          buyer_clerk_user_id, edition_id)
       VALUES ($1, $2, $3, $4)`,
      [purchaseId, reservationId, userId, edition.id]
    );

    await client.query('COMMIT');

    record = {
      purchase_id: purchaseId,
      reservation_id: reservationId,
      reservation_expires_at: reservationExpiresAt
    };
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return response('Unable to reserve Edition', 409);
  } finally {
    client.release();
  }

  let createdStripeSessionId: string | null = null;
  let checkoutPersisted = false;

  try {
    const remainingSeconds =
      Math.floor(record.reservation_expires_at.getTime() / 1000) -
      Math.floor(Date.now() / 1000);

    if (remainingSeconds < 31 * 60) {
      throw new Error(
        'Insufficient reservation time to create Stripe Checkout'
      );
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        client_reference_id: record.purchase_id,
        customer_creation: 'always',
        line_items: [
          {
            price_data: {
              currency: edition.currency,
              unit_amount: Number(edition.price_cents),
              product_data: {
                name: edition.name
              }
            },
            quantity: 1
          }
        ],
        success_url:
          `${safeOrigin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${safeOrigin}/checkout/cancel`,
        metadata: {
          purchase_id: record.purchase_id,
          reservation_id: record.reservation_id,
          edition_id: edition.id,
          buyer_clerk_user_id: userId
        }
      },
      {
        idempotencyKey: `status-checkout-${record.purchase_id}`
      }
    );

    if (session.id) {
      createdStripeSessionId = session.id;
    }

    if (!session.id || !session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    const persistenceClient = await getDb().connect();

    try {
      await persistenceClient.query('BEGIN');

      const updated = await persistenceClient.query(
        `UPDATE public.checkout_sessions
         SET provider_session_id = $2,
             checkout_url = $3,
             status = 'open',
             expires_at = to_timestamp($4),
             updated_at = now()
         WHERE purchase_id = $1
           AND status = 'creating'
         RETURNING id`,
        [
          record.purchase_id,
          session.id,
          session.url,
          session.expires_at
        ]
      );

      if (updated.rowCount !== 1) {
        throw new Error('Unable to persist checkout session');
      }

      const purchaseUpdated = await persistenceClient.query(
        `UPDATE public.purchases
         SET provider_checkout_id = $2,
             updated_at = now()
         WHERE id = $1
           AND status = 'pending'
         RETURNING id`,
        [record.purchase_id, session.id]
      );

      if (purchaseUpdated.rowCount !== 1) {
        throw new Error('Unable to persist purchase checkout reference');
      }

      await persistenceClient.query('COMMIT');
      checkoutPersisted = true;
    } catch (error) {
      await persistenceClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      persistenceClient.release();
    }

    return NextResponse.json({
      checkoutUrl: session.url
    });
  } catch {
    if (createdStripeSessionId && !checkoutPersisted) {
      try {
        await stripe.checkout.sessions.expire(createdStripeSessionId);
      } catch {
        // Stripe expiration is best effort. Reconciliation remains necessary.
      }
    }

    if (!checkoutPersisted) {
      try {
        await getDb().query(
          `UPDATE public.checkout_sessions
           SET status = 'failed', updated_at = now()
           WHERE purchase_id = $1 AND status = 'creating'`,
          [record.purchase_id]
        );
      } catch {
        // Preserve the original failure response.
      }
    }

    return response('Unable to create checkout session', 502);
  }
}
