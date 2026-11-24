CREATE UNIQUE INDEX inventory_reservations_checkout_identity_idx
ON public.inventory_reservations (
  id,
  buyer_clerk_user_id,
  edition_id,
  purchase_id
);

CREATE TABLE public.checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  purchase_id uuid NOT NULL UNIQUE
    REFERENCES public.purchases(id)
    ON DELETE RESTRICT,

  reservation_id uuid NOT NULL UNIQUE
    REFERENCES public.inventory_reservations(id)
    ON DELETE RESTRICT,

  buyer_clerk_user_id text NOT NULL,
  edition_id uuid NOT NULL,

  CONSTRAINT checkout_purchase_identity_fk
    FOREIGN KEY (
      purchase_id,
      buyer_clerk_user_id,
      edition_id
    )
    REFERENCES public.purchases (
      id,
      buyer_clerk_user_id,
      edition_id
    ),

  CONSTRAINT checkout_reservation_identity_fk
    FOREIGN KEY (
      reservation_id,
      buyer_clerk_user_id,
      edition_id,
      purchase_id
    )
    REFERENCES public.inventory_reservations (
      id,
      buyer_clerk_user_id,
      edition_id,
      purchase_id
    ),

  provider text NOT NULL DEFAULT 'stripe'
    CHECK (provider = 'stripe'),

  provider_session_id text UNIQUE,

  status text NOT NULL DEFAULT 'creating'
    CHECK (
      status IN (
        'creating',
        'open',
        'completed',
        'expired',
        'failed'
      )
    ),

  checkout_url text,

  expires_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX checkout_sessions_status_idx
ON public.checkout_sessions(status, created_at);

ALTER TABLE public.checkout_sessions
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.checkout_sessions
FROM anon, authenticated;
