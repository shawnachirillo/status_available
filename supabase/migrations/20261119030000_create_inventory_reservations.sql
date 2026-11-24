CREATE TABLE public.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL,
  buyer_clerk_user_id text NOT NULL,
  purchase_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'converted', 'expired', 'released')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz,
  released_at timestamptz,

  CONSTRAINT reservations_purchase_identity_fk
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

  CONSTRAINT reservations_conversion_valid CHECK (
    status <> 'converted'
    OR converted_at IS NOT NULL
  )
);

CREATE INDEX inventory_reservations_edition_idx
  ON public.inventory_reservations (
    edition_id,
    status,
    expires_at
  );

CREATE INDEX inventory_reservations_buyer_idx
  ON public.inventory_reservations (
    buyer_clerk_user_id
  );

ALTER TABLE public.inventory_reservations
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inventory_reservations
  FROM anon, authenticated;

CREATE FUNCTION public.reserve_edition_inventory(
  p_purchase_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_edition_id uuid;
  v_buyer_id text;
  v_purchase_status text;
  v_tier text;
  v_limit integer;
  v_sold bigint;
  v_held bigint;
  v_existing uuid;
  v_reservation_id uuid;
BEGIN
  SELECT edition_id, buyer_clerk_user_id, status
  INTO v_edition_id, v_buyer_id, v_purchase_status
  FROM public.purchases
  WHERE id = p_purchase_id;

  IF NOT FOUND OR v_purchase_status <> 'pending' THEN
    RAISE EXCEPTION 'Pending purchase required';
  END IF;

  SELECT tier, inventory_limit
  INTO v_tier, v_limit
  FROM public.edition_catalog
  WHERE id = v_edition_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Edition unavailable';
  END IF;

  PERFORM 1
  FROM public.purchases
  WHERE id = p_purchase_id
    AND edition_id = v_edition_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase is no longer pending';
  END IF;

  SELECT id
  INTO v_existing
  FROM public.inventory_reservations
  WHERE purchase_id = p_purchase_id
    AND status = 'held'
    AND expires_at > clock_timestamp();

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_reservations
    WHERE purchase_id = p_purchase_id
  ) THEN
    RAISE EXCEPTION
      'Purchase already has an expired or completed reservation';
  END IF;

  IF v_tier <> 'Open' THEN
    SELECT count(*)
    INTO v_sold
    FROM public.inventory_reservations
    WHERE edition_id = v_edition_id
      AND status = 'converted';

    SELECT count(*)
    INTO v_held
    FROM public.inventory_reservations
    WHERE edition_id = v_edition_id
      AND status = 'held'
      AND expires_at > clock_timestamp();

    IF v_sold + v_held >= v_limit THEN
      RAISE EXCEPTION 'Edition inventory exhausted';
    END IF;
  END IF;

  INSERT INTO public.inventory_reservations (
    edition_id,
    buyer_clerk_user_id,
    purchase_id,
    expires_at
  )
  VALUES (
    v_edition_id,
    v_buyer_id,
    p_purchase_id,
    clock_timestamp() + interval '15 minutes'
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;

CREATE FUNCTION public.convert_inventory_reservation(
  p_reservation_id uuid,
  p_purchase_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_edition_id uuid;
  v_status text;
  v_expires_at timestamptz;
  v_linked_purchase uuid;
  v_purchase_status text;
BEGIN
  SELECT edition_id
  INTO v_edition_id
  FROM public.inventory_reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found';
  END IF;

  PERFORM 1
  FROM public.edition_catalog
  WHERE id = v_edition_id
  FOR UPDATE;

  SELECT status, expires_at, purchase_id
  INTO v_status, v_expires_at, v_linked_purchase
  FROM public.inventory_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_linked_purchase <> p_purchase_id THEN
    RAISE EXCEPTION 'Purchase mismatch';
  END IF;

  IF v_status = 'converted' THEN
    RETURN true;
  END IF;

  IF v_status <> 'held'
     OR v_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Reservation expired or unavailable';
  END IF;

  SELECT status
  INTO v_purchase_status
  FROM public.purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND OR v_purchase_status <> 'paid' THEN
    RAISE EXCEPTION 'Paid purchase required';
  END IF;

  UPDATE public.inventory_reservations
  SET status = 'converted',
      converted_at = clock_timestamp()
  WHERE id = p_reservation_id;

  RETURN true;
END;
$$;


CREATE FUNCTION public.protect_inventory_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.purchase_id IS DISTINCT FROM OLD.purchase_id
     OR NEW.edition_id IS DISTINCT FROM OLD.edition_id
     OR NEW.buyer_clerk_user_id IS DISTINCT FROM OLD.buyer_clerk_user_id THEN
    RAISE EXCEPTION 'Reservation identity is immutable';
  END IF;

  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'Reservation expiration is immutable';
  END IF;

  IF OLD.status = 'converted' AND NEW.status <> 'converted' THEN
    RAISE EXCEPTION 'Converted inventory cannot be released';
  END IF;

  IF OLD.status IN ('expired', 'released')
     AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Expired or released inventory cannot be reused';
  END IF;

  IF NEW.status = 'converted'
     AND OLD.status <> 'held' THEN
    RAISE EXCEPTION 'Only held reservations can convert';
  END IF;

  IF OLD.status = 'held'
     AND NEW.status = 'converted'
     AND OLD.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Expired reservation cannot convert';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER reservations_protect_lifecycle
BEFORE UPDATE ON public.inventory_reservations
FOR EACH ROW
EXECUTE FUNCTION public.protect_inventory_reservation();

REVOKE ALL ON FUNCTION
  public.reserve_edition_inventory(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.convert_inventory_reservation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_edition_inventory_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_converted bigint;
  v_held bigint;
BEGIN
  IF OLD.tier IS DISTINCT FROM NEW.tier THEN
    RAISE EXCEPTION 'Edition tier cannot be changed after creation';
  END IF;

  IF NEW.tier <> 'Open' THEN
    SELECT count(*)
    INTO v_converted
    FROM public.inventory_reservations
    WHERE edition_id = NEW.id
      AND status = 'converted';

    SELECT count(*)
    INTO v_held
    FROM public.inventory_reservations
    WHERE edition_id = NEW.id
      AND status = 'held'
      AND expires_at > clock_timestamp();

    IF v_converted + v_held > NEW.inventory_limit THEN
      RAISE EXCEPTION
        'Inventory limit cannot be lower than allocated inventory';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER edition_protect_inventory_limit
BEFORE UPDATE OF tier, inventory_limit
ON public.edition_catalog
FOR EACH ROW
EXECUTE FUNCTION public.protect_edition_inventory_limit();


CREATE OR REPLACE FUNCTION public.protect_inventory_reservation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'held'
     OR NEW.converted_at IS NOT NULL
     OR NEW.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'New inventory reservations must begin as held';
  END IF;

  IF NEW.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'New reservation must have a future expiration';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER reservations_protect_insert
BEFORE INSERT ON public.inventory_reservations
FOR EACH ROW
EXECUTE FUNCTION public.protect_inventory_reservation_insert();


CREATE OR REPLACE FUNCTION public.protect_inventory_reservation_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'converted' THEN
    RAISE EXCEPTION 'Converted inventory cannot be deleted';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER reservations_protect_delete
BEFORE DELETE ON public.inventory_reservations
FOR EACH ROW
EXECUTE FUNCTION public.protect_inventory_reservation_delete();
