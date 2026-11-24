CREATE OR REPLACE FUNCTION public.status_inventory_hold_duration()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT interval '35 minutes';
$$;

REVOKE ALL ON FUNCTION public.status_inventory_hold_duration()
FROM PUBLIC, anon, authenticated;
