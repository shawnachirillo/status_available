import { requireStripeTestMode } from './stripe-mode';
import 'server-only';
import Stripe from 'stripe';
import { getDb } from '../db';

type RefundRow = {
  id: string;
  purchase_id: string;
  provider_payment_id: string;
  provider_refund_id: string | null;
  idempotency_key: string;
  amount_cents: string;
  currency: string;
  status: string;
  purchase_amount: string;
  purchase_currency: string;
  purchase_payment_id: string | null;
  reconciliation_status: string;
};

export async function executePaymentRefund(
  refundOperationId: string
): Promise<'submitted' | 'succeeded' | 'already_handled'> {
  if (process.env.STATUS_REFUNDS_ENABLED !== 'true') {
    throw new Error('Refund execution is disabled');
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error('Stripe credentials unavailable');
  }

  const db = getDb();

  const result = await db.query<RefundRow>(
    `SELECT
       r.id,
       r.purchase_id,
       r.provider_payment_id,
       r.provider_refund_id,
       r.idempotency_key,
       r.amount_cents,
       r.currency,
       r.status,
       p.amount_cents AS purchase_amount,
       p.currency AS purchase_currency,
       p.provider_payment_id AS purchase_payment_id,
       pr.status AS reconciliation_status
     FROM public.payment_refunds r
     JOIN public.purchases p
       ON p.id = r.purchase_id
     JOIN public.payment_reconciliation pr
       ON pr.id = r.reconciliation_id
     WHERE r.id = $1`,
    [refundOperationId]
  );

  const operation = result.rows[0];

  if (!operation) {
    throw new Error('Refund operation not found');
  }

  if (
    operation.status === 'succeeded' ||
    operation.status === 'submitted'
  ) {
    return 'already_handled';
  }

  if (
    operation.status !== 'pending' &&
    operation.status !== 'failed'
  ) {
    throw new Error('Refund operation requires manual review');
  }

  if (
    operation.purchase_payment_id !== operation.provider_payment_id ||
    operation.currency !== operation.purchase_currency ||
    BigInt(operation.amount_cents) !== BigInt(operation.purchase_amount)
  ) {
    throw new Error('Refund payment identity or amount mismatch');
  }

  if (
    operation.reconciliation_status !== 'refund_pending' &&
    operation.reconciliation_status !== 'needs_review'
  ) {
    throw new Error('Reconciliation is not eligible for refund');
  }

  const claim = await db.query(
    `UPDATE public.payment_refunds
     SET status = 'processing',
         attempt_count = attempt_count + 1,
         updated_at = now(),
         last_error = NULL
     WHERE id = $1
       AND status IN ('pending', 'failed')
     RETURNING id`,
    [operation.id]
  );

  if (!claim.rowCount) {
    throw new Error('Refund operation already claimed');
  }

  requireStripeTestMode(secretKey);
  const stripe = new Stripe(secretKey);

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: operation.provider_payment_id,
        amount: Number(operation.amount_cents),
        metadata: {
          status_purchase_id: operation.purchase_id,
          status_refund_operation_id: operation.id,
        },
      },
      {
        idempotencyKey: operation.idempotency_key,
      }
    );

    const paymentIntent = await stripe.paymentIntents.retrieve(
      operation.provider_payment_id
    );

    const refundPaymentId =
      typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id;

    if (
      refundPaymentId !== operation.provider_payment_id ||
      refund.amount !== Number(operation.amount_cents) ||
      paymentIntent.id !== operation.provider_payment_id ||
      paymentIntent.currency.toLowerCase() !==
        operation.currency.toLowerCase() ||
      paymentIntent.amount !== Number(operation.purchase_amount) ||
      refund.metadata?.status_refund_operation_id !== operation.id ||
      refund.metadata?.status_purchase_id !== operation.purchase_id
    ) {
      throw new Error(
        'Stripe refund verification failed; manual review required'
      );
    }

    const succeeded = refund.status === 'succeeded';

    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const refundUpdate = await client.query(

        `UPDATE public.payment_refunds
         SET status = $2,
             provider_refund_id = $3,
             completed_at = CASE
               WHEN $2 = 'succeeded' THEN now()
               ELSE NULL
             END,
             updated_at = now()
         WHERE id = $1
           AND status = 'processing'`,
        [
          operation.id,
          succeeded ? 'succeeded' : 'submitted',
          refund.id,
        ]
      );

      if (succeeded) {
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
          reconciliationUpdate.rowCount !== 1 ||
          purchaseUpdate.rowCount !== 1
        ) {
          throw new Error(
            'Refund completion failed financial record consistency checks'
          );
        }
      }

      if (refundUpdate.rowCount !== 1) {
        throw new Error('Refund operation update failed');
      }

      if (succeeded) {
        const verification = await client.query(
          `SELECT
             (SELECT status
              FROM public.payment_reconciliation
              WHERE purchase_id = $1) AS reconciliation_status,
             (SELECT status
              FROM public.purchases
              WHERE id = $1) AS purchase_status`,
          [operation.purchase_id]
        );

        if (
          verification.rows[0]?.reconciliation_status !== 'refunded' ||
          verification.rows[0]?.purchase_status !== 'refunded'
        ) {
          throw new Error(
            'Refund completion did not persist expected financial states'
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    return succeeded ? 'succeeded' : 'submitted';
  } catch (error) {
    await db.query(
      `UPDATE public.payment_refunds
       SET status = 'manual_review',
           last_error = $2,
           updated_at = now()
       WHERE id = $1
         AND status = 'processing'`,
      [
        operation.id,
        error instanceof Error
          ? error.message.slice(0, 1000)
          : 'Unknown Stripe refund error',
      ]
    );

    throw error;
  }
}
