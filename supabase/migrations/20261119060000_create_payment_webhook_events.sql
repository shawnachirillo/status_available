CREATE TABLE public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  provider text NOT NULL DEFAULT 'stripe'
    CHECK (provider = 'stripe'),

  provider_event_id text NOT NULL UNIQUE,

  event_type text NOT NULL,

  purchase_id uuid
    REFERENCES public.purchases(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'received'
    CHECK (
      status IN (
        'received',
        'processing',
        'processed',
        'retry_pending',
        'manual_review'
      )
    ),

  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),

  payload jsonb NOT NULL,

  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX payment_webhook_events_status_idx
ON public.payment_webhook_events (
  status,
  created_at
);

CREATE INDEX payment_webhook_events_purchase_idx
ON public.payment_webhook_events (
  purchase_id
);

ALTER TABLE public.payment_webhook_events
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_webhook_events
FROM anon, authenticated;
