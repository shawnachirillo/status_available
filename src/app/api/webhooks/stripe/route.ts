import { requireStripeTestMode } from '@/lib/payments/stripe-mode';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getDb } from '../../../../lib/db';
import { fulfillCheckoutSession } from '../../../../lib/payments/fulfill';
import { expireCheckoutSession } from '../../../../lib/payments/expire-checkout';

export const runtime = 'nodejs';

const paymentEvents = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    return NextResponse.json(
      { error: 'Webhook unavailable' },
      { status: 503 }
    );
  }

  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing Stripe signature' },
      { status: 400 }
    );
  }

  const payload = await request.text();
  requireStripeTestMode(secretKey);
  const stripe = new Stripe(secretKey);

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret
    );
  } catch {
    return NextResponse.json(
      { error: 'Invalid Stripe signature' },
      { status: 400 }
    );
  }


  const db = getDb();

  try {
    await db.query(
      `INSERT INTO public.payment_webhook_events
         (provider_event_id, event_type, payload, status)
       VALUES ($1, $2, $3::jsonb, 'received')
       ON CONFLICT (provider_event_id) DO NOTHING`,
      [event.id, event.type, payload]
    );

    const claim = await db.query<{ status: string }>(
      `UPDATE public.payment_webhook_events
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           updated_at = now(),
           last_error = NULL
       WHERE provider_event_id = $1
         AND (
           status IN ('received', 'retry_pending')
           OR (
             status = 'processing'
             AND updated_at < now() - interval '5 minutes'
           )
         )
       RETURNING status`,
      [event.id]
    );

    if (!claim.rows.length) {
      const existing = await db.query<{ status: string }>(
        `SELECT status
         FROM public.payment_webhook_events
         WHERE provider_event_id = $1`,
        [event.id]
      );

      const status = existing.rows[0]?.status;

      if (status === 'processed' || status === 'manual_review') {
        return NextResponse.json({
          received: true,
          duplicate: true,
        });
      }

      return NextResponse.json(
        { error: 'Event processing already underway' },
        { status: 503 }
      );
    }

    let outcome: string = 'ignored';

    if (paymentEvents.has(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;

      if (
        session.object !== 'checkout.session' ||
        session.mode !== 'payment'
      ) {
        outcome = 'reconciliation_required';
      } else if (session.payment_status === 'paid') {
        outcome = await fulfillCheckoutSession(session);
      }
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      outcome = await expireCheckoutSession(session);
    }

    if (
      paymentEvents.has(event.type) &&
      (event.data.object as Stripe.Checkout.Session).payment_status === 'paid' &&
      outcome === 'ignored'
    ) {
      throw new Error('Paid checkout event was not fulfilled');
    }

    if (outcome === 'reconciliation_required') {
      await db.query(
        `UPDATE public.payment_webhook_events
         SET status = 'manual_review',
             last_error = 'Payment requires reconciliation',
             updated_at = now()
         WHERE provider_event_id = $1
           AND status = 'processing'`,
        [event.id]
      );

      return NextResponse.json({
        received: true,
        review_required: true,
      });
    }

    await db.query(
      `UPDATE public.payment_webhook_events
       SET status = 'processed',
           processed_at = now(),
           updated_at = now()
       WHERE provider_event_id = $1
         AND status = 'processing'`,
      [event.id]
    );

    return NextResponse.json({ received: true });
  } catch (error) {
    try {
      await db.query(
        `UPDATE public.payment_webhook_events
         SET status = 'retry_pending',
             last_error = $2,
             updated_at = now()
         WHERE provider_event_id = $1
           AND status = 'processing'`,
        [
          event.id,
          error instanceof Error
            ? error.message.slice(0, 1000)
            : 'Unknown processing failure',
        ]
      );
    } catch {
      // Stripe receives 503 and may retry.
    }

    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 503 }
    );
  }
}
