CREATE TABLE public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  purchase_id uuid NOT NULL
    REFERENCES public.purchases(id) ON DELETE RESTRICT,

  reconciliation_id uuid NOT NULL
    REFERENCES public.payment_reconciliation(id)
    ON DELETE RESTRICT,

  provider text NOT NULL DEFAULT 'stripe'
    CHECK (provider = 'stripe'),

  provider_payment_id text NOT NULL,

  provider_refund_id text UNIQUE,

  idempotency_key text NOT NULL UNIQUE,

  amount_cents bigint NOT NULL
    CHECK (amount_cents > 0),

  currency text NOT NULL,

  status text NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'processing',
        'submitted',
        'succeeded',
        'failed',
        'manual_review'
      )
    ),

  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),

  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  CONSTRAINT payment_refunds_one_per_reconciliation
    UNIQUE (reconciliation_id)
);

CREATE INDEX payment_refunds_status_idx
  ON public.payment_refunds(status, created_at);

CREATE INDEX payment_refunds_purchase_idx
  ON public.payment_refunds(purchase_id);

ALTER TABLE public.payment_refunds
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_refunds
  FROM anon, authenticated;
