CREATE TABLE public.payment_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL UNIQUE
    REFERENCES public.purchases(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (
    reason IN (
      'reservation_expired',
      'inventory_unavailable',
      'payment_mismatch',
      'fulfillment_failed'
    )
  ),
  status text NOT NULL DEFAULT 'needs_review' CHECK (
    status IN (
      'needs_review',
      'refund_pending',
      'refunded',
      'resolved',
      'manual_review'
    )
  ),
  provider_event_id text UNIQUE,
  provider_refund_id text UNIQUE,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_reconciliation_status_idx
ON public.payment_reconciliation(status, created_at);

ALTER TABLE public.payment_reconciliation
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_reconciliation
FROM anon, authenticated;
