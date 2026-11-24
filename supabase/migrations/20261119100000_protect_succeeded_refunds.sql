CREATE OR REPLACE FUNCTION public.protect_succeeded_payment_refund()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'succeeded'
     AND NEW.status <> 'succeeded' THEN
    RAISE EXCEPTION
      'A succeeded payment refund cannot transition backward';
  END IF;

  IF OLD.provider_refund_id IS NOT NULL
     AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id THEN
    RAISE EXCEPTION
      'An assigned Stripe refund ID cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_succeeded_payment_refund_trigger
BEFORE UPDATE ON public.payment_refunds
FOR EACH ROW
EXECUTE FUNCTION public.protect_succeeded_payment_refund();
