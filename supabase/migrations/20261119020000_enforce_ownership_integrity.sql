ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_identity_unique
  UNIQUE (id, buyer_clerk_user_id, edition_id);

ALTER TABLE public.entitlements
  ADD CONSTRAINT entitlements_purchase_identity_fk
  FOREIGN KEY (purchase_id, owner_clerk_user_id, edition_id)
  REFERENCES public.purchases
    (id, buyer_clerk_user_id, edition_id);

ALTER TABLE public.entitlements
  ADD CONSTRAINT entitlements_identity_unique
  UNIQUE (id, owner_clerk_user_id);

ALTER TABLE public.websites
  ADD CONSTRAINT websites_entitlement_owner_fk
  FOREIGN KEY (entitlement_id, owner_clerk_user_id)
  REFERENCES public.entitlements
    (id, owner_clerk_user_id);

CREATE OR REPLACE FUNCTION public.enforce_entitlement_payment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' AND NOT EXISTS (
    SELECT 1
    FROM public.purchases p
    WHERE p.id = NEW.purchase_id
      AND p.status = 'paid'
  ) THEN
    RAISE EXCEPTION
      'Active entitlement requires a paid purchase';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER entitlements_require_paid_purchase
BEFORE INSERT OR UPDATE OF status, purchase_id
ON public.entitlements
FOR EACH ROW
EXECUTE FUNCTION public.enforce_entitlement_payment();

ALTER TABLE public.entitlements
  ADD CONSTRAINT entitlements_full_identity_unique
  UNIQUE (id, owner_clerk_user_id, edition_id);

ALTER TABLE public.websites
  ADD COLUMN edition_catalog_id uuid
    REFERENCES public.edition_catalog(id);

ALTER TABLE public.websites
  ADD CONSTRAINT websites_entitlement_edition_fk
  FOREIGN KEY (
    entitlement_id,
    owner_clerk_user_id,
    edition_catalog_id
  )
  REFERENCES public.entitlements
    (id, owner_clerk_user_id, edition_id);

ALTER TABLE public.websites
  ADD CONSTRAINT websites_entitlement_catalog_required
  CHECK (
    entitlement_id IS NULL
    OR edition_catalog_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.enforce_purchase_entitlement_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    UPDATE public.entitlements
    SET status = 'suspended',
        updated_at = now()
    WHERE purchase_id = NEW.id
      AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER purchases_suspend_entitlements
AFTER UPDATE OF status
ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.enforce_purchase_entitlement_status();

CREATE OR REPLACE FUNCTION public.prevent_purchase_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.buyer_clerk_user_id IS DISTINCT FROM OLD.buyer_clerk_user_id
     OR NEW.edition_id IS DISTINCT FROM OLD.edition_id THEN
    RAISE EXCEPTION 'Purchase customer and Edition are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER purchases_identity_immutable
BEFORE UPDATE OF buyer_clerk_user_id, edition_id
ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.prevent_purchase_identity_change();
