CREATE TABLE public.edition_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  tier text NOT NULL
    CHECK (tier IN ('Open', 'Limited', 'Original')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'retired')),
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  currency text NOT NULL DEFAULT 'usd'
    CHECK (currency ~ '^[a-z]{3}$'),
  inventory_limit integer
    CHECK (inventory_limit IS NULL OR inventory_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT edition_inventory_rules CHECK (
    (tier = 'Open' AND inventory_limit IS NULL)
    OR (tier = 'Limited' AND inventory_limit IS NOT NULL)
    OR (tier = 'Original' AND inventory_limit = 1)
  )
);

CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_clerk_user_id text NOT NULL,
  edition_id uuid NOT NULL REFERENCES public.edition_catalog(id),
  payment_provider text NOT NULL,
  provider_checkout_id text UNIQUE,
  provider_payment_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'paid', 'failed', 'cancelled',
      'refunded', 'partially_refunded', 'disputed'
    )),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX purchases_buyer_idx
  ON public.purchases(buyer_clerk_user_id);

CREATE INDEX purchases_edition_status_idx
  ON public.purchases(edition_id, status);

CREATE TABLE public.entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL UNIQUE
    REFERENCES public.purchases(id),
  edition_id uuid NOT NULL
    REFERENCES public.edition_catalog(id),
  owner_clerk_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX entitlements_owner_idx
  ON public.entitlements(owner_clerk_user_id);

CREATE INDEX entitlements_edition_idx
  ON public.entitlements(edition_id);

ALTER TABLE public.websites
  ADD COLUMN entitlement_id uuid UNIQUE
    REFERENCES public.entitlements(id),
  ADD COLUMN publication_status text NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN (
      'draft', 'published', 'suspended', 'archived'
    )),
  ADD COLUMN hosting_starts_at timestamptz,
  ADD COLUMN hosting_ends_at timestamptz,
  ADD CONSTRAINT website_hosting_dates_valid CHECK (
    hosting_ends_at IS NULL
    OR (
      hosting_starts_at IS NOT NULL
      AND hosting_ends_at > hosting_starts_at
    )
  );

ALTER TABLE public.edition_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.edition_catalog FROM anon, authenticated;
REVOKE ALL ON public.purchases FROM anon, authenticated;
REVOKE ALL ON public.entitlements FROM anon, authenticated;
