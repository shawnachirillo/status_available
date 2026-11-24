import 'server-only';

import Stripe from 'stripe';
import { getDb } from '../db';

export async function expireCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<'expired' | 'already_finalized' | 'reconciliation_required'> {
  const purchaseId = session.metadata?.purchase_id;
  const reservationId = session.metadata?.reservation_id;

  if (
    session.object !== 'checkout.session' ||
    session.mode !== 'payment' ||
    !purchaseId ||
    !reservationId ||
    session.payment_status === 'paid'
  ) {
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

    if (editionLookup.rowCount !== 1) {
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

    const result = await client.query<{
      purchase_status: string;
      reservation_status: string;
    }>(
      `SELECT
         p.status AS purchase_status,
         r.status AS reservation_status
       FROM public.purchases p
       JOIN public.inventory_reservations r
         ON r.purchase_id = p.id
       JOIN public.checkout_sessions c
         ON c.purchase_id = p.id
       WHERE p.id = $1
         AND r.id = $2
         AND c.reservation_id = r.id
         AND c.provider_session_id = $3
       FOR UPDATE OF p, r, c`,
      [purchaseId, reservationId, session.id]
    );

    if (result.rowCount !== 1) {
      await client.query('ROLLBACK');
      return 'reconciliation_required';
    }

    const current = result.rows[0];

    if (
      current.purchase_status === 'paid' &&
      current.reservation_status === 'converted'
    ) {
      await client.query('COMMIT');
      return 'already_finalized';
    }

    if (
      current.purchase_status === 'cancelled' &&
      current.reservation_status === 'released'
    ) {
      await client.query('COMMIT');
      return 'already_finalized';
    }

    if (
      current.purchase_status !== 'pending' ||
      current.reservation_status !== 'held'
    ) {
      await client.query('ROLLBACK');
      return 'reconciliation_required';
    }

    const released = await client.query(
      `UPDATE public.inventory_reservations
       SET status = 'released',
           released_at = clock_timestamp()
       WHERE id = $1
         AND status = 'held'`,
      [reservationId]
    );

    const cancelled = await client.query(
      `UPDATE public.purchases
       SET status = 'cancelled',
           updated_at = now()
       WHERE id = $1
         AND status = 'pending'`,
      [purchaseId]
    );

    const checkoutExpired = await client.query(
      `UPDATE public.checkout_sessions
       SET status = 'expired',
           updated_at = now()
       WHERE purchase_id = $1
         AND provider_session_id = $2
         AND status = 'open'`,
      [purchaseId, session.id]
    );

    if (
      released.rowCount !== 1 ||
      cancelled.rowCount !== 1 ||
      checkoutExpired.rowCount !== 1
    ) {
      throw new Error('Checkout expiration state mismatch');
    }

    await client.query('COMMIT');
    return 'expired';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
