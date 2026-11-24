import { requireStripeTestMode } from './stripe-mode';
import 'server-only';
import Stripe from 'stripe';
import { getDb } from '../db';

type RecoveryRow = {
  id: string;
  purchase_id: string;
  provider_payment_id: string;
  provider_refund_id: string | null;
  status: string;
  amount_cents: string;
  currency: string;
  purchase_payment_id: string | null;
  purchase_amount: string;
  purchase_currency: string;
};

type RefundRecoveryStripeClient = Pick<
  Stripe,
  'refunds' | 'paymentIntents'
>;

export async function recoverPaymentRefund(
  refundOperationId: string,
  stripeClient?: RefundRecoveryStripeClient
): Promise<'recovered' | 'pending' | 'manual_review'> {
  if (process.env.STATUS_REFUNDS_ENABLED !== 'true') {
    throw new Error('Refund recovery is disabled');
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (stripeClient) {
    const isolatedTest =
      process.env.STATUS_INTEGRATION_TEST_MODE === 'true' &&
      process.env.STATUS_TEST_DB_HOST === '127.0.0.1' &&
      process.env.STATUS_TEST_DB_PORT === '55432' &&
      process.env.STATUS_TEST_DB_NAME ===
        'status_payment_concurrency_test';

    if (!isolatedTest) {
      throw new Error(
        'Injected Stripe clients are permitted only in isolated tests'
      );
    }
  }

  if (!stripeClient && !secretKey) {
    throw new Error('Stripe credentials unavailable');
  }

  const db = getDb();

  const result = await db.query<RecoveryRow>(
    `SELECT r.id,
            r.purchase_id,
            r.provider_payment_id,
            r.provider_refund_id,
            r.status,
            r.amount_cents,
            r.currency,
            p.provider_payment_id AS purchase_payment_id,
            p.amount_cents AS purchase_amount,
            p.currency AS purchase_currency
     FROM public.payment_refunds r
     JOIN public.purchases p
       ON p.id = r.purchase_id
     WHERE r.id = $1`,
    [refundOperationId]
  );

  const operation = result.rows[0];

  if (!operation) {
    throw new Error('Refund operation not found');
  }

  if (operation.status === 'succeeded') {
    return 'recovered';
  }

  if (!stripeClient) {
    requireStripeTestMode(secretKey!);
  }
  const stripe = stripeClient ?? new Stripe(secretKey!);

  async function requireManualReview(reason: string) {
    await db.query(
      `UPDATE public.payment_refunds
       SET status = 'manual_review',
           last_error = $2,
           updated_at = now()
       WHERE id = $1
         AND status <> 'succeeded'`,
      [operation.id, reason.slice(0, 1000)]
    );

    return 'manual_review' as const;
  }

  let refund: Stripe.Refund | undefined;

  if (operation.provider_refund_id) {
    refund = await stripe.refunds.retrieve(
      operation.provider_refund_id
    );
  } else {
    const refunds = await stripe.refunds.list({
      payment_intent: operation.provider_payment_id,
      limit: 100,
    });

    refund = refunds.data.find(
      item =>
        item.metadata?.status_refund_operation_id === operation.id
    );

    if (!refund && refunds.has_more) {
      return requireManualReview(
        'Stripe refund search exceeded first page; review required'
      );
    }
  }

  if (!refund) {
    return 'pending';
  }

  const refundPaymentId =
    typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : refund.payment_intent?.id;

  if (
    refund.metadata?.status_refund_operation_id !== operation.id ||
    refund.metadata?.status_purchase_id !== operation.purchase_id ||
    refundPaymentId !== operation.provider_payment_id ||
    operation.purchase_payment_id !== operation.provider_payment_id ||
    refund.amount !== Number(operation.amount_cents) ||
    BigInt(operation.amount_cents) !== BigInt(operation.purchase_amount) ||
    operation.currency.toLowerCase() !==
      operation.purchase_currency.toLowerCase()
  ) {
    return requireManualReview(
      'Stripe refund identity, amount, or currency mismatch'
    );
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(
    operation.provider_payment_id
  );

  if (
    paymentIntent.id !== operation.provider_payment_id ||
    paymentIntent.currency.toLowerCase() !==
      operation.currency.toLowerCase() ||
    paymentIntent.amount !== Number(operation.purchase_amount)
  ) {
    return requireManualReview(
      'Stripe payment intent verification mismatch'
    );
  }

  if (refund.status !== 'succeeded') {
    return 'pending';
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const locked = await client.query<{
      status: string;
      provider_refund_id: string | null;
    }>(
      `SELECT status, provider_refund_id
       FROM public.payment_refunds
       WHERE id = $1
       FOR UPDATE`,
      [operation.id]
    );

    if (locked.rowCount !== 1) {
      throw new Error('Refund operation disappeared during recovery');
    }

    const current = locked.rows[0];

    if (current.status === 'succeeded') {
      if (current.provider_refund_id !== refund.id) {
        throw new Error(
          'Recovered refund conflicts with completed refund'
        );
      }

      await client.query('COMMIT');
      return 'recovered';
    }

    if (
      current.provider_refund_id !== null &&
      current.provider_refund_id !== refund.id
    ) {
      throw new Error(
        'Recovered refund conflicts with assigned Stripe refund ID'
      );
    }

    const refundUpdate = await client.query(

      `UPDATE public.payment_refunds
       SET status = 'succeeded',
           provider_refund_id = $2,
           completed_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [operation.id, refund.id]
    );

    const reconciliationUpdate = await client.query(

      `UPDATE public.payment_reconciliation
       SET status = 'refunded',
           provider_refund_id = $2,
           updated_at = now()
       WHERE purchase_id = $1`,
      [operation.purchase_id, refund.id]
    );

    const purchaseUpdate = await client.query(

      `UPDATE public.purchases
       SET status = 'refunded',
           updated_at = now()
       WHERE id = $1
         AND status IN ('pending', 'paid', 'cancelled')`,
      [operation.purchase_id]
    );

    if (
      refundUpdate.rowCount !== 1 ||
      reconciliationUpdate.rowCount !== 1 ||
      purchaseUpdate.rowCount !== 1
    ) {
      throw new Error(
        'Refund completion failed financial record consistency checks'
      );
    }

    await client.query('COMMIT');

    return 'recovered';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
